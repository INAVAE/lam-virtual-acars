using LamAcars.Core.Models;

namespace LamAcars.Core.Engine;

/// <summary>Métricas del contacto con la pista, calculadas en el conector con todas las lecturas disponibles.</summary>
public sealed record LandingMetrics(
    DateTimeOffset TouchdownAt,
    double Latitude,
    double Longitude,
    double AltitudeFt,
    double VsFpm,
    string VsSource,
    double? GForceMax,
    double? PitchDeg,
    double? BankDeg,
    double? IasKt,
    double GsKt,
    double? HeadingDeg,
    double? FlapsDeg = null,
    bool? GearDown = null)
{
    public IReadOnlyDictionary<string, object?> ToData(int bounces) => new Dictionary<string, object?>
    {
        ["vs_fpm"] = Math.Round(VsFpm, 1),
        ["vs_source"] = VsSource,
        ["g_force"] = GForceMax is { } g ? Math.Round(g, 2) : null,
        ["pitch_deg"] = PitchDeg is { } p ? Math.Round(p, 1) : null,
        ["bank_deg"] = BankDeg is { } b ? Math.Round(b, 1) : null,
        ["ias_kt"] = IasKt is { } ias ? Math.Round(ias) : null,
        ["gs_kt"] = Math.Round(GsKt),
        ["heading_deg"] = HeadingDeg is { } h ? Math.Round(h) : null,
        ["bounces"] = bounces,
        ["flaps_deg"] = FlapsDeg is { } f ? Math.Round(f, 1) : null,
        ["gear_down"] = GearDown,
    };
}

/// <summary>
/// Guarda una ventana corta de lecturas y, al tocar pista, calcula la velocidad
/// vertical, la fuerza G máxima (de 1 s antes a 2.5 s después del contacto),
/// cabeceo, alabeo y velocidades. Cuenta rebotes mientras dura el aterrizaje.
/// </summary>
public sealed class LandingAnalyzer
{
    private static readonly TimeSpan Before = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan After = TimeSpan.FromSeconds(2.5);
    private static readonly TimeSpan BufferSpan = TimeSpan.FromSeconds(8);

    private readonly LinkedList<SimSample> _buffer = new();
    private SimSample? _touchdown;
    private SimSample? _lastAirborne;
    private bool _wasOnGround = true;
    private DateTimeOffset? _airborneSince;

    public int Bounces { get; private set; }

    /// <summary>Se llama con cada lectura. Devuelve las métricas cuando se cumple la ventana posterior al contacto.</summary>
    public LandingMetrics? Add(SimSample s, bool inLanding)
    {
        _buffer.AddLast(s);
        while (_buffer.First is { } first && s.Time - first.Value.Time > BufferSpan) _buffer.RemoveFirst();

        if (!s.OnGround) _lastAirborne = s;

        if (inLanding && _touchdown is null) _touchdown = s;

        // Rebotes: en el aterrizaje, despegar más de 0.3 s y volver a tocar.
        if (inLanding)
        {
            if (!s.OnGround && _wasOnGround) _airborneSince = s.Time;
            if (s.OnGround && !_wasOnGround && _airborneSince is { } since && (s.Time - since).TotalSeconds > 0.3) Bounces++;
        }
        _wasOnGround = s.OnGround;

        if (_touchdown is { } td && !Emitted && s.Time - td.Time >= After)
        {
            Emitted = true;
            return Compute(td);
        }
        return null;
    }

    public bool Emitted { get; private set; }

    /// <summary>Prepara un nuevo aterrizaje (después de un toque y despegue o un motor y al aire).</summary>
    public void Reset()
    {
        _touchdown = null;
        Emitted = false;
        Bounces = 0;
        _airborneSince = null;
    }

    private LandingMetrics Compute(SimSample td)
    {
        var window = _buffer.Where(x => x.Time >= td.Time - Before && x.Time <= td.Time + After).ToList();
        var after = window.Where(x => x.Time >= td.Time).ToList();
        var gMax = window.Where(x => x.GForce.HasValue).Select(x => x.GForce!.Value).DefaultIfEmpty().Max();
        var hasG = window.Any(x => x.GForce.HasValue);

        // MSFS actualiza las variables PLANE TOUCHDOWN * un instante después del contacto y,
        // antes, conservan el valor del aterrizaje anterior: solo cuentan si cambiaron.
        var before = _lastAirborne;
        double? Fresh(Func<SimSample, double?> get) =>
            after.Select(get).FirstOrDefault(v => v is { } x && Math.Abs(x) > 0.001 && (before is null || get(before) is not { } old || Math.Abs(old - x) > 0.001));

        double vs;
        string source;
        if (Fresh(x => x.TouchdownVsFpm) is { } tdv)
        {
            vs = -Math.Abs(tdv);
            source = "touchdown_normal_velocity";
        }
        else
        {
            // Sin la variable del simulador: la última velocidad vertical en el aire.
            vs = _buffer.LastOrDefault(x => !x.OnGround && x.Time <= td.Time)?.VsFpm ?? td.VsFpm;
            source = "vertical_speed";
        }

        return new LandingMetrics(
            td.Time,
            td.Latitude,
            td.Longitude,
            td.AltitudeFt,
            vs,
            source,
            hasG ? gMax : null,
            Fresh(x => x.TouchdownPitchDeg) ?? td.PitchDeg,
            Fresh(x => x.TouchdownBankDeg) ?? td.BankDeg,
            td.IasKt,
            td.GsKt,
            td.HeadingDeg,
            td.FlapsDeg,
            td.GearDown);
    }
}
