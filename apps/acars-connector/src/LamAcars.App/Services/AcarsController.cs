using System.ComponentModel;
using System.Net.Http;
using System.Runtime.CompilerServices;
using System.Text.Json;
using LamAcars.Core.Aircraft;
using LamAcars.Core.Api;
using LamAcars.Core.Engine;
using LamAcars.Core.Models;
using LamAcars.Core.Storage;
using LamAcars.Core.Sync;
using LamAcars.Sim;

namespace LamAcars.App.Services;

/// <summary>
/// Coordina simulador, registrador de vuelo, cola local y sincronización.
/// Expone el estado para la ventana (todas las propiedades notifican cambios).
/// </summary>
public sealed class AcarsController : INotifyPropertyChanged, IDisposable
{
    private readonly AppLog _log;
    private readonly AppSettings _settings;
    private readonly AcarsApiClient _api;
    private readonly Outbox _outbox;
    private readonly SyncWorker _sync;
    private readonly SimConnectClient _sim = new();
    private readonly CancellationTokenSource _cts = new();
    private readonly object _flightGate = new();

    private FlightRecorder? _recorder;
    private OutboxSink? _sink;
    private SampleRecorder? _samples;
    private DateTimeOffset _lastUiUpdate;
    private bool _simWasConnected;

    public AcarsController(AppLog log)
    {
        _log = log;
        _settings = AppSettings.Load();
        _api = new AcarsApiClient(new HttpClient(), _settings.ApiBaseUrl) { Token = TokenStore.Load() };
        _outbox = new Outbox(AppPaths.Database);
        _sync = new SyncWorker(_outbox, _api);

        _sync.StateChanged += OnSyncState;
        _sync.SessionClosed += (id, code) => _log.Write($"El servidor cerró la sesión {id} ({code}); se descartó lo pendiente");
        _sync.SessionEnded += (_, r) => _log.Write($"Vuelo cerrado en el servidor{(r.FinalAirport is { } ap ? $" · llegada {ap}" : string.Empty)}");
        _sim.StatusChanged += OnSimStatus;
        _sim.AircraftChanged += OnAircraftChanged;
        _sim.SampleReceived += OnSample;
        _sim.Crashed += () => AddFlightEvent(FlightEventTypes.Crash, new Dictionary<string, object?>());
        _sim.Log += _log.Write;
        _sim.ClientDataMissing += _ => CheckPmdgSetup();
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    // ------------------------------------------------------------------------
    // Estado para la ventana
    // ------------------------------------------------------------------------
    public string SimStatusText { get; private set; } = "Buscando MSFS…";
    public bool SimConnected { get; private set; }
    public string NetStatusText { get; private set; } = "Sin verificar";
    public bool NetOnline { get; private set; }
    public bool IsLinked => !string.IsNullOrEmpty(_api.Token);
    public string PilotText { get; private set; } = "Equipo sin vincular";
    public string? LinkCode { get; private set; }
    public string LinkHint { get; private set; } = string.Empty;
    public IReadOnlyList<FlightInfo> Flights { get; private set; } = Array.Empty<FlightInfo>();
    public FlightInfo? ActiveFlight { get; private set; }
    public Guid? ActiveSessionId { get; private set; }
    public string PhaseText { get; private set; } = "—";
    public string AircraftText { get; private set; } = "Sin aeronave";
    public string TelemetryText { get; private set; } = string.Empty;
    public int Pending { get; private set; }
    public bool Busy { get; private set; }
    public bool CanStartFlight => IsLinked && SimConnected && ActiveFlight is null && !Busy;
    public bool InFlight => ActiveFlight is not null;
    public string Version => AppPaths.Version;

    // ------------------------------------------------------------------------
    // Arranque
    // ------------------------------------------------------------------------
    public async Task StartAsync()
    {
        _log.Write($"LAM ACARS {AppPaths.Version} · API {_settings.ApiBaseUrl}");
        _sim.Start();
        CheckPmdgSetup();
        _ = Task.Run(() => _sync.RunAsync(_cts.Token));
        _ = Task.Run(PendingLoop);
        if (IsLinked) await RefreshAsync(resume: true);
    }

    private async Task PendingLoop()
    {
        while (!_cts.IsCancellationRequested)
        {
            Set(nameof(Pending), () => Pending = _outbox.PendingCount());
            try
            {
                await Task.Delay(1000, _cts.Token);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    /// <summary>Consulta piloto y reservas; si había un vuelo en curso, lo reanuda.</summary>
    public async Task RefreshAsync(bool resume = false)
    {
        if (!IsLinked) return;
        try
        {
            SetBusy(true);
            var me = await _api.MeAsync(_cts.Token);
            Set(nameof(PilotText), () => PilotText = $"{me.Pilot.DisplayName} · LAM{me.Pilot.PilotNumber:0000} · {me.Device.Name}");
            Set(nameof(Flights), () => Flights = me.Flights);
            SetNet(true, "En línea");
            _log.Write($"{me.Flights.Count} vuelo(s) disponibles");

            if (resume && me.ActiveSession is { } active && ActiveFlight is null)
            {
                var flight = me.Flights.FirstOrDefault(f => f.FlightId == active.FlightId);
                if (flight is not null)
                {
                    _log.Write($"Hay un vuelo en curso ({flight.Callsign}); se reanuda");
                    await StartFlightAsync(flight);
                }
            }
        }
        catch (AcarsApiException e) when (e.IsAuthFailure)
        {
            HandleRevoked(e.Message);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or AcarsApiException)
        {
            SetNet(false, "Sin conexión con LAM");
            _log.Write($"No se pudo consultar LAM: {e.Message}");
        }
        finally
        {
            SetBusy(false);
        }
    }

    // ------------------------------------------------------------------------
    // Vinculación
    // ------------------------------------------------------------------------
    public async Task LinkAsync()
    {
        try
        {
            SetBusy(true);
            var start = await _api.LinkStartAsync(new LinkStartRequest(Environment.MachineName, AppPaths.Version), _cts.Token);
            Set(nameof(LinkCode), () => LinkCode = start.Code);
            Set(nameof(LinkHint), () => LinkHint = "Escribe este código en la web: Settings → Dispositivos ACARS. Vence en 10 minutos.");
            _log.Write($"Código de vinculación {start.Code}");
            SetBusy(false);

            while (DateTimeOffset.UtcNow < start.ExpiresAt && !_cts.IsCancellationRequested)
            {
                await Task.Delay(TimeSpan.FromSeconds(Math.Max(2, start.PollIntervalS)), _cts.Token);
                var poll = await _api.LinkPollAsync(new LinkPollRequest(start.Code, start.PollSecret), _cts.Token);
                if (poll.Status == "approved" && poll.Token is { } token)
                {
                    TokenStore.Save(token);
                    _api.Token = token;
                    _sync.ResetAuthorization();
                    Set(nameof(LinkCode), () => LinkCode = null);
                    Set(nameof(LinkHint), () => LinkHint = string.Empty);
                    OnPropertyChanged(nameof(IsLinked));
                    OnPropertyChanged(nameof(CanStartFlight));
                    _log.Write($"Equipo vinculado a {poll.Pilot?.DisplayName}");
                    await RefreshAsync(resume: true);
                    return;
                }
            }
            Set(nameof(LinkHint), () => LinkHint = "El código venció. Pide otro.");
            Set(nameof(LinkCode), () => LinkCode = null);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or AcarsApiException)
        {
            Set(nameof(LinkHint), () => LinkHint = $"No se pudo vincular: {e.Message}");
            Set(nameof(LinkCode), () => LinkCode = null);
            _log.Write($"Vinculación fallida: {e.Message}");
        }
        finally
        {
            SetBusy(false);
        }
    }

    public void Unlink()
    {
        TokenStore.Clear();
        _api.Token = null;
        Set(nameof(PilotText), () => PilotText = "Equipo sin vincular");
        Set(nameof(Flights), () => Flights = Array.Empty<FlightInfo>());
        OnPropertyChanged(nameof(IsLinked));
        OnPropertyChanged(nameof(CanStartFlight));
        _log.Write("Se olvidó el token de este equipo. Revócalo también en la web si ya no lo usarás.");
    }

    private void HandleRevoked(string message)
    {
        _log.Write($"El equipo ya no está autorizado: {message}");
        TokenStore.Clear();
        _api.Token = null;
        Set(nameof(PilotText), () => PilotText = "Equipo revocado: vincúlalo de nuevo");
        SetNet(false, "No autorizado");
        OnPropertyChanged(nameof(IsLinked));
        OnPropertyChanged(nameof(CanStartFlight));
    }

    // ------------------------------------------------------------------------
    // Vuelo
    // ------------------------------------------------------------------------
    public async Task StartFlightAsync(FlightInfo flight)
    {
        if (ActiveFlight is not null) return;
        try
        {
            SetBusy(true);
            var aircraft = _sim.Aircraft;
            var response = await _api.SessionStartAsync(new SessionStartRequest(
                flight.FlightId,
                new SimAircraft(aircraft?.Title, _sim.AircraftIcao, aircraft?.AtcId),
                AppPaths.Version), _cts.Token);

            var previous = _outbox.GetSession(response.SessionId);
            var local = new LocalSession(
                response.SessionId,
                flight.FlightId,
                flight.Callsign,
                previous?.Phase ?? response.Phase,
                Math.Max(previous?.NextEventSeq ?? 0, (response.LastEventSeq ?? -1) + 1),
                Math.Max(previous?.NextPointSeq ?? 0, (response.LastPointSeq ?? -1) + 1),
                false);
            _outbox.SaveSession(local);

            lock (_flightGate)
            {
                var phase = FlightPhaseExtensions.FromWire(local.Phase);
                _sink = new OutboxSink(_outbox, local, () => _recorder);
                _recorder = new FlightRecorder(_sink, new FlightRecorderOptions
                {
                    InitialPhase = phase,
                    NextEventSeq = local.NextEventSeq,
                    NextPointSeq = local.NextPointSeq,
                    PlannedCruiseFt = response.Flight.Ofp?.CruiseAltitudeFt,
                    PositionInterval = TimeSpan.FromSeconds(Math.Max(5, response.Config.PositionIntervalS)),
                });
                _recorder.PhaseChanged += OnPhaseChanged;
                _samples = _settings.RecordSamples ? new SampleRecorder(flight.Callsign) : null;
                ActiveSessionId = response.SessionId;
            }

            Set(nameof(ActiveFlight), () => ActiveFlight = response.Flight);
            Set(nameof(PhaseText), () => PhaseText = FlightPhaseExtensions.FromWire(local.Phase).ToLabel());
            OnPropertyChanged(nameof(InFlight));
            OnPropertyChanged(nameof(CanStartFlight));
            _log.Write(response.Resumed
                ? $"Sesión reanudada: {flight.Display}"
                : $"ACARS iniciado: {flight.Display}");
            // Qué adaptador se usó y qué no puede medir: el PIREP no evaluará lo que no se midió.
            AddFlightEvent(FlightEventTypes.Note, new Dictionary<string, object?>
            {
                ["kind"] = "adapter",
                ["adapter"] = _sim.Adapter.Name,
                ["title"] = aircraft?.Title,
                ["icao"] = _sim.AircraftIcao,
                ["sdk"] = _sim.Adapter is IClientDataAdapter ? _sim.ClientDataActive : null,
                ["unavailable"] = _sim.Adapter.Unavailable.ToArray(),
            });
            if (_sim.AircraftIcao is { } icao && !string.Equals(icao, flight.Aircraft.Icao, StringComparison.OrdinalIgnoreCase))
                _log.Write($"Aviso: el simulador reporta {icao} y la reserva es {flight.Aircraft.Icao}");
        }
        catch (AcarsApiException e) when (e.IsAuthFailure)
        {
            HandleRevoked(e.Message);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or AcarsApiException)
        {
            _log.Write($"No se pudo iniciar el vuelo: {e.Message}");
            throw new InvalidOperationException(e.Message, e);
        }
        finally
        {
            SetBusy(false);
        }
    }

    /// <summary>Termina el vuelo. El cierre se envía cuando todo lo anterior ya salió.</summary>
    public void FinishFlight(bool completed)
    {
        Guid sessionId;
        SimSample? last;
        lock (_flightGate)
        {
            if (ActiveSessionId is not { } id || _recorder is null) return;
            sessionId = id;
            last = _recorder.LastSample;
            _sink?.Persist();
            _outbox.SaveSession(_sink!.Session with { EndRequested = true });
            _outbox.Enqueue(sessionId, OutboxKind.End, JsonSerializer.Serialize(
                new SessionEndRequest(sessionId, completed ? "completed" : "aborted", last?.Latitude, last?.Longitude), AcarsJson.Options));
            _recorder.PhaseChanged -= OnPhaseChanged;
            _recorder = null;
            _sink = null;
            _samples?.Dispose();
            _samples = null;
            ActiveSessionId = null;
        }
        _log.Write(completed ? "Vuelo terminado; enviando el cierre" : "Vuelo abandonado");
        Set(nameof(ActiveFlight), () => ActiveFlight = null);
        Set(nameof(PhaseText), () => PhaseText = "—");
        Set(nameof(TelemetryText), () => TelemetryText = string.Empty);
        OnPropertyChanged(nameof(InFlight));
        OnPropertyChanged(nameof(CanStartFlight));
        _ = Task.Delay(TimeSpan.FromSeconds(5)).ContinueWith(_ => RefreshAsync(), TaskScheduler.Default);
    }

    private void OnSample(SimSample s)
    {
        lock (_flightGate)
        {
            if (_recorder is null) return;
            try
            {
                _recorder.Process(s);
                _samples?.Add(s);
            }
            catch (Exception e)
            {
                _log.Write($"Error al procesar la lectura: {e.Message}");
            }
        }

        if (s.Time - _lastUiUpdate < TimeSpan.FromMilliseconds(500)) return;
        _lastUiUpdate = s.Time;
        Set(nameof(TelemetryText), () => TelemetryText =
            $"{s.AltitudeFt:N0} ft · GS {s.GsKt:N0} kt · VS {s.VsFpm:+0;-0;0} fpm{(s.OnGround ? " · en tierra" : string.Empty)}{(s.Paused ? " · PAUSA" : string.Empty)}");
    }

    private void OnPhaseChanged(PhaseTransition tr)
    {
        Set(nameof(PhaseText), () => PhaseText = tr.To.ToLabel());
        _log.Write($"Fase: {tr.To.ToLabel()}{(tr.Reason is { } r ? $" ({r})" : string.Empty)}");
        if (tr.To == FlightPhase.FlightCompleted)
        {
            // Se cierra fuera del hilo de SimConnect.
            _ = Task.Run(() => FinishFlight(completed: true));
        }
    }

    private void AddFlightEvent(string type, IReadOnlyDictionary<string, object?> data)
    {
        lock (_flightGate) _recorder?.AddEvent(type, data);
    }

    private void OnAircraftChanged(AircraftIdentity aircraft)
    {
        Set(nameof(AircraftText), () => AircraftText = $"{aircraft.Title}{(aircraft.AtcId is { } id ? $" · {id}" : string.Empty)}");
        _log.Write($"Aeronave: {aircraft.Title} ({aircraft.GuessIcao() ?? "tipo sin identificar"}, adaptador {_sim.Adapter.Name})");
        if (InFlight)
            AddFlightEvent(FlightEventTypes.AircraftChanged, new Dictionary<string, object?> { ["title"] = aircraft.Title, ["icao"] = _sim.AircraftIcao });
        if (_sim.Adapter is PmdgAdapter) CheckPmdgSetup();
    }

    // ------------------------------------------------------------------------
    // SDK de PMDG
    // ------------------------------------------------------------------------

    /// <summary>Texto del aviso cuando hay aviones PMDG sin la publicación de datos activada (vacío si no hace falta).</summary>
    public string PmdgSetupText { get; private set; } = string.Empty;
    public bool PmdgSetupNeeded => PmdgSetupText.Length > 0;

    public void CheckPmdgSetup()
    {
        try
        {
            var pending = PmdgSdkSetup.Find(PmdgSdkSetup.DefaultRoots()).Where(f => !f.Enabled).ToList();
            var text = pending.Count == 0
                ? string.Empty
                : $"PMDG: falta activar los datos del SDK en {string.Join(", ", pending.Select(f => f.Package).Distinct())}. Sin ellos se usan las variables estándar.";
            Set(nameof(PmdgSetupText), () => PmdgSetupText = text);
            OnPropertyChanged(nameof(PmdgSetupNeeded));
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            _log.Write($"No se pudieron revisar las opciones de PMDG: {e.Message}");
        }
    }

    /// <summary>Escribe EnableDataBroadcast=1 en los aviones PMDG instalados.</summary>
    public void EnablePmdgSdk()
    {
        try
        {
            var files = PmdgSdkSetup.Find(PmdgSdkSetup.DefaultRoots());
            if (files.Count == 0)
            {
                _log.Write("No se encontró ningún *_Options.ini de PMDG. Carga el avión una vez en MSFS y vuelve a intentar.");
                return;
            }
            var changed = PmdgSdkSetup.EnableAll(files);
            foreach (var f in changed) _log.Write($"PMDG: datos del SDK activados en {f.Path} (copia en .lam-backup)");
            if (changed.Count > 0) _log.Write("Reinicia MSFS (o vuelve a cargar el avión) para que PMDG empiece a publicar los datos.");
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            _log.Write($"No se pudo activar el SDK de PMDG: {e.Message}");
        }
        CheckPmdgSetup();
    }

    private void OnSimStatus(SimStatus status)
    {
        var connected = status == SimStatus.Connected;
        Set(nameof(SimConnected), () => SimConnected = connected);
        Set(nameof(SimStatusText), () => SimStatusText = status switch
        {
            SimStatus.Connected => "MSFS conectado",
            SimStatus.LibraryMissing => "Falta SimConnect.dll junto a LamAcars.exe",
            _ => "Esperando MSFS 2024…",
        });
        OnPropertyChanged(nameof(CanStartFlight));

        if (InFlight && _simWasConnected != connected)
            AddFlightEvent(connected ? FlightEventTypes.ConnectionRestored : FlightEventTypes.ConnectionLost,
                new Dictionary<string, object?> { ["source"] = "simulator" });
        _simWasConnected = connected;
    }

    private void OnSyncState(SyncState state)
    {
        switch (state)
        {
            case SyncState.Online:
                SetNet(true, "En línea");
                break;
            case SyncState.Offline:
                SetNet(false, "Sin internet: guardando en el equipo");
                _log.Write($"Sin conexión ({_sync.LastError}); los datos se guardan y se enviarán después");
                break;
            case SyncState.Unauthorized:
                HandleRevoked(_sync.LastError ?? "token rechazado");
                break;
        }
    }

    // ------------------------------------------------------------------------
    private void SetNet(bool online, string text)
    {
        Set(nameof(NetOnline), () => NetOnline = online);
        Set(nameof(NetStatusText), () => NetStatusText = text);
    }

    private void SetBusy(bool busy)
    {
        Set(nameof(Busy), () => Busy = busy);
        OnPropertyChanged(nameof(CanStartFlight));
    }

    private void Set(string property, Action assign)
    {
        assign();
        OnPropertyChanged(property);
    }

    private void OnPropertyChanged([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));

    public void Dispose()
    {
        _cts.Cancel();
        _sim.Dispose();
        lock (_flightGate) _samples?.Dispose();
        _outbox.Dispose();
    }
}
