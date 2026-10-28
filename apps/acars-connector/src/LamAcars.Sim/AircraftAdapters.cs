using LamAcars.Core.Models;

namespace LamAcars.Sim;

/// <summary>Variable del simulador (nombre y unidades de SimConnect).</summary>
public sealed record SimVar(string Name, string Units);

/// <summary>Identidad de la aeronave cargada en el simulador.</summary>
public sealed record AircraftIdentity(string Title, string? AtcId, string? AtcModel, string? AtcType)
{
    /// <summary>Designador ICAO deducido de ATC MODEL o del título, si se puede.</summary>
    public string? GuessIcao()
    {
        var model = AtcModel ?? string.Empty;
        // MSFS suele dar claves como "ATCCOM.AC_MODEL_A320.0.text".
        var marker = model.IndexOf("AC_MODEL_", StringComparison.OrdinalIgnoreCase);
        if (marker >= 0)
        {
            var rest = model[(marker + 9)..];
            var code = new string(rest.TakeWhile(char.IsLetterOrDigit).ToArray());
            if (code.Length is >= 2 and <= 4) return code.ToUpperInvariant();
        }
        if (model.Length is >= 3 and <= 4 && model.All(char.IsLetterOrDigit)) return model.ToUpperInvariant();
        return AircraftTypeGuesser.FromTitle(Title);
    }
}

/// <summary>
/// Traduce las variables del simulador a una lectura del contrato. Cada aeronave
/// expone datos distintos: el adaptador declara qué no puede medir y eso no se evalúa.
/// </summary>
public interface IAircraftAdapter
{
    string Name { get; }
    bool Matches(AircraftIdentity aircraft);
    IReadOnlyList<SimVar> Variables { get; }
    IReadOnlyCollection<string> Unavailable { get; }
    SimSample Map(IReadOnlyDictionary<string, double> values, DateTimeOffset time, bool paused);
}

/// <summary>Variables estándar de SimConnect: aeronaves predeterminadas de MSFS 2024 y la mayoría de terceros.</summary>
public class GenericAdapter : IAircraftAdapter
{
    private const double LbToKg = 0.45359237;

    public virtual string Name => "Genérico (SimConnect)";

    public virtual bool Matches(AircraftIdentity aircraft) => true;

    public virtual IReadOnlyCollection<string> Unavailable { get; } = Array.Empty<string>();

    public virtual IReadOnlyList<SimVar> Variables { get; } = new SimVar[]
    {
        new("PLANE LATITUDE", "degrees"),
        new("PLANE LONGITUDE", "degrees"),
        new("PLANE ALTITUDE", "feet"),
        new("PLANE ALT ABOVE GROUND", "feet"),
        new("AIRSPEED INDICATED", "knots"),
        new("AIRSPEED TRUE", "knots"),
        new("GROUND VELOCITY", "knots"),
        new("PLANE HEADING DEGREES TRUE", "degrees"),
        new("VERTICAL SPEED", "feet per minute"),
        new("SIM ON GROUND", "bool"),
        new("NUMBER OF ENGINES", "number"),
        new("GENERAL ENG COMBUSTION:1", "bool"),
        new("GENERAL ENG COMBUSTION:2", "bool"),
        new("GENERAL ENG COMBUSTION:3", "bool"),
        new("GENERAL ENG COMBUSTION:4", "bool"),
        new("PUSHBACK STATE", "enum"),
        new("VELOCITY BODY Z", "feet per second"),
        new("BRAKE PARKING POSITION", "position"),
        new("GEAR HANDLE POSITION", "bool"),
        new("FLAPS HANDLE PERCENT", "percent over 100"),
        new("FUEL TOTAL QUANTITY WEIGHT", "pounds"),
        new("G FORCE", "GForce"),
        new("PLANE PITCH DEGREES", "degrees"),
        new("PLANE BANK DEGREES", "degrees"),
        new("PLANE TOUCHDOWN NORMAL VELOCITY", "feet per second"),
        new("PLANE TOUCHDOWN PITCH DEGREES", "degrees"),
        new("PLANE TOUCHDOWN BANK DEGREES", "degrees"),
        new("IS SLEW ACTIVE", "bool"),
        new("OVERSPEED WARNING", "bool"),
        new("STALL WARNING", "bool"),
    };

    public virtual SimSample Map(IReadOnlyDictionary<string, double> v, DateTimeOffset time, bool paused)
    {
        double? Get(string name) => v.TryGetValue(name, out var x) && double.IsFinite(x) ? x : null;
        bool Flag(string name) => Get(name) is > 0.5;

        var onGround = Flag("SIM ON GROUND");
        var engineCount = (int)Math.Clamp(Get("NUMBER OF ENGINES") ?? 0, 0, 4);
        var running = 0;
        for (var i = 1; i <= Math.Max(engineCount, 1) && i <= 4; i++)
        {
            if (Flag($"GENERAL ENG COMBUSTION:{i}")) running++;
        }

        // SimConnect da el cabeceo positivo con la nariz abajo; el contrato usa nariz arriba positiva.
        var pitch = Get("PLANE PITCH DEGREES") is { } p ? -p : (double?)null;
        var tdPitch = Get("PLANE TOUCHDOWN PITCH DEGREES") is { } tp && Math.Abs(tp) > 0.001 ? -tp : (double?)null;
        var tdBank = Get("PLANE TOUCHDOWN BANK DEGREES") is { } tb && Math.Abs(tb) > 0.001 ? tb : (double?)null;
        var tdNormal = Get("PLANE TOUCHDOWN NORMAL VELOCITY");

        return new SimSample
        {
            Time = time,
            Latitude = Get("PLANE LATITUDE") ?? 0,
            Longitude = Get("PLANE LONGITUDE") ?? 0,
            AltitudeFt = Get("PLANE ALTITUDE") ?? 0,
            AglFt = Get("PLANE ALT ABOVE GROUND"),
            IasKt = Get("AIRSPEED INDICATED"),
            TasKt = Get("AIRSPEED TRUE"),
            GsKt = Math.Max(0, Get("GROUND VELOCITY") ?? 0),
            HeadingDeg = Get("PLANE HEADING DEGREES TRUE"),
            VsFpm = Get("VERTICAL SPEED") ?? 0,
            OnGround = onGround,
            EngineCount = engineCount,
            EnginesRunning = running,
            PushbackActive = Get("PUSHBACK STATE") is { } pb && Math.Round(pb) != 3,
            MovingBackward = onGround && Get("VELOCITY BODY Z") is < -0.8,
            ParkingBrake = Get("BRAKE PARKING POSITION") is > 0.5,
            GearDown = Get("GEAR HANDLE POSITION") is { } gear ? gear > 0.5 : null,
            FlapsRatio = Get("FLAPS HANDLE PERCENT"),
            FuelTotalKg = Get("FUEL TOTAL QUANTITY WEIGHT") is { } lb ? lb * LbToKg : null,
            GForce = Get("G FORCE"),
            PitchDeg = pitch,
            BankDeg = Get("PLANE BANK DEGREES"),
            TouchdownVsFpm = tdNormal is { } n && Math.Abs(n) > 0.001 ? -Math.Abs(n) * 60 : null,
            TouchdownPitchDeg = tdPitch,
            TouchdownBankDeg = tdBank,
            Paused = paused,
            Slew = Flag("IS SLEW ACTIVE"),
            Overspeed = Flag("OVERSPEED WARNING"),
            Stall = Flag("STALL WARNING"),
        };
    }
}

/// <summary>Elige el adaptador según la aeronave. Los adaptadores de PMDG y Fenix se agregan después.</summary>
public static class AdapterRegistry
{
    private static readonly IAircraftAdapter[] Adapters = { new GenericAdapter() };

    public static IAircraftAdapter For(AircraftIdentity aircraft) => Adapters.First(a => a.Matches(aircraft));
}
