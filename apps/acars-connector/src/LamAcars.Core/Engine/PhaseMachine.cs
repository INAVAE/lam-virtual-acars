using LamAcars.Core.Models;

namespace LamAcars.Core.Engine;

public sealed record PhaseTransition(FlightPhase From, FlightPhase To, DateTimeOffset At, SimSample Sample, string? Reason);

/// <summary>
/// Máquina de estados de las fases del vuelo. Las reglas, umbrales y tiempos de
/// permanencia están documentados en docs/architecture/flight-phases.md; si se
/// cambia algo aquí, se cambia allá y se agrega una grabación de prueba.
/// </summary>
public sealed class PhaseMachine
{
    // Umbrales (ver documento de fases).
    public const double TaxiSpeedKt = 5;
    public const double TakeoffRollSpeedKt = 40;
    public const double RolloutEndSpeedKt = 30;
    public const double InitialClimbEndAglFt = 1500;
    public const double ApproachAglFt = 3000;
    public const double LevelVsFpm = 300;
    public const double ClimbVsFpm = 500;
    public const double DescentVsFpm = -500;

    private readonly Dictionary<string, DateTimeOffset> _since = new();
    private readonly double? _plannedCruiseFt;

    public PhaseMachine(FlightPhase initial = FlightPhase.AircraftConnected, double? plannedCruiseFt = null)
    {
        Phase = initial;
        _plannedCruiseFt = plannedCruiseFt is > 0 ? plannedCruiseFt : null;
    }

    public FlightPhase Phase { get; private set; }

    /// <summary>Procesa una lectura y devuelve las transiciones que provoca (normalmente ninguna o una).</summary>
    public IReadOnlyList<PhaseTransition> Update(SimSample s)
    {
        // En pausa o con slew el tiempo de permanencia no corre.
        if (s.Paused || s.Slew)
        {
            _since.Clear();
            return Array.Empty<PhaseTransition>();
        }

        var transitions = new List<PhaseTransition>(1);
        for (var i = 0; i < 3; i++)
        {
            var next = Next(s);
            if (next is null) break;
            transitions.Add(new PhaseTransition(Phase, next.Value.Phase, s.Time, s, next.Value.Reason));
            Phase = next.Value.Phase;
            _since.Clear();
        }
        return transitions;
    }

    /// <summary>Verdadero cuando la condición se mantiene al menos <paramref name="seconds"/>.</summary>
    private bool Held(string key, bool condition, DateTimeOffset now, double seconds)
    {
        if (!condition)
        {
            _since.Remove(key);
            return false;
        }
        if (!_since.TryGetValue(key, out var since))
        {
            since = now;
            _since[key] = since;
        }
        return (now - since).TotalSeconds >= seconds;
    }

    private static double Agl(SimSample s) => s.AglFt ?? double.MaxValue;

    private (FlightPhase Phase, string? Reason)? Next(SimSample s)
    {
        var t = s.Time;
        var level = Math.Abs(s.VsFpm) < LevelVsFpm;
        var pushing = s.PushbackActive || s.MovingBackward;

        switch (Phase)
        {
            case FlightPhase.AircraftConnected:
                if (!s.OnGround)
                {
                    if (Agl(s) <= ApproachAglFt && s.VsFpm < 0) return (FlightPhase.Approach, "connected_airborne");
                    if (s.VsFpm > ClimbVsFpm) return (FlightPhase.Climb, "connected_airborne");
                    if (s.VsFpm < DescentVsFpm) return (FlightPhase.Descent, "connected_airborne");
                    return (FlightPhase.Cruise, "connected_airborne");
                }
                if (s.EnginesRunning > 0) return (s.GsKt > TaxiSpeedKt ? FlightPhase.TaxiOut : FlightPhase.EnginesStarted, "connected_on_ground");
                return (FlightPhase.Preflight, null);

            case FlightPhase.Preflight:
                if (Held("engines", s.EnginesRunning > 0, t, 5)) return (FlightPhase.EnginesStarted, null);
                if (Held("pushback", pushing && s.OnGround, t, 2)) return (FlightPhase.Pushback, "pushback_before_start");
                break;

            case FlightPhase.EnginesStarted:
                if (Held("pushback", pushing && s.OnGround, t, 2)) return (FlightPhase.Pushback, null);
                if (Held("taxi", s.OnGround && s.GsKt > TaxiSpeedKt && !pushing, t, 5)) return (FlightPhase.TaxiOut, null);
                if (Held("off", s.EnginesRunning == 0, t, 10)) return (FlightPhase.Preflight, "engines_off_before_departure");
                break;

            case FlightPhase.Pushback:
                if (Held("taxi", s.OnGround && s.GsKt > TaxiSpeedKt && !pushing && s.EnginesRunning > 0, t, 5)) return (FlightPhase.TaxiOut, null);
                // Pushback con motores apagados: se queda aquí hasta que arranquen y rueden.
                break;

            case FlightPhase.TaxiOut:
                if (Held("roll", s.OnGround && s.GsKt >= TakeoffRollSpeedKt, t, 2)) return (FlightPhase.Takeoff, null);
                if (Held("air", !s.OnGround, t, 2)) return (FlightPhase.InitialClimb, "liftoff");
                break;

            case FlightPhase.Takeoff:
                if (Held("air", !s.OnGround, t, 1)) return (FlightPhase.InitialClimb, "liftoff");
                if (Held("rejected", s.OnGround && s.GsKt < RolloutEndSpeedKt, t, 10)) return (FlightPhase.TaxiOut, "rejected_takeoff");
                break;

            case FlightPhase.InitialClimb:
                if (s.OnGround) return (FlightPhase.Landing, "touchdown");
                if (Agl(s) != double.MaxValue ? s.AglFt >= InitialClimbEndAglFt : Held("climb", s.VsFpm > 0, t, 60))
                    return (FlightPhase.Climb, null);
                break;

            case FlightPhase.Climb:
                if (s.OnGround) return (FlightPhase.Landing, "touchdown");
                if (Held("level", level && ReachedCruise(s), t, 60)) return (FlightPhase.Cruise, null);
                if (Held("descent", s.VsFpm < DescentVsFpm, t, 30)) return (FlightPhase.Descent, null);
                break;

            case FlightPhase.Cruise:
                if (s.OnGround) return (FlightPhase.Landing, "touchdown");
                if (Held("climb", s.VsFpm > ClimbVsFpm, t, 60)) return (FlightPhase.Climb, "step_climb");
                if (Held("descent", s.VsFpm < DescentVsFpm, t, 30)) return (FlightPhase.Descent, null);
                break;

            case FlightPhase.Descent:
                if (s.OnGround) return (FlightPhase.Landing, "touchdown");
                if (Held("approach", Agl(s) <= ApproachAglFt, t, 5)) return (FlightPhase.Approach, null);
                if (Held("climb", s.VsFpm > ClimbVsFpm, t, 60)) return (FlightPhase.Climb, "climb_during_descent");
                break;

            case FlightPhase.Approach:
                if (s.OnGround) return (FlightPhase.Landing, "touchdown");
                if (Held("goaround", s.VsFpm > ClimbVsFpm && Agl(s) > 300, t, 15)) return (FlightPhase.Climb, "go_around");
                break;

            case FlightPhase.Landing:
                if (Held("touchgo", !s.OnGround && s.VsFpm > LevelVsFpm, t, 10)) return (FlightPhase.Climb, "touch_and_go");
                if (Held("rollout", s.OnGround && s.GsKt < RolloutEndSpeedKt, t, 5)) return (FlightPhase.TaxiIn, null);
                break;

            case FlightPhase.TaxiIn:
                if (Held("off", s.EnginesRunning == 0 && s.GsKt < 2, t, 5)) return (FlightPhase.EnginesShutdown, null);
                break;

            case FlightPhase.EnginesShutdown:
                if (Held("restart", s.EnginesRunning > 0, t, 10)) return (FlightPhase.TaxiIn, "engines_restarted");
                if (Held("parked", s.EnginesRunning == 0 && s.GsKt < 1 && s.ParkingBrake, t, 5)) return (FlightPhase.FlightCompleted, "parking_brake");
                if (Held("stopped", s.EnginesRunning == 0 && s.GsKt < 1, t, 60)) return (FlightPhase.FlightCompleted, "stopped");
                break;

            case FlightPhase.FlightCompleted:
                break;
        }
        return null;
    }

    /// <summary>Crucero: nivelado en (o cerca de) el nivel planeado; sin plan, arriba de 10,000 ft o 5,000 ft AGL.</summary>
    private bool ReachedCruise(SimSample s)
    {
        if (_plannedCruiseFt is { } planned) return s.AltitudeFt >= planned - 4000;
        return s.AltitudeFt >= 10000 || Agl(s) is >= 5000 and < double.MaxValue;
    }
}
