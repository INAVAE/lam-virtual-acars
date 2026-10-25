using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

namespace LamAcars.Core.Api;

/// <summary>Error con código estable del contrato (invalid_token, session_closed, rate_limited, …).</summary>
public sealed class AcarsApiException(int status, string code, string message) : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;

    /// <summary>El dispositivo ya no puede enviar datos: hay que vincularlo de nuevo.</summary>
    public bool IsAuthFailure => Status == 401;

    /// <summary>Vale la pena reintentar más tarde (límite o error del servidor).</summary>
    public bool IsTransient => Status is 429 or >= 500;
}

/// <summary>Cliente HTTP de la API ACARS v1. Los errores de red se propagan como HttpRequestException o TaskCanceledException.</summary>
public sealed class AcarsApiClient
{
    /// <summary>API de producción (Edge Function `acars` del proyecto LAM ACARS).</summary>
    public const string DefaultBaseUrl = "https://fnsfgjtmwfiizofsjajm.supabase.co/functions/v1/acars/v1/";

    private readonly HttpClient _http;

    public AcarsApiClient(HttpClient http, string? baseUrl = null)
    {
        _http = http;
        _http.BaseAddress ??= new Uri(baseUrl ?? DefaultBaseUrl);
        _http.Timeout = TimeSpan.FromSeconds(20);
    }

    /// <summary>Token del dispositivo (lamd_…). Sin token solo funcionan la salud y la vinculación.</summary>
    public string? Token { get; set; }

    public Task<LinkStartResponse> LinkStartAsync(LinkStartRequest body, CancellationToken ct = default) =>
        SendAsync<LinkStartResponse>(HttpMethod.Post, "link/start", body, auth: false, ct);

    public Task<LinkPollResponse> LinkPollAsync(LinkPollRequest body, CancellationToken ct = default) =>
        SendAsync<LinkPollResponse>(HttpMethod.Post, "link/poll", body, auth: false, ct);

    public Task<MeResponse> MeAsync(CancellationToken ct = default) =>
        SendAsync<MeResponse>(HttpMethod.Get, "me", null, auth: true, ct);

    public Task<SessionStartResponse> SessionStartAsync(SessionStartRequest body, CancellationToken ct = default) =>
        SendAsync<SessionStartResponse>(HttpMethod.Post, "session/start", body, auth: true, ct);

    public Task PositionAsync(PositionRequest body, CancellationToken ct = default) =>
        SendAsync<JsonElement>(HttpMethod.Post, "position", body, auth: true, ct);

    public Task<IngestResponse> TrackBatchAsync(TrackBatchRequest body, CancellationToken ct = default) =>
        SendAsync<IngestResponse>(HttpMethod.Post, "track-batch", body, auth: true, ct);

    public Task<IngestResponse> EventsAsync(EventsRequest body, CancellationToken ct = default) =>
        SendAsync<IngestResponse>(HttpMethod.Post, "events", body, auth: true, ct);

    public Task<SessionEndResponse> SessionEndAsync(SessionEndRequest body, CancellationToken ct = default) =>
        SendAsync<SessionEndResponse>(HttpMethod.Post, "session/end", body, auth: true, ct);

    /// <summary>Envía un cuerpo ya serializado (desde la cola local).</summary>
    public Task<JsonElement> PostRawAsync(string path, string json, CancellationToken ct = default) =>
        SendRawAsync(HttpMethod.Post, path, json, ct);

    private async Task<T> SendAsync<T>(HttpMethod method, string path, object? body, bool auth, CancellationToken ct)
    {
        var json = body is null ? null : JsonSerializer.Serialize(body, body.GetType(), AcarsJson.Options);
        var element = await SendRawAsync(method, path, json, ct, auth).ConfigureAwait(false);
        return element.Deserialize<T>(AcarsJson.Options)!;
    }

    private async Task<JsonElement> SendRawAsync(HttpMethod method, string path, string? json, CancellationToken ct, bool auth = true)
    {
        using var request = new HttpRequestMessage(method, path);
        if (json is not null) request.Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json");
        if (auth)
        {
            if (string.IsNullOrEmpty(Token)) throw new AcarsApiException(401, "invalid_token", "El equipo no está vinculado");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
        }

        using var response = await _http.SendAsync(request, ct).ConfigureAwait(false);
        var text = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (response.IsSuccessStatusCode)
        {
            return string.IsNullOrWhiteSpace(text) ? default : JsonDocument.Parse(text).RootElement.Clone();
        }

        var (code, message) = ParseError(text, response.StatusCode);
        throw new AcarsApiException((int)response.StatusCode, code, message);
    }

    private static (string Code, string Message) ParseError(string text, HttpStatusCode status)
    {
        try
        {
            var envelope = JsonSerializer.Deserialize<ApiErrorEnvelope>(text, AcarsJson.Options);
            if (envelope?.Error is { } e) return (e.Code, e.Message);
        }
        catch (JsonException)
        {
            // Respuesta sin el formato del contrato (por ejemplo, de la pasarela).
        }
        return ((int)status >= 500 ? "server_error" : "http_" + (int)status, $"El servidor respondió {(int)status}");
    }
}
