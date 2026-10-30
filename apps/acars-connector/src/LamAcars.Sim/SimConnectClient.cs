using System.Runtime.InteropServices;
using System.Text;
using LamAcars.Core.Aircraft;
using LamAcars.Core.Models;

namespace LamAcars.Sim;

public enum SimStatus
{
    /// <summary>No se encontró SimConnect.dll junto al conector.</summary>
    LibraryMissing,
    Disconnected,
    Connected,
}

/// <summary>
/// Conexión con MSFS 2024. Reintenta cada 5 s mientras el simulador no esté
/// abierto, lee la aeronave del usuario a ~6 lecturas por segundo (datos
/// etiquetados, para tolerar variables que una aeronave no tenga) y avisa
/// pausas y cambios de aeronave.
/// </summary>
public sealed class SimConnectClient : IDisposable
{
    private const uint DefNumeric = 1;
    private const uint DefStrings = 2;
    private const uint ReqNumeric = 1;
    private const uint ReqStrings = 2;
    private const uint ReqAircraftLoaded = 3;
    private const uint EvtPause = 1;
    private const uint EvtSim = 2;
    private const uint EvtCrashed = 3;
    private const uint EvtAircraftLoaded = 4;

    private static readonly (string Name, Native.DataType Type, int Size)[] StringVars =
    {
        ("TITLE", Native.DataType.String256, 256),
        ("ATC ID", Native.DataType.String32, 32),
        ("ATC MODEL", Native.DataType.String32, 32),
        ("ATC TYPE", Native.DataType.String64, 64),
    };

    private readonly object _gate = new();
    private Thread? _thread;
    private volatile bool _running;
    private IntPtr _handle = IntPtr.Zero;
    private IAircraftAdapter _adapter = new GenericAdapter();
    private readonly Dictionary<string, double> _values = new();
    private readonly Dictionary<string, double> _diagnostics = new();
    private readonly string?[] _strings = new string?[StringVars.Length];
    private bool _paused;

    public SimStatus Status { get; private set; } = SimStatus.Disconnected;
    public AircraftIdentity? Aircraft { get; private set; }
    public IAircraftAdapter Adapter => _adapter;

    public event Action<SimStatus>? StatusChanged;
    public event Action<SimSample>? SampleReceived;
    public event Action<AircraftIdentity>? AircraftChanged;
    public event Action? Crashed;
    public event Action<string>? Log;

    public void Start()
    {
        if (_running) return;
        _running = true;
        _thread = new Thread(Loop) { IsBackground = true, Name = "SimConnect" };
        _thread.Start();
    }

    public void Dispose()
    {
        _running = false;
        _thread?.Join(TimeSpan.FromSeconds(2));
        Close();
    }

    private void Loop()
    {
        while (_running)
        {
            if (_handle == IntPtr.Zero)
            {
                if (!TryOpen())
                {
                    Sleep(5000);
                    continue;
                }
            }

            try
            {
                var drained = 0;
                while (_handle != IntPtr.Zero && Native.SimConnect_GetNextDispatch(_handle, out var data, out var size) == Native.S_OK)
                {
                    Handle(data, size);
                    if (++drained > 200) break;
                }
            }
            catch (Exception e) when (e is SEHException or AccessViolationException or InvalidOperationException)
            {
                Log?.Invoke($"SimConnect falló: {e.Message}");
                Close();
            }
            Sleep(20);
        }
    }

    private void Sleep(int ms)
    {
        var until = Environment.TickCount64 + ms;
        while (_running && Environment.TickCount64 < until) Thread.Sleep(Math.Min(100, ms));
    }

    private bool TryOpen()
    {
        try
        {
            var hr = Native.SimConnect_Open(out var handle, "LAM ACARS", IntPtr.Zero, 0, IntPtr.Zero, 0);
            if (hr != Native.S_OK || handle == IntPtr.Zero)
            {
                SetStatus(SimStatus.Disconnected);
                return false;
            }
            _handle = handle;
            Configure();
            Log?.Invoke("Conectado a MSFS por SimConnect");
            SetStatus(SimStatus.Connected);
            return true;
        }
        catch (DllNotFoundException)
        {
            SetStatus(SimStatus.LibraryMissing);
            return false;
        }
        catch (BadImageFormatException)
        {
            Log?.Invoke("SimConnect.dll no es de 64 bits o está dañada");
            SetStatus(SimStatus.LibraryMissing);
            return false;
        }
    }

    private void Configure()
    {
        var vars = _adapter.Variables;
        for (var i = 0; i < vars.Count; i++)
        {
            Native.SimConnect_AddToDataDefinition(_handle, DefNumeric, vars[i].Name, vars[i].Units, Native.DataType.Float64, 0, (uint)i);
        }
        for (var i = 0; i < StringVars.Length; i++)
        {
            Native.SimConnect_AddToDataDefinition(_handle, DefStrings, StringVars[i].Name, null, StringVars[i].Type, 0, (uint)i);
        }

        // Datos etiquetados: si una variable no existe, las demás siguen llegando bien.
        Native.SimConnect_RequestDataOnSimObject(_handle, ReqNumeric, DefNumeric, Native.USER_OBJECT, Native.Period.SimFrame,
            Native.RequestFlags.Tagged, 0, 6, 0);
        Native.SimConnect_RequestDataOnSimObject(_handle, ReqStrings, DefStrings, Native.USER_OBJECT, Native.Period.Second,
            Native.RequestFlags.Tagged | Native.RequestFlags.Changed, 0, 0, 0);

        Native.SimConnect_SubscribeToSystemEvent(_handle, EvtPause, "Pause");
        Native.SimConnect_SubscribeToSystemEvent(_handle, EvtSim, "Sim");
        Native.SimConnect_SubscribeToSystemEvent(_handle, EvtCrashed, "Crashed");
        Native.SimConnect_SubscribeToSystemEvent(_handle, EvtAircraftLoaded, "AircraftLoaded");
        Native.SimConnect_RequestSystemState(_handle, ReqAircraftLoaded, "AircraftLoaded");
    }

    private void Handle(IntPtr data, uint size)
    {
        var id = (Native.RecvId)(uint)Marshal.ReadInt32(data, 8);
        switch (id)
        {
            case Native.RecvId.SimObjectData:
                HandleData(data, size);
                break;
            case Native.RecvId.Event:
            {
                var evt = (uint)Marshal.ReadInt32(data, Native.OffsetEventId);
                var value = (uint)Marshal.ReadInt32(data, Native.OffsetEventData);
                if (evt == EvtPause) _paused = value == 1;
                else if (evt == EvtCrashed) Crashed?.Invoke();
                break;
            }
            case Native.RecvId.Exception:
            {
                var code = Marshal.ReadInt32(data, Native.OffsetException);
                var index = Marshal.ReadInt32(data, Native.OffsetExceptionIndex);
                Log?.Invoke($"SimConnect excepción {code} (parámetro {index})");
                break;
            }
            case Native.RecvId.Quit:
                Log?.Invoke("MSFS se cerró");
                Close();
                break;
        }
    }

    private void HandleData(IntPtr data, uint size)
    {
        var request = (uint)Marshal.ReadInt32(data, Native.OffsetRequestId);
        var count = Marshal.ReadInt32(data, Native.OffsetDefineCount);
        var offset = Native.SimObjectDataHeaderSize;

        if (request == ReqNumeric)
        {
            var vars = _adapter.Variables;
            for (var i = 0; i < count && offset + 12 <= size; i++)
            {
                var datum = Marshal.ReadInt32(data, offset);
                var bits = Marshal.ReadInt64(data, offset + 4);
                offset += 12;
                if (datum >= 0 && datum < vars.Count) _values[vars[datum].Name] = BitConverter.Int64BitsToDouble(bits);
            }
            foreach (var name in _adapter.Diagnostics)
            {
                if (!_values.TryGetValue(name, out var value)) continue;
                if (_diagnostics.TryGetValue(name, out var last) && Math.Abs(last - value) < 0.0001) continue;
                _diagnostics[name] = value;
                Log?.Invoke($"{_adapter.Name}: {name} = {value:0.###}");
            }
            var sample = _adapter.Map(_values, DateTimeOffset.UtcNow, _paused);
            SampleReceived?.Invoke(sample);
        }
        else if (request == ReqStrings)
        {
            for (var i = 0; i < count; i++)
            {
                if (offset + 4 > size) break;
                var datum = Marshal.ReadInt32(data, offset);
                offset += 4;
                if (datum < 0 || datum >= StringVars.Length) break;
                var length = StringVars[datum].Size;
                if (offset + length > size) break;
                var bytes = new byte[length];
                Marshal.Copy(data + offset, bytes, 0, length);
                offset += length;
                var zero = Array.IndexOf(bytes, (byte)0);
                _strings[datum] = Encoding.UTF8.GetString(bytes, 0, zero < 0 ? length : zero).Trim();
            }
            var identity = new AircraftIdentity(_strings[0] ?? "Aeronave", Blank(_strings[1]), Blank(_strings[2]), Blank(_strings[3]));
            if (identity != Aircraft)
            {
                Aircraft = identity;
                var adapter = AdapterRegistry.For(identity);
                if (adapter.GetType() != _adapter.GetType())
                {
                    // Otro adaptador puede leer variables distintas: se vuelve a configurar la conexión.
                    _adapter = adapter;
                    _values.Clear();
                    _diagnostics.Clear();
                    Close();
                }
                AircraftChanged?.Invoke(identity);
            }
        }
    }

    private static string? Blank(string? s) => string.IsNullOrWhiteSpace(s) ? null : s;

    private void Close()
    {
        lock (_gate)
        {
            if (_handle != IntPtr.Zero)
            {
                try
                {
                    Native.SimConnect_Close(_handle);
                }
                catch (Exception)
                {
                    // Al cerrar no hay nada más que hacer.
                }
                _handle = IntPtr.Zero;
            }
        }
        SetStatus(Status == SimStatus.LibraryMissing ? SimStatus.LibraryMissing : SimStatus.Disconnected);
    }

    private void SetStatus(SimStatus status)
    {
        if (Status == status) return;
        Status = status;
        StatusChanged?.Invoke(status);
    }
}
