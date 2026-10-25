namespace LamAcars.Core.Models;

/// <summary>Fases del vuelo (docs/architecture/flight-phases.md). El orden es el de un vuelo normal.</summary>
public enum FlightPhase
{
    AircraftConnected,
    Preflight,
    EnginesStarted,
    Pushback,
    TaxiOut,
    Takeoff,
    InitialClimb,
    Climb,
    Cruise,
    Descent,
    Approach,
    Landing,
    TaxiIn,
    EnginesShutdown,
    FlightCompleted,
}

public static class FlightPhaseExtensions
{
    private static readonly Dictionary<FlightPhase, string> Wire = new()
    {
        [FlightPhase.AircraftConnected] = "aircraft_connected",
        [FlightPhase.Preflight] = "preflight",
        [FlightPhase.EnginesStarted] = "engines_started",
        [FlightPhase.Pushback] = "pushback",
        [FlightPhase.TaxiOut] = "taxi_out",
        [FlightPhase.Takeoff] = "takeoff",
        [FlightPhase.InitialClimb] = "initial_climb",
        [FlightPhase.Climb] = "climb",
        [FlightPhase.Cruise] = "cruise",
        [FlightPhase.Descent] = "descent",
        [FlightPhase.Approach] = "approach",
        [FlightPhase.Landing] = "landing",
        [FlightPhase.TaxiIn] = "taxi_in",
        [FlightPhase.EnginesShutdown] = "engines_shutdown",
        [FlightPhase.FlightCompleted] = "flight_completed",
    };

    private static readonly Dictionary<FlightPhase, string> Labels = new()
    {
        [FlightPhase.AircraftConnected] = "Aeronave conectada",
        [FlightPhase.Preflight] = "Prevuelo",
        [FlightPhase.EnginesStarted] = "Motores encendidos",
        [FlightPhase.Pushback] = "Pushback",
        [FlightPhase.TaxiOut] = "Rodaje de salida",
        [FlightPhase.Takeoff] = "Despegue",
        [FlightPhase.InitialClimb] = "Ascenso inicial",
        [FlightPhase.Climb] = "Ascenso",
        [FlightPhase.Cruise] = "Crucero",
        [FlightPhase.Descent] = "Descenso",
        [FlightPhase.Approach] = "Aproximación",
        [FlightPhase.Landing] = "Aterrizaje",
        [FlightPhase.TaxiIn] = "Rodaje de llegada",
        [FlightPhase.EnginesShutdown] = "Motores apagados",
        [FlightPhase.FlightCompleted] = "Vuelo completado",
    };

    /// <summary>Nombre en el contrato ACARS v1.</summary>
    public static string ToWire(this FlightPhase phase) => Wire[phase];

    /// <summary>Nombre para el piloto.</summary>
    public static string ToLabel(this FlightPhase phase) => Labels[phase];

    public static FlightPhase FromWire(string value)
    {
        foreach (var (phase, wire) in Wire)
        {
            if (wire == value) return phase;
        }
        throw new ArgumentException($"Fase desconocida: {value}", nameof(value));
    }

    public static bool IsAirborne(this FlightPhase phase) =>
        phase is FlightPhase.InitialClimb or FlightPhase.Climb or FlightPhase.Cruise or FlightPhase.Descent or FlightPhase.Approach;
}
