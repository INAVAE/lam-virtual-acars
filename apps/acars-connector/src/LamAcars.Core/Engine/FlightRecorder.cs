using LamAcars.Core.Models;

namespace LamAcars.Core.Engine;

/// <summary>Destino de lo que produce el registrador (la cola local en el conector, una lista en las pruebas).</summary>
public interface IFlightSink
{
    void Event(FlightEventRecord e);
    void TrackPoint(TrackPointRecord p);
    void Position(PositionRecord p);
}

public sealed class FlightRecorderOptions
{
    public FlightPhase InitialPhase { get; init; } = FlightPhase.AircraftConnected;
    public int NextEventSeq { get; init; }
    public int NextPointSeq { get; init; }
    public double? PlannedCruiseFt { get; init; }
    public TimeSpan PositionInterval { get; init; } = TimeSpan.FromSeconds(10);
}

/// <summary>
/// Convierte lecturas del simulador en fases, eventos, puntos de traza y
/// posición viva. No sabe nada de red ni de disco: entrega todo a un IFlightSink.
/// </summary>
public sealed class FlightRecorder
{
    private readonly IFlightSink _sink;
    private readonly PhaseMachine _machine;
    private readonly LandingAnalyzer _landing = new();
    private readonly TimeSpan _positionInterval;

    private SimSample? _previous;
    private DateTimeOffset? _lastPoint;
    private DateTimeOffset? _lastPosition;
    private bool _blockOffSent;
    private bool _blockOnSent;
    private DateTimeOffset? _overspeedSince;
    private DateTimeOffset? _stallSince;
    private SimSample? _liftoff;
    private bool? _apuState;
    private (bool State, DateTimeOffset Since)? _apuPending;

    public FlightRecorder(IFlightSink sink, FlightRecorderOptions? options = null)
    {
        options ??= new FlightRecorderOptions();
        _sink = sink;
        _machine = new PhaseMachine(options.InitialPhase, options.PlannedCruiseFt);
        _positionInterval = options.PositionInterval;
        NextEventSeq = options.NextEventSeq;
        NextPointSeq = options.NextPointSeq;
        // Al reanudar un vuelo ya en el aire, el bloque de salida ya ocurrió.
        _blockOffSent = options.InitialPhase > FlightPhase.Pushback;
        _blockOnSent = options.InitialPhase >= FlightPhase.EnginesShutdown;
    }

    public FlightPhase Phase => _machine.Phase;
    public int NextEventSeq { get; private set; }
    public int NextPointSeq { get; private set; }
    public SimSample? LastSample => _previous;

    public event Action<PhaseTransition>? PhaseChanged;

    public void Process(SimSample s)
    {
        var prev = _previous;
        DetectSimEvents(prev, s);
        TrackApu(s);
        if (prev is { OnGround: true } && !s.OnGround) _liftoff = s;

        foreach (var tr in _machine.Update(s))
        {
            var data = new Dictionary<string, object?> { ["from"] = tr.From.ToWire(), ["to"] = tr.To.ToWire() };
            if (tr.Reason is not null) data["reason"] = tr.Reason;
            Emit(FlightEventTypes.PhaseChange, tr.To, s, data);

            if (tr.To == FlightPhase.InitialClimb)
            {
                // El despegue se fecha en la primera lectura en el aire, no al confirmar la fase.
                var lo = _liftoff ?? s;
                Emit(FlightEventTypes.Takeoff, tr.To, lo, new Dictionary<string, object?>
                {
                    ["ias_kt"] = Round(lo.IasKt), ["gs_kt"] = Math.Round(lo.GsKt), ["pitch_deg"] = Round(lo.PitchDeg, 1), ["heading_deg"] = Round(lo.HeadingDeg),
                    ["fuel_kg"] = Round(lo.FuelTotalKg), ["flaps_deg"] = Round(lo.FlapsDeg, 1),
                });
            }
            if (tr.To == FlightPhase.Landing) _landing.Reset();
            if (tr.Reason is "go_around" or "touch_and_go" or "rejected_takeoff")
            {
                Emit(FlightEventTypes.Note, tr.To, s, new Dictionary<string, object?> { ["kind"] = tr.Reason });
            }
            if (tr.To == FlightPhase.EnginesShutdown && !_blockOnSent) EmitBlockOn(s);

            // Un punto de traza en cada cambio de fase.
            AddPoint(s);
            PhaseChanged?.Invoke(tr);
        }

        // Aterrizaje: métricas cuando se cumple la ventana posterior al contacto.
        var metrics = _landing.Add(s, _machine.Phase == FlightPhase.Landing);
        if (metrics is not null)
        {
            Emit(FlightEventTypes.Touchdown, FlightPhase.Landing, s, metrics.ToData(_landing.Bounces),
                metrics.TouchdownAt, metrics.Latitude, metrics.Longitude, metrics.AltitudeFt);
        }

        // Calzos fuera: primer movimiento en tierra.
        if (!_blockOffSent && s.OnGround && (s.GsKt > 1 || s.PushbackActive || s.MovingBackward) && _machine.Phase >= FlightPhase.Preflight && _machine.Phase <= FlightPhase.TaxiOut)
        {
            _blockOffSent = true;
            Emit(FlightEventTypes.BlockOff, _machine.Phase, s, new Dictionary<string, object?> { ["fuel_kg"] = Round(s.FuelTotalKg) });
        }
        // Calzos puestos: detenido con freno de estacionamiento después de aterrizar.
        if (!_blockOnSent && _machine.Phase == FlightPhase.TaxiIn && s.GsKt < 1 && s.ParkingBrake) EmitBlockOn(s);

        if (!s.Paused && !s.Slew)
        {
            if (_lastPoint is null || s.Time - _lastPoint.Value >= TrackInterval(_machine.Phase)) AddPoint(s);
            if (_lastPosition is null || s.Time - _lastPosition.Value >= _positionInterval)
            {
                _lastPosition = s.Time;
                _sink.Position(new PositionRecord(s.Time, s.Latitude, s.Longitude, s.AltitudeFt, s.AglFt, s.IasKt, s.GsKt, s.HeadingDeg, s.VsFpm, s.OnGround, _machine.Phase));
            }
        }

        _previous = s;
    }

    /// <summary>Evento escrito por el conector (por ejemplo, el piloto cambió de aeronave).</summary>
    public void AddEvent(string type, IReadOnlyDictionary<string, object?> data)
    {
        var s = _previous;
        var record = new FlightEventRecord(Guid.NewGuid(), NextEventSeq++, type, _machine.Phase, DateTimeOffset.UtcNow,
            s?.Latitude, s?.Longitude, s?.AltitudeFt, data);
        _sink.Event(record);
    }

    /// <summary>Intervalo de la traza por fase: más denso en despegue y aproximación, ralo en crucero.</summary>
    public static TimeSpan TrackInterval(FlightPhase phase) => phase switch
    {
        FlightPhase.Takeoff or FlightPhase.InitialClimb or FlightPhase.Approach or FlightPhase.Landing => TimeSpan.FromSeconds(2),
        FlightPhase.Climb or FlightPhase.Descent => TimeSpan.FromSeconds(5),
        FlightPhase.Cruise => TimeSpan.FromSeconds(30),
        // En tierra cada 3 s: el trazo sigue las calles de rodaje en el mapa del PIREP.
        FlightPhase.Pushback or FlightPhase.TaxiOut or FlightPhase.TaxiIn => TimeSpan.FromSeconds(3),
        _ => TimeSpan.FromSeconds(60),
    };

    private void DetectSimEvents(SimSample? prev, SimSample s)
    {
        if (prev is null) return;
        // Un evento por motor, aunque dos cambien entre una lectura y otra.
        for (var running = prev.EnginesRunning + 1; running <= s.EnginesRunning; running++)
            Emit(FlightEventTypes.EngineStart, _machine.Phase, s, new Dictionary<string, object?> { ["running"] = running, ["count"] = s.EngineCount });
        for (var running = prev.EnginesRunning - 1; running >= s.EnginesRunning; running--)
            Emit(FlightEventTypes.EngineShutdown, _machine.Phase, s, new Dictionary<string, object?> { ["running"] = running, ["count"] = s.EngineCount, ["on_ground"] = s.OnGround });
        if (s.Paused != prev.Paused)
            Emit(s.Paused ? FlightEventTypes.SimPaused : FlightEventTypes.SimResumed, _machine.Phase, s, new Dictionary<string, object?>());
        if (s.Slew && !prev.Slew)
            Emit(FlightEventTypes.Slew, _machine.Phase, s, new Dictionary<string, object?>());

        // Sobrevelocidad y pérdida: se reportan si duran al menos 2 s.
        _overspeedSince = s.Overspeed ? _overspeedSince ?? s.Time : null;
        if (_overspeedSince is { } os && (s.Time - os).TotalSeconds >= 2 && (prev.Time - os).TotalSeconds < 2)
            Emit(FlightEventTypes.Overspeed, _machine.Phase, s, new Dictionary<string, object?> { ["ias_kt"] = Round(s.IasKt) });
        _stallSince = s.Stall ? _stallSince ?? s.Time : null;
        if (_stallSince is { } st && (s.Time - st).TotalSeconds >= 2 && (prev.Time - st).TotalSeconds < 2)
            Emit(FlightEventTypes.Stall, _machine.Phase, s, new Dictionary<string, object?> { ["ias_kt"] = Round(s.IasKt) });
    }

    /// <summary>
    /// APU: nota al encender y al apagar (estado estable 5 s, con la hora del cambio)
    /// y otra si ya estaba en marcha al iniciar ACARS.
    /// </summary>
    private void TrackApu(SimSample s)
    {
        if (s.ApuRunning is not { } running) return;
        if (_apuState is null)
        {
            _apuState = running;
            if (running) EmitApu("running", s, s.Time);
            return;
        }
        if (running == _apuState)
        {
            _apuPending = null;
            return;
        }
        if (_apuPending is not { } pending || pending.State != running)
        {
            _apuPending = (running, s.Time);
            return;
        }
        if ((s.Time - pending.Since).TotalSeconds < 5) return;
        _apuState = running;
        _apuPending = null;
        EmitApu(running ? "start" : "stop", s, pending.Since);
    }

    private void EmitApu(string state, SimSample s, DateTimeOffset at) =>
        Emit(FlightEventTypes.Note, _machine.Phase, s,
            new Dictionary<string, object?> { ["kind"] = "apu", ["state"] = state, ["fuel_kg"] = Round(s.FuelTotalKg) }, at);

    private void EmitBlockOn(SimSample s)
    {
        _blockOnSent = true;
        Emit(FlightEventTypes.BlockOn, _machine.Phase, s, new Dictionary<string, object?> { ["fuel_kg"] = Round(s.FuelTotalKg) });
    }

    private void AddPoint(SimSample s)
    {
        _lastPoint = s.Time;
        _sink.TrackPoint(new TrackPointRecord(NextPointSeq++, s.Time, s.Latitude, s.Longitude, s.AltitudeFt, s.GsKt, s.IasKt, s.VsFpm, s.HeadingDeg, s.OnGround, _machine.Phase, s.FuelTotalKg));
    }

    private void Emit(string type, FlightPhase phase, SimSample s, IReadOnlyDictionary<string, object?> data,
        DateTimeOffset? at = null, double? lat = null, double? lon = null, double? alt = null)
    {
        _sink.Event(new FlightEventRecord(Guid.NewGuid(), NextEventSeq++, type, phase, at ?? s.Time,
            lat ?? s.Latitude, lon ?? s.Longitude, alt ?? s.AltitudeFt, data));
    }

    private static double? Round(double? value, int digits = 0) => value is { } v ? Math.Round(v, digits) : null;
}
