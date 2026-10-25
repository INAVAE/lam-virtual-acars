using System.Text;
using System.Text.Json;
using LamAcars.Core.Api;
using LamAcars.Core.Storage;

namespace LamAcars.Core.Sync;

public enum SyncState
{
    Idle,
    Online,
    Offline,
    Unauthorized,
}

/// <summary>
/// Vacía la cola local hacia la API. Orden por sesión: posición viva, eventos,
/// puntos y, al final, el cierre. Ante errores de red o del servidor espera y
/// reintenta sin perder nada; lo que el servidor rechaza por formato se aparta.
/// </summary>
public sealed class SyncWorker
{
    public const int MaxEventsPerCall = 50;
    public const int MaxPointsPerCall = 600;

    private readonly Outbox _outbox;
    private readonly AcarsApiClient _api;
    private readonly Func<TimeSpan, CancellationToken, Task> _delay;
    private int _failures;

    public SyncWorker(Outbox outbox, AcarsApiClient api, Func<TimeSpan, CancellationToken, Task>? delay = null)
    {
        _outbox = outbox;
        _api = api;
        _delay = delay ?? Task.Delay;
    }

    public SyncState State { get; private set; } = SyncState.Idle;
    public string? LastError { get; private set; }
    public DateTimeOffset? LastSuccessAt { get; private set; }

    public event Action<SyncState>? StateChanged;
    public event Action<Guid, string>? SessionClosed;
    public event Action<Guid, SessionEndResponse>? SessionEnded;

    /// <summary>Bucle continuo hasta cancelar.</summary>
    public async Task RunAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            var wait = TimeSpan.FromSeconds(2);
            try
            {
                if (State != SyncState.Unauthorized && await FlushOnceAsync(ct).ConfigureAwait(false) > 0) wait = TimeSpan.FromMilliseconds(200);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            if (State == SyncState.Offline) wait = Backoff();
            try
            {
                await _delay(wait, ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    /// <summary>Permite volver a intentar después de vincular de nuevo el equipo.</summary>
    public void ResetAuthorization()
    {
        if (State == SyncState.Unauthorized) SetState(SyncState.Idle);
    }

    /// <summary>Un paso de envío. Devuelve cuántos elementos se confirmaron.</summary>
    public async Task<int> FlushOnceAsync(CancellationToken ct = default)
    {
        var sent = 0;
        foreach (var sessionId in _outbox.SessionsWithPending())
        {
            try
            {
                sent += await FlushSessionAsync(sessionId, ct).ConfigureAwait(false);
            }
            catch (AcarsApiException e) when (e.IsAuthFailure)
            {
                LastError = e.Message;
                SetState(SyncState.Unauthorized);
                return sent;
            }
            catch (AcarsApiException e) when (e.Code is "session_closed" or "session_not_found")
            {
                _outbox.ForgetSession(sessionId, e.Code);
                SessionClosed?.Invoke(sessionId, e.Code);
            }
            catch (AcarsApiException e) when (e.IsTransient)
            {
                Offline(e.Message);
                return sent;
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
            {
                Offline("Sin conexión con LAM");
                return sent;
            }
        }

        if (sent > 0 || State is SyncState.Offline or SyncState.Idle)
        {
            if (sent > 0) LastSuccessAt = DateTimeOffset.UtcNow;
            _failures = 0;
            if (State != SyncState.Online && (sent > 0 || _outbox.SessionsWithPending().Count == 0)) SetState(SyncState.Online);
        }
        return sent;
    }

    private async Task<int> FlushSessionAsync(Guid sessionId, CancellationToken ct)
    {
        var sent = 0;

        // 1. Posición viva (solo la última).
        var position = _outbox.Peek(sessionId, OutboxKind.Position, 1);
        if (position.Count == 1)
        {
            await SendAsync(position, "position", Wrap(sessionId, "position", position[0].Payload), ct).ConfigureAwait(false);
            sent++;
        }

        // 2. Eventos, en orden.
        while (true)
        {
            var events = _outbox.Peek(sessionId, OutboxKind.Event, MaxEventsPerCall);
            if (events.Count == 0) break;
            await SendAsync(events, "events", WrapArray(sessionId, "events", events), ct).ConfigureAwait(false);
            sent += events.Count;
        }

        // 3. Traza.
        while (true)
        {
            var points = _outbox.Peek(sessionId, OutboxKind.Point, MaxPointsPerCall);
            if (points.Count == 0) break;
            await SendAsync(points, "track-batch", WrapArray(sessionId, "points", points), ct).ConfigureAwait(false);
            sent += points.Count;
        }

        // 4. Cierre, cuando ya no queda nada más de la sesión.
        var end = _outbox.Peek(sessionId, OutboxKind.End, 1);
        if (end.Count == 1 && _outbox.PendingCount(sessionId) == 1)
        {
            var result = await _api.PostRawAsync("session/end", end[0].Payload, ct).ConfigureAwait(false);
            _outbox.Ack([end[0].Id]);
            _outbox.ForgetSession(sessionId, "completed");
            SessionEnded?.Invoke(sessionId, result.Deserialize<SessionEndResponse>(AcarsJson.Options)!);
            sent++;
        }
        return sent;
    }

    private async Task SendAsync(IReadOnlyList<OutboxItem> items, string path, string body, CancellationToken ct)
    {
        try
        {
            await _api.PostRawAsync(path, body, ct).ConfigureAwait(false);
            _outbox.Ack(items.Select(i => i.Id));
        }
        catch (AcarsApiException e) when (e.Status == 400 && e.Code is "bad_request" or "batch_too_large")
        {
            // El servidor nunca aceptará estos datos: se apartan para no bloquear la cola.
            _outbox.DeadLetter(items.Select(i => i.Id), $"{e.Code}: {e.Message}");
        }
        catch (AcarsApiException e) when (!e.IsAuthFailure)
        {
            _outbox.MarkFailed(items.Select(i => i.Id), $"{e.Code}: {e.Message}");
            throw;
        }
    }

    private static string Wrap(Guid sessionId, string property, string payloadJson)
    {
        var sb = new StringBuilder(payloadJson.Length + 80);
        sb.Append("{\"session_id\":\"").Append(sessionId).Append("\",\"").Append(property).Append("\":").Append(payloadJson).Append('}');
        return sb.ToString();
    }

    private static string WrapArray(Guid sessionId, string property, IReadOnlyList<OutboxItem> items)
    {
        var sb = new StringBuilder(items.Sum(i => i.Payload.Length + 1) + 80);
        sb.Append("{\"session_id\":\"").Append(sessionId).Append("\",\"").Append(property).Append("\":[");
        for (var i = 0; i < items.Count; i++)
        {
            if (i > 0) sb.Append(',');
            sb.Append(items[i].Payload);
        }
        sb.Append("]}");
        return sb.ToString();
    }

    private void Offline(string message)
    {
        _failures++;
        LastError = message;
        SetState(SyncState.Offline);
    }

    private TimeSpan Backoff() => TimeSpan.FromSeconds(Math.Min(60, Math.Pow(2, Math.Min(_failures, 6))));

    private void SetState(SyncState state)
    {
        if (State == state) return;
        State = state;
        StateChanged?.Invoke(state);
    }
}
