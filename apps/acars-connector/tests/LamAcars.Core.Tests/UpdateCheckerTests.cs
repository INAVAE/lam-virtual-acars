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
