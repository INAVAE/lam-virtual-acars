namespace LamAcars.Core.Engine;

/// <summary>
/// Estabiliza el número de motores en marcha. Algunas aeronaves (por ejemplo, el
/// A340-600 probado el 2026-11-01) alternan GENERAL ENG COMBUSTION en cada
/// lectura: 4 en marcha, 0, 4, 0… Sin filtro, cada lectura era un arranque o un
/// apagado, la fase se quedaba en pushback y miles de eventos llenaban la cola.
///
/// La regla: un motor que arranca cuenta de inmediato; un apagado solo cuenta si
/// se mantiene <see cref="Window"/> sin volver a verse en marcha. Es el máximo de
/// las lecturas de la ventana.
/// </summary>
public sealed class EngineCountFilter
{
    public static readonly TimeSpan Window = TimeSpan.FromSeconds(3);

    private readonly Queue<(DateTimeOffset Time, int Running)> _readings = new();

    public int Filter(DateTimeOffset time, int running)
    {
        // Si el reloj retrocede (cambio de hora del sistema), se empieza de nuevo.
        if (_readings.Count > 0 && time < _readings.Last().Time) _readings.Clear();
        _readings.Enqueue((time, running));
        while (_readings.Count > 1 && time - _readings.Peek().Time > Window) _readings.Dequeue();
        var max = 0;
        foreach (var r in _readings) if (r.Running > max) max = r.Running;
        return max;
    }
}

/// <summary>
/// Tope de eventos repetidos: si una aeronave reporta un cambio sin parar, se
/// guardan los primeros <see cref="MaxPerWindow"/> de cada tipo por minuto y una
/// nota que avisa de lo descartado, en lugar de saturar la cola y la red.
/// </summary>
public sealed class EventFloodGuard
{
    public const int MaxPerWindow = 16;
    public static readonly TimeSpan Window = TimeSpan.FromSeconds(60);
    public static readonly TimeSpan NoticeEvery = TimeSpan.FromMinutes(10);

    /// <summary>Tipos que puede repetir una variable inestable; los hitos del vuelo nunca se descartan.</summary>
    public static readonly IReadOnlySet<string> Limited = new HashSet<string>
    {
        Models.FlightEventTypes.EngineStart, Models.FlightEventTypes.EngineShutdown,
        Models.FlightEventTypes.SimPaused, Models.FlightEventTypes.SimResumed,
        Models.FlightEventTypes.Slew, Models.FlightEventTypes.Overspeed, Models.FlightEventTypes.Stall,
    };

    private readonly Dictionary<string, Queue<DateTimeOffset>> _recent = new();
    private readonly Dictionary<string, DateTimeOffset> _lastNotice = new();
    private readonly Dictionary<string, int> _dropped = new();

    /// <summary>Descartados por tipo desde el inicio (para la bitácora y las pruebas).</summary>
    public IReadOnlyDictionary<string, int> Dropped => _dropped;

    public enum Decision { Allow, Drop, DropWithNotice }

    public Decision Check(string type, DateTimeOffset time)
    {
        if (!Limited.Contains(type)) return Decision.Allow;
        if (!_recent.TryGetValue(type, out var q)) _recent[type] = q = new Queue<DateTimeOffset>();
        while (q.Count > 0 && time - q.Peek() > Window) q.Dequeue();
        if (q.Count < MaxPerWindow)
        {
            q.Enqueue(time);
            return Decision.Allow;
        }
        _dropped[type] = _dropped.GetValueOrDefault(type) + 1;
        if (_lastNotice.TryGetValue(type, out var last) && time - last < NoticeEvery) return Decision.Drop;
        _lastNotice[type] = time;
        return Decision.DropWithNotice;
    }
}
