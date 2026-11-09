using LamAcars.Core.Updates;
using Xunit;

namespace LamAcars.Core.Tests;

public class UpdateCheckerTests
{
    private const string Releases = """
    [
      { "tag_name": "deps-simconnect", "draft": true, "html_url": "x", "assets": [] },
      { "tag_name": "connector-v0.1.9", "draft": false, "html_url": "https://github.com/r/0.1.9", "assets": [] },
      { "tag_name": "connector-v0.1.21", "draft": true, "html_url": "https://github.com/r/0.1.21", "assets": [] },
      { "tag_name": "connector-v0.1.20", "draft": false, "prerelease": true, "html_url": "https://github.com/r/0.1.20",
        "published_at": "2026-11-01T06:00:00Z", "body": "Novedades",
        "assets": [ { "name": "LamAcars-0.1.20-win-x64.zip.sha256", "browser_download_url": "https://dl/sha" },
                    { "name": "LamAcars-0.1.20-win-x64.zip", "browser_download_url": "https://dl/zip" } ] }
    ]
    """;

    [Fact]
    public void Elige_la_version_mas_alta_sin_borradores()
    {
        var latest = UpdateChecker.Latest(Releases);
        Assert.NotNull(latest);
        Assert.Equal(new Version(0, 1, 20), latest!.Version);
        Assert.Equal("https://dl/zip", latest.DownloadUrl);
        Assert.Equal("https://github.com/r/0.1.20", latest.PageUrl);
        Assert.Equal("Novedades", latest.Notes);
    }

    [Theory]
    [InlineData("0.1.19", true)]
    [InlineData("0.1.20", false)]
    [InlineData("0.1.20+abcdef", false)]
    [InlineData("0.2.0", false)]
    [InlineData("0.1.3", true)]
    public void Avisa_solo_si_hay_una_version_mayor(string current, bool newer)
    {
        Assert.Equal(newer, UpdateChecker.Newer(UpdateChecker.Latest(Releases), current) is not null);
    }

    [Fact]
    public void Versiones_mal_formadas_no_avisan()
    {
        Assert.Null(UpdateChecker.Newer(UpdateChecker.Latest(Releases), "dev"));
        Assert.Null(UpdateChecker.Latest("{}"));
        Assert.Equal(new Version(0, 1, 19), UpdateChecker.Normalize("v0.1.19"));
    }
}

public class UpdatePackageTests
{
    [Fact]
    public void La_publicacion_trae_la_suma_del_zip()
    {
        const string json = """
        [ { "tag_name": "connector-v0.1.34", "html_url": "p",
            "assets": [ { "name": "LamAcars-0.1.34-win-x64.zip.sha256", "browser_download_url": "https://dl/sha" },
                        { "name": "LamAcars-0.1.34-win-x64.zip", "browser_download_url": "https://dl/zip" } ] } ]
        """;
        var latest = UpdateChecker.Latest(json)!;
        Assert.Equal("https://dl/zip", latest.DownloadUrl);
        Assert.Equal("https://dl/sha", latest.Sha256Url);
    }

    [Fact]
    public void Lee_la_suma_SHA256()
    {
        var hash = new string('a', 32) + new string('B', 32);
        Assert.Equal(hash.ToLowerInvariant(), UpdatePackage.ParseSha256($"{hash}  LamAcars-0.1.34-win-x64.zip\n"));
        Assert.Null(UpdatePackage.ParseSha256("no hay suma"));
        Assert.Null(UpdatePackage.ParseSha256(null));
    }

    [Fact]
    public void Descomprime_y_encuentra_la_carpeta_del_conector()
    {
        var work = Path.Combine(Path.GetTempPath(), $"lam-update-test-{Guid.NewGuid():N}");
        try
        {
            var pkg = Path.Combine(work, "pkg", "LamAcars");
            Directory.CreateDirectory(pkg);
            File.WriteAllText(Path.Combine(pkg, UpdatePackage.ExeName), "exe");
            File.WriteAllText(Path.Combine(pkg, "LEEME.txt"), "hola");
            var zip = Path.Combine(work, "LamAcars.zip");
            System.IO.Compression.ZipFile.CreateFromDirectory(Path.Combine(work, "pkg"), zip);
            var root = UpdatePackage.Extract(zip, Path.Combine(work, "out"));
            Assert.Equal("LamAcars", Path.GetFileName(root));
            Assert.True(File.Exists(Path.Combine(root, "LEEME.txt")));
            Assert.Equal(64, UpdatePackage.ComputeSha256(zip).Length);
            Assert.True(UpdatePackage.CanWrite(work));
        }
        finally
        {
            if (Directory.Exists(work)) Directory.Delete(work, recursive: true);
        }
    }

    [Fact]
    public void El_script_espera_al_conector_copia_y_lo_vuelve_a_abrir()
    {
        var script = UpdatePackage.BuildSwapScript(4242, @"C:\Users\Ana O'Neil\AppData\Local\LamAcars\updates\0.1.36\LamAcars", @"C:\LamAcars", @"C:\log.txt");
        Assert.Contains("Wait-Process -Id 4242", script);
        Assert.Contains(@"'C:\Users\Ana O''Neil\AppData\Local\LamAcars\updates\0.1.36\LamAcars'", script);
        Assert.Contains("Copy-Item", script);
        Assert.Contains("'LamAcars.exe'", script);
    }
}
