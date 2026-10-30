using LamAcars.Core.Aircraft;
using Xunit;

namespace LamAcars.Core.Tests;

public class PmdgSdkSetupTests
{
    [Fact]
    public void Agrega_la_seccion_si_no_existe()
    {
        var ini = "[Sound]\r\nVolume=80\r\n";
        var result = PmdgSdkSetup.Enable(ini);
        Assert.Equal("[Sound]\r\nVolume=80\r\n\r\n[SDK]\r\nEnableDataBroadcast=1\r\n", result);
        Assert.True(PmdgSdkSetup.IsEnabled(result));
    }

    [Fact]
    public void Corrige_el_valor_en_su_seccion_y_conserva_lo_demas()
    {
        var ini = "[SDK]\nEnableCDUBroadcast.0=1\nEnableDataBroadcast=0 ; apagado\n[Other]\nEnableDataBroadcast=0\n";
        var result = PmdgSdkSetup.Enable(ini);
        Assert.Equal("[SDK]\nEnableCDUBroadcast.0=1\nEnableDataBroadcast=1\n[Other]\nEnableDataBroadcast=0\n", result);
    }

    [Fact]
    public void Agrega_la_clave_en_una_seccion_existente()
    {
        var result = PmdgSdkSetup.Enable("[sdk]\nEnableCDUBroadcast.0=1\n");
        Assert.Equal("[sdk]\nEnableDataBroadcast=1\nEnableCDUBroadcast.0=1\n", result);
    }

    [Theory]
    [InlineData("[SDK]\nEnableDataBroadcast=1\n", true)]
    [InlineData("[SDK]\nEnableDataBroadcast = 1\n", true)]
    [InlineData("[SDK]\n;EnableDataBroadcast=1\n", false)]
    [InlineData("[Other]\nEnableDataBroadcast=1\n", false)]
    [InlineData("", false)]
    public void Detecta_si_ya_esta_activo(string ini, bool enabled) => Assert.Equal(enabled, PmdgSdkSetup.IsEnabled(ini));

    [Fact]
    public void No_toca_un_archivo_ya_activo()
    {
        const string ini = "[SDK]\nEnableDataBroadcast=1\n";
        Assert.Same(ini, PmdgSdkSetup.Enable(ini));
    }

    [Fact]
    public void Encuentra_y_activa_los_aviones_instalados()
    {
        var root = Path.Combine(Path.GetTempPath(), "lam-pmdg-" + Guid.NewGuid().ToString("N"));
        try
        {
            var w737 = Directory.CreateDirectory(Path.Combine(root, "pmdg-aircraft-738", "work")).FullName;
            var w777 = Directory.CreateDirectory(Path.Combine(root, "pmdg-aircraft-77w", "work")).FullName;
            Directory.CreateDirectory(Path.Combine(root, "otro-paquete", "work"));
            File.WriteAllText(Path.Combine(w737, "737_Options.ini"), "[General]\nUnits=KG\n");
            File.WriteAllText(Path.Combine(w777, "777_Options.ini"), "[SDK]\nEnableDataBroadcast=1\n");

            var found = PmdgSdkSetup.Find(new[] { root, Path.Combine(root, "no-existe") });
            Assert.Equal(2, found.Count);
            Assert.Single(found, f => !f.Enabled && f.Package == "pmdg-aircraft-738");

            var changed = PmdgSdkSetup.EnableAll(found);
            Assert.Single(changed);
            Assert.True(PmdgSdkSetup.IsEnabled(File.ReadAllText(Path.Combine(w737, "737_Options.ini"))));
            Assert.Equal("[General]\nUnits=KG\n", File.ReadAllText(Path.Combine(w737, "737_Options.ini.lam-backup")));
            Assert.All(PmdgSdkSetup.Find(new[] { root }), f => Assert.True(f.Enabled));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }
}
