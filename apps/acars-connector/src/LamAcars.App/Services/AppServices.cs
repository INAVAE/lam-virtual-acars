using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using LamAcars.Core.Api;
using LamAcars.Core.Models;

namespace LamAcars.App.Services;

/// <summary>Carpetas del conector en %LOCALAPPDATA%\LamAcars.</summary>
public static class AppPaths
{
    public static string Root { get; } = Directory.CreateDirectory(
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LamAcars")).FullName;

    public static string Database => Path.Combine(Root, "acars.db");
    public static string Token => Path.Combine(Root, "device.bin");
    public static string Settings => Path.Combine(Root, "settings.json");
    public static string Logs => Directory.CreateDirectory(Path.Combine(Root, "logs")).FullName;
    public static string Recordings => Directory.CreateDirectory(Path.Combine(Root, "recordings")).FullName;

    public static string Version { get; } =
        typeof(AppPaths).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion.Split('+')[0]
        ?? "0.0.0";
}

/// <summary>Ajustes locales (por ahora solo la URL de la API, para pruebas).</summary>
public sealed class AppSettings
{
    public string ApiBaseUrl { get; set; } = AcarsApiClient.DefaultBaseUrl;
    public bool RecordSamples { get; set; } = true;

    public static AppSettings Load()
    {
        try
        {
            if (File.Exists(AppPaths.Settings))
                return JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(AppPaths.Settings)) ?? new AppSettings();
        }
        catch (Exception e) when (e is IOException or JsonException)
        {
            // Archivo dañado: se usan los valores por omisión.
        }
        var defaults = new AppSettings();
        File.WriteAllText(AppPaths.Settings, JsonSerializer.Serialize(defaults, new JsonSerializerOptions { WriteIndented = true }));
        return defaults;
    }
}

/// <summary>
/// Token del dispositivo cifrado con DPAPI de Windows (solo este usuario de
/// Windows en este equipo puede leerlo).
/// </summary>
public static class TokenStore
{
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("LAM ACARS device token v1");

    public static string? Load()
    {
        try
        {
            if (!File.Exists(AppPaths.Token)) return null;
            var plain = ProtectedData.Unprotect(File.ReadAllBytes(AppPaths.Token), Entropy, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(plain);
        }
        catch (Exception e) when (e is CryptographicException or IOException)
        {
            return null;
        }
    }

    public static void Save(string token) =>
        File.WriteAllBytes(AppPaths.Token, ProtectedData.Protect(Encoding.UTF8.GetBytes(token), Entropy, DataProtectionScope.CurrentUser));

    public static void Clear()
    {
        try
        {
            File.Delete(AppPaths.Token);
        }
        catch (IOException)
        {
            // Si no se puede borrar, al menos ya no se usa.
        }
    }
}

/// <summary>Bitácora en archivo (un archivo por día) y en memoria para la ventana.</summary>
public sealed class AppLog
{
    private readonly object _gate = new();
    private readonly LinkedList<string> _recent = new();

    public event Action<string>? Line;

    public IReadOnlyList<string> Recent
    {
        get
        {
            lock (_gate) return _recent.ToList();
        }
    }

    public void Write(string message)
    {
        var line = $"{DateTime.Now:HH:mm:ss}  {message}";
        lock (_gate)
        {
            _recent.AddLast(line);
            while (_recent.Count > 300) _recent.RemoveFirst();
            try
            {
                File.AppendAllText(Path.Combine(AppPaths.Logs, $"acars-{DateTime.UtcNow:yyyyMMdd}.log"), $"{DateTime.UtcNow:O} {message}{Environment.NewLine}");
            }
            catch (IOException)
            {
                // La bitácora nunca debe detener el vuelo.
            }
        }
        Line?.Invoke(line);
    }
}

/// <summary>
/// Guarda una lectura por segundo durante el vuelo (JSON por línea). Sirve para
/// diagnosticar fases y para agregar grabaciones reales a las pruebas.
/// </summary>
public sealed class SampleRecorder : IDisposable
{
    private static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };
    private readonly StreamWriter _writer;
    private DateTimeOffset _last = DateTimeOffset.MinValue;

    public SampleRecorder(string callsign)
    {
        Path = System.IO.Path.Combine(AppPaths.Recordings, $"{DateTime.UtcNow:yyyyMMdd-HHmm}-{callsign}.jsonl");
        _writer = new StreamWriter(Path, append: true, Encoding.UTF8) { AutoFlush = false };
    }

    public string Path { get; }

    public void Add(SimSample s)
    {
        if (s.Time - _last < TimeSpan.FromSeconds(1) && s.OnGround == _lastOnGround) return;
        _last = s.Time;
        _lastOnGround = s.OnGround;
        _writer.WriteLine(JsonSerializer.Serialize(s, Options));
        if (++_count % 30 == 0) _writer.Flush();
    }

    private bool _lastOnGround;
    private int _count;

    public void Dispose()
    {
        _writer.Flush();
        _writer.Dispose();
    }
}
