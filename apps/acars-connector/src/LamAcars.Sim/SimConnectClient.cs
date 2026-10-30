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
    private const uint ReqClientDataBase = 100;
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

    // Datos de cliente (SDK de PMDG): último bloque recibido por área y conteo para identificar la aeronave por sus datos.
    private static readonly IReadOnlyList<ClientDataArea> Areas = AdapterRegistry.ClientDataAreas;
    private readonly Dictionary<string, byte[]> _clientBytes = new();
    private readonly Dictionary<string, (long First, int Count)> _clientHits = new();
    private long _adapterSince = Environment.TickCount64;
    private bool _clientDataNoticeLogged;
    private volatile bool _clientDataActive;
    private volatile IReadOnlyDictionary<string, double> _lastValues = new Dictionary<string, double>();

    public SimStatus Status { get; private set; } = SimStatus.Disconnected;
    public AircraftIdentity? Aircraft { get; private set; }
    public IAircraftAdapter Adapter => _adapter;

    /// <summary>Tipo ICAO: el que reporta la aeronave (variante del SDK de PMDG) o el deducido del título.</summary>
    public string? AircraftIcao => _adapter.IdentifyIcao(_lastValues) ?? Aircraft?.GuessIcao();

    /// <summary>La aeronave usa un SDK de datos (PMDG) y ya llegaron sus datos.</summary>
    public bool ClientDataActive => _clientDataActive;

    public event Action<SimStatus>? StatusChanged;
    public event Action<SimSample>? SampleReceived;
    public event Action<AircraftIdentity>? AircraftChanged;
    public event Action? Crashed;
    public event Action<string>? Log;

    /// <summary>La aeronave tiene SDK de datos pero no llegan (PMDG sin EnableDataBroadcast=1).</summary>
    public event Action<IAircraftAdapter>? ClientDataMissing;

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
            _adapterSince = Environment.TickCount64;
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

        // SDK de PMDG: se piden siempre las áreas conocidas; solo llegan datos si el avión está cargado y las publica.
        for (var i = 0; i < Areas.Count; i++)
        {
            var area = Areas[i];
            Native.SimConnect_MapClientDataNameToID(_handle, area.Name, area.Id);
            Native.SimConnect_AddToClientDataDefinition(_handle, area.DefinitionId, 0, (uint)area.Size, 0, Native.UNUSED);
            Native.SimConnect_RequestClientData(_handle, area.Id, ReqClientDataBase + (uint)i, area.DefinitionId,
                Native.ClientDataPeriod.OnSet, Native.RequestFlags.Default, 0, 0, 0);
        }

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
            case Native.RecvId.ClientData:
                HandleClientData(data, size);
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
            IReadOnlyDictionary<string, double> values = _values;
            if (_adapter is IClientDataAdapter cda)
            {
                if (_clientBytes.TryGetValue(cda.ClientData.Name, out var block))
                {
                    var merged = new Dictionary<string, double>(_values);
                    cda.Read(block, merged);
                    values = merged;
                }
                else if (!_clientDataNoticeLogged && Environment.TickCount64 - _adapterSince > 20_000)
                {
                    _clientDataNoticeLogged = true;
                    Log?.Invoke($"{_adapter.Name}: no llegan datos del SDK; se usan las variables estándar. Actívalo con EnableDataBroadcast=1 (botón en esta ventana) y recarga el avión.");
                    ClientDataMissing?.Invoke(_adapter);
                }
            }
            _lastValues = values;

            foreach (var name in _adapter.Diagnostics)
            {
                if (!values.TryGetValue(name, out var value)) continue;
                if (_diagnostics.TryGetValue(name, out var last) && Math.Abs(last - value) < 0.0001) continue;
                _diagnostics[name] = value;
                Log?.Invoke($"{_adapter.Name}: {name} = {value:0.###}");
            }
            var sample = _adapter.Map(values, DateTimeOffset.UtcNow, _paused);
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
                    UseAdapter(adapter);
                    Close();
                }
                AircraftChanged?.Invoke(identity);
            }
        }
    }

    private void HandleClientData(IntPtr data, uint size)
    {
        var request = (uint)Marshal.ReadInt32(data, Native.OffsetRequestId);
        var index = (int)(request - ReqClientDataBase);
        if (index < 0 || index >= Areas.Count) return;
        var area = Areas[index];
        var length = (int)size - Native.SimObjectDataHeaderSize;
        if (length < area.Size) return;

        if (!_clientBytes.TryGetValue(area.Name, out var block))
        {
            block = new byte[area.Size];
        }
        Marshal.Copy(data + Native.SimObjectDataHeaderSize, block, 0, area.Size);

        if (_adapter is IClientDataAdapter current && current.ClientData.Name == area.Name)
        {
            if (!_clientBytes.ContainsKey(area.Name)) Log?.Invoke($"{_adapter.Name}: recibiendo datos del SDK");
            _clientBytes[area.Name] = block;
            _clientDataActive = true;
            return;
        }

        // Datos de una aeronave que el título no identificó: tras varias publicaciones seguidas se cambia de adaptador.
        var now = Environment.TickCount64;
        var hits = _clientHits.TryGetValue(area.Name, out var h) && now - h.First < 5000 ? (h.First, h.Count + 1) : (now, 1);
        _clientHits[area.Name] = hits;
        if (hits.Item2 < 3 || AdapterRegistry.ForClientData(area.Name) is not { } adapter) return;

        Log?.Invoke($"Datos del SDK {area.Name} detectados: se usa el adaptador {adapter.Name}");
        var sameVariables = adapter.Variables.Select(v => v.Name).SequenceEqual(_adapter.Variables.Select(v => v.Name));
        UseAdapter(adapter);
        _clientBytes[area.Name] = block;
        _clientDataActive = true;
        if (!sameVariables) Close();
    }

    private void UseAdapter(IAircraftAdapter adapter)
    {
        _adapter = adapter;
        _values.Clear();
        _diagnostics.Clear();
        _clientBytes.Clear();
        _clientHits.Clear();
        _clientDataNoticeLogged = false;
        _clientDataActive = false;
        _adapterSince = Environment.TickCount64;
        _lastValues = new Dictionary<string, double>();
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
