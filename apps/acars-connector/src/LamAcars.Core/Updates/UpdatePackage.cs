using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace LamAcars.Core.Updates;

/// <summary>
/// Descarga, verificación e instalación de una versión nueva del conector.
///
/// El conector es una carpeta portátil (LamAcars.exe y sus archivos); los datos
/// del piloto (token, cola, bitácora) viven en %LOCALAPPDATA%\LamAcars y no se
/// tocan. Para instalar: se descarga el zip publicado, se compara su SHA-256 con
/// el de la publicación, se descomprime en una carpeta de trabajo y un script de
/// PowerShell espera a que el conector se cierre, copia los archivos nuevos sobre
/// la carpeta actual y lo vuelve a abrir.
/// </summary>
public static partial class UpdatePackage
{
    public const string ExeName = "LamAcars.exe";

    [GeneratedRegex(@"\b[0-9a-fA-F]{64}\b")]
    private static partial Regex Sha256Pattern();

    /// <summary>La suma SHA-256 de un archivo .sha256 («hash  nombre»); null si no trae una.</summary>
    public static string? ParseSha256(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var m = Sha256Pattern().Match(text);
        return m.Success ? m.Value.ToLowerInvariant() : null;
    }

    /// <summary>SHA-256 de un archivo en hexadecimal (minúsculas).</summary>
    public static string ComputeSha256(string path)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }

    /// <summary>Descomprime el paquete en <paramref name="destination"/> (vacía) y devuelve la carpeta que contiene LamAcars.exe.</summary>
    public static string Extract(string zipPath, string destination)
    {
        if (Directory.Exists(destination)) Directory.Delete(destination, recursive: true);
        Directory.CreateDirectory(destination);
        ZipFile.ExtractToDirectory(zipPath, destination);
        return FindPackageRoot(destination)
            ?? throw new InvalidDataException($"El paquete no trae {ExeName}");
    }

    /// <summary>La carpeta con LamAcars.exe: la raíz o la primera subcarpeta que lo tenga (el zip trae la carpeta LamAcars).</summary>
    public static string? FindPackageRoot(string directory)
    {
        if (File.Exists(Path.Combine(directory, ExeName))) return directory;
        foreach (var sub in Directory.EnumerateDirectories(directory).OrderBy(d => d, StringComparer.OrdinalIgnoreCase))
        {
            if (File.Exists(Path.Combine(sub, ExeName))) return sub;
        }
        return null;
    }

    /// <summary>¿Se puede escribir en la carpeta del conector? (Por ejemplo, no en Archivos de programa sin permisos.)</summary>
    public static bool CanWrite(string directory)
    {
        try
        {
            var probe = Path.Combine(directory, $".lam-update-{Guid.NewGuid():N}.tmp");
            File.WriteAllText(probe, "ok");
            File.Delete(probe);
            return true;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    private static string Quote(string value) => "'" + value.Replace("'", "''") + "'";

    /// <summary>
    /// Script de PowerShell que espera a que termine el proceso <paramref name="pid"/>,
    /// copia la versión nueva sobre la carpeta actual y abre el conector. Si la copia
    /// falla, abre la carpeta con la versión nueva para copiarla a mano y vuelve a
    /// abrir la versión anterior.
    /// </summary>
    public static string BuildSwapScript(int pid, string sourceDir, string targetDir, string logPath)
    {
        var sb = new StringBuilder();
        sb.AppendLine("$ErrorActionPreference = 'Stop'");
        sb.AppendLine($"$log = {Quote(logPath)}");
        sb.AppendLine($"$source = {Quote(sourceDir)}");
        sb.AppendLine($"$target = {Quote(targetDir)}");
        sb.AppendLine("function Write-Log($m) { Add-Content -Path $log -Value ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + ' ' + $m) }");
        sb.AppendLine("try {");
        sb.AppendLine($"  Wait-Process -Id {pid} -Timeout 90 -ErrorAction SilentlyContinue");
        sb.AppendLine("  Start-Sleep -Seconds 1");
        sb.AppendLine("  Write-Log 'Instalando la versión nueva'");
        sb.AppendLine("  for ($i = 1; $i -le 5; $i++) {");
        sb.AppendLine("    try { Copy-Item -Path (Join-Path $source '*') -Destination $target -Recurse -Force; break }");
        sb.AppendLine("    catch { if ($i -eq 5) { throw }; Start-Sleep -Seconds 2 }");
        sb.AppendLine("  }");
        sb.AppendLine("  Write-Log 'Versión nueva instalada'");
        sb.AppendLine("} catch {");
        sb.AppendLine("  Write-Log ('No se pudo instalar: ' + $_.Exception.Message)");
        sb.AppendLine("  Start-Process -FilePath 'explorer.exe' -ArgumentList $source");
        sb.AppendLine("}");
        sb.AppendLine($"Start-Process -FilePath (Join-Path $target {Quote(ExeName)}) -WorkingDirectory $target");
        return sb.ToString();
    }
}
