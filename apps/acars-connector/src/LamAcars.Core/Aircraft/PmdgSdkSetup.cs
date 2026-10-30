namespace LamAcars.Core.Aircraft;

/// <summary>Archivo de opciones de un avión PMDG y si ya publica sus datos.</summary>
public sealed record PmdgOptionsFile(string Path, string Package, bool Enabled);

/// <summary>
/// Activa la publicación de datos del SDK de PMDG ([SDK] EnableDataBroadcast=1
/// en el *_Options.ini de cada avión). PMDG indica que la aplicación que usa el
/// SDK debe dejar este ajuste puesto en el equipo del piloto.
/// </summary>
public static class PmdgSdkSetup
{
    private const string Section = "SDK";
    private const string Key = "EnableDataBroadcast";

    /// <summary>Carpetas donde MSFS 2024 y 2020 (Microsoft Store y Steam) guardan el almacenamiento persistente de los aviones.</summary>
    public static IEnumerable<string> DefaultRoots()
    {
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        yield return Path.Combine(local, "Packages", "Microsoft.Limitless_8wekyb3d8bbwe", "LocalState", "WASM", "MSFS2024");
        yield return Path.Combine(roaming, "Microsoft Flight Simulator 2024", "WASM", "MSFS2024");
        yield return Path.Combine(local, "Packages", "Microsoft.FlightSimulator_8wekyb3d8bbwe", "LocalState", "packages");
        yield return Path.Combine(roaming, "Microsoft Flight Simulator", "Packages");
    }

    /// <summary>Busca pmdg-aircraft-*\work\*_Options.ini en las carpetas indicadas.</summary>
    public static IReadOnlyList<PmdgOptionsFile> Find(IEnumerable<string> roots)
    {
        var found = new List<PmdgOptionsFile>();
        foreach (var root in roots.Where(Directory.Exists))
        {
            IEnumerable<string> packages;
            try
            {
                packages = Directory.EnumerateDirectories(root, "pmdg-aircraft-*");
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                continue;
            }
            foreach (var package in packages)
            {
                var work = Path.Combine(package, "work");
                if (!Directory.Exists(work)) continue;
                foreach (var file in Directory.EnumerateFiles(work, "*_Options.ini"))
                {
                    string text;
                    try
                    {
                        text = File.ReadAllText(file);
                    }
                    catch (Exception e) when (e is IOException or UnauthorizedAccessException)
                    {
                        continue;
                    }
                    found.Add(new PmdgOptionsFile(file, Path.GetFileName(package), IsEnabled(text)));
                }
            }
        }
        return found;
    }

    /// <summary>Pone EnableDataBroadcast=1 en los archivos que no lo tienen (guarda una copia .lam-backup). Devuelve los modificados.</summary>
    public static IReadOnlyList<PmdgOptionsFile> EnableAll(IEnumerable<PmdgOptionsFile> files)
    {
        var changed = new List<PmdgOptionsFile>();
        foreach (var file in files.Where(f => !f.Enabled))
        {
            var text = File.ReadAllText(file.Path);
            var updated = Enable(text);
            if (updated == text) continue;
            File.Copy(file.Path, file.Path + ".lam-backup", overwrite: true);
            File.WriteAllText(file.Path, updated);
            changed.Add(file with { Enabled = true });
        }
        return changed;
    }

    public static bool IsEnabled(string ini)
    {
        var inSection = false;
        foreach (var raw in Lines(ini))
        {
            var line = raw.Trim();
            if (line.StartsWith('['))
            {
                inSection = SectionName(line) is { } name && name.Equals(Section, StringComparison.OrdinalIgnoreCase);
                continue;
            }
            if (inSection && KeyValue(line) is ({ } key, { } value) && key.Equals(Key, StringComparison.OrdinalIgnoreCase))
                return value == "1";
        }
        return false;
    }

    /// <summary>Devuelve el texto con EnableDataBroadcast=1 en [SDK], conservando el resto del archivo.</summary>
    public static string Enable(string ini)
    {
        if (IsEnabled(ini)) return ini;
        var newline = ini.Contains("\r\n") ? "\r\n" : "\n";
        var lines = Lines(ini).ToList();

        var sectionAt = -1;
        for (var i = 0; i < lines.Count; i++)
        {
            var line = lines[i].Trim();
            if (line.StartsWith('[') && SectionName(line) is { } name && name.Equals(Section, StringComparison.OrdinalIgnoreCase))
            {
                sectionAt = i;
                break;
            }
        }

        if (sectionAt < 0)
        {
            var body = ini.TrimEnd('\r', '\n');
            return (body.Length > 0 ? body + newline + newline : string.Empty) + $"[{Section}]{newline}{Key}=1{newline}";
        }

        // Dentro de [SDK]: se corrige la clave si existe; si no, se agrega al inicio de la sección.
        for (var i = sectionAt + 1; i < lines.Count && !lines[i].TrimStart().StartsWith('['); i++)
        {
            if (KeyValue(lines[i].Trim()) is ({ } key, _) && key.Equals(Key, StringComparison.OrdinalIgnoreCase))
            {
                lines[i] = $"{Key}=1";
                return string.Join(newline, lines);
            }
        }
        lines.Insert(sectionAt + 1, $"{Key}=1");
        return string.Join(newline, lines);
    }

    private static IEnumerable<string> Lines(string text) => text.Replace("\r\n", "\n").Split('\n');

    private static string? SectionName(string line)
    {
        var end = line.IndexOf(']');
        return end > 1 ? line[1..end].Trim() : null;
    }

    private static (string? Key, string? Value) KeyValue(string line)
    {
        if (line.StartsWith(';') || line.StartsWith('#')) return (null, null);
        var eq = line.IndexOf('=');
        return eq > 0 ? (line[..eq].Trim(), line[(eq + 1)..].Split(';')[0].Trim()) : (null, null);
    }
}
