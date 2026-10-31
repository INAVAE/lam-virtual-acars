using System.Net.Http.Headers;
using System.Text.Json;

namespace LamAcars.Core.Updates;

/// <summary>Versión publicada del conector.</summary>
public sealed record ReleaseInfo(Version Version, string Tag, string PageUrl, string? DownloadUrl, string? Notes, DateTimeOffset? PublishedAt);

/// <summary>
/// Busca en las publicaciones de GitHub la versión más nueva del conector
/// (etiquetas connector-vX.Y.Z, sin borradores). Solo avisa: no descarga nada.
/// </summary>
public sealed class UpdateChecker
{
    public const string ReleasesApi = "https://api.github.com/repos/INAVAE/lam-virtual-acars/releases?per_page=20";
    public const string TagPrefix = "connector-v";

    private readonly HttpClient _http;

    public UpdateChecker(HttpClient http) => _http = http;

    /// <summary>La versión más nueva si es mayor que <paramref name="current"/>; null si ya está al día o no se pudo consultar.</summary>
    public async Task<ReleaseInfo?> CheckAsync(string current, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, ReleasesApi);
        request.Headers.UserAgent.Add(new ProductInfoHeaderValue("LamAcars", Normalize(current)?.ToString() ?? "0"));
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        using var response = await _http.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode) return null;
        var json = await response.Content.ReadAsStringAsync(ct);
        return Newer(Latest(json), current);
    }

    /// <summary>La publicación del conector con la versión más alta (ignora borradores y otras etiquetas).</summary>
    public static ReleaseInfo? Latest(string releasesJson)
    {
        using var doc = JsonDocument.Parse(releasesJson);
        if (doc.RootElement.ValueKind != JsonValueKind.Array) return null;
        ReleaseInfo? best = null;
        foreach (var r in doc.RootElement.EnumerateArray())
        {
            if (r.TryGetProperty("draft", out var draft) && draft.ValueKind == JsonValueKind.True) continue;
            var tag = r.TryGetProperty("tag_name", out var t) ? t.GetString() : null;
            if (tag is null || !tag.StartsWith(TagPrefix, StringComparison.Ordinal)) continue;
            if (Normalize(tag[TagPrefix.Length..]) is not { } version) continue;
            if (best is not null && version <= best.Version) continue;

            string? download = null;
            if (r.TryGetProperty("assets", out var assets) && assets.ValueKind == JsonValueKind.Array)
            {
                foreach (var a in assets.EnumerateArray())
                {
                    var name = a.TryGetProperty("name", out var n) ? n.GetString() : null;
                    if (name is not null && name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                    {
                        download = a.TryGetProperty("browser_download_url", out var u) ? u.GetString() : null;
                        break;
                    }
                }
            }
            DateTimeOffset? published = r.TryGetProperty("published_at", out var p) && p.ValueKind == JsonValueKind.String
                && DateTimeOffset.TryParse(p.GetString(), out var at) ? at : null;
            best = new ReleaseInfo(version, tag,
                r.TryGetProperty("html_url", out var html) ? html.GetString() ?? string.Empty : string.Empty,
                download,
                r.TryGetProperty("body", out var body) ? body.GetString() : null,
                published);
        }
        return best;
    }

    public static ReleaseInfo? Newer(ReleaseInfo? latest, string current) =>
        latest is not null && Normalize(current) is { } cur && latest.Version > cur ? latest : null;

    /// <summary>"0.1.19", "v0.1.19" o "0.1.19+abc" → 0.1.19.</summary>
    public static Version? Normalize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var v = value.Trim().TrimStart('v', 'V').Split('+', '-')[0];
        if (!Version.TryParse(v, out var parsed)) return null;
        return new Version(parsed.Major, parsed.Minor, Math.Max(0, parsed.Build));
    }
}
