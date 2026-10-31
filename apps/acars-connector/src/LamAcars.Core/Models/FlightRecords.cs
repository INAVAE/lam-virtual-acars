namespace LamAcars.Core.Models;

/// <summary>Tipos de evento del contrato ACARS v1.</summary>
public static class FlightEventTypes
{
    public const string PhaseChange = "phase_change";
    public const string BlockOff = "block_off";
    public const string Takeoff = "takeoff";
    public const string Touchdown = "touchdown";
    public const string BlockOn = "block_on";
    public const string EngineStart = "engine_start";
    public const string EngineShutdown = "engine_shutdown";
    public const string SimPaused = "sim_paused";
    public const string SimResumed = "sim_resumed";
    public const string Slew = "slew";
    public const string Crash = "crash";
    public const string Overspeed = "overspeed";
    public const string Stall = "stall";
    public const string AircraftChanged = "aircraft_changed";
    public const string ConnectionLost = "connection_lost";
    public const string ConnectionRestored = "connection_restored";
    public const string Note = "note";
}

/// <summary>Evento listo para la cola local. El id lo genera el conector y el servidor descarta duplicados.</summary>
public sealed record FlightEventRecord(
    Guid Id,
    int Seq,
    string Type,
    FlightPhase Phase,
    DateTimeOffset OccurredAt,
    double? Latitude,
    double? Longitude,
    double? AltitudeFt,
    IReadOnlyDictionary<string, object?> Data);

public sealed record TrackPointRecord(
    int Seq,
    DateTimeOffset SampledAt,
    double Latitude,
    double Longitude,
    double AltitudeFt,
    double? GsKt,
    double? IasKt,
    double? VsFpm,
    double? HeadingDeg,
    bool OnGround,
    FlightPhase Phase,
    double? FuelKg = null);

public sealed record PositionRecord(
    DateTimeOffset SampledAt,
    double Latitude,
    double Longitude,
    double AltitudeFt,
    double? AglFt,
    double? IasKt,
    double? GsKt,
    double? HeadingDeg,
    double? VsFpm,
    bool OnGround,
    FlightPhase Phase);
