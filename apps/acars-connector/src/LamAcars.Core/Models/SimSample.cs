namespace LamAcars.Core.Models;

/// <summary>
/// Una lectura del simulador. Las unidades son las del contrato ACARS: pies,
/// nudos, pies por minuto, grados (cabeceo positivo = nariz arriba) y kilos.
/// Los valores que la aeronave no expone quedan en null.
/// </summary>
public sealed record SimSample
{
    public required DateTimeOffset Time { get; init; }
    public required double Latitude { get; init; }
    public required double Longitude { get; init; }
    public required double AltitudeFt { get; init; }
    public double? AglFt { get; init; }
    public double? IasKt { get; init; }
    public double? TasKt { get; init; }
    public double GsKt { get; init; }
    public double? HeadingDeg { get; init; }
    public double VsFpm { get; init; }
    public bool OnGround { get; init; }
    public int EnginesRunning { get; init; }
    public int EngineCount { get; init; }
    public bool PushbackActive { get; init; }
    /// <summary>La aeronave se mueve hacia atrás (pushback con remolcadores que no usan PUSHBACK STATE, como GSX).</summary>
    public bool MovingBackward { get; init; }
    public bool ParkingBrake { get; init; }
    public bool? GearDown { get; init; }
    public double? FlapsRatio { get; init; }
    /// <summary>Flaps de borde de salida en grados (posición real, o el retén de la palanca si la aeronave solo da eso).</summary>
    public double? FlapsDeg { get; init; }
    public double? FuelTotalKg { get; init; }
    public double? GForce { get; init; }
    public double? PitchDeg { get; init; }
    public double? BankDeg { get; init; }
    /// <summary>Velocidad vertical en el último contacto con el suelo (PLANE TOUCHDOWN NORMAL VELOCITY), negativa hacia abajo.</summary>
    public double? TouchdownVsFpm { get; init; }
    public double? TouchdownPitchDeg { get; init; }
    public double? TouchdownBankDeg { get; init; }
    public bool Paused { get; init; }
    public bool Slew { get; init; }
    public bool Overspeed { get; init; }
    public bool Stall { get; init; }
}
