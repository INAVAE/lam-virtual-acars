using LamAcars.Core.Aircraft;
using Xunit;

namespace LamAcars.Core.Tests;

public class AdapterTests
{
    private static readonly DateTimeOffset T = new(2026, 10, 29, 12, 0, 0, TimeSpan.Zero);

    private static Dictionary<string, double> Parked(double brake = 0) => new()
    {
        ["PLANE LATITUDE"] = 19.43,
        ["PLANE LONGITUDE"] = -99.07,
        ["PLANE ALTITUDE"] = 7316,
        ["SIM ON GROUND"] = 1,
        ["NUMBER OF ENGINES"] = 2,
        ["GENERAL ENG COMBUSTION:1"] = 1,
        ["GENERAL ENG COMBUSTION:2"] = 0,
        ["BRAKE PARKING POSITION"] = brake,
        ["PLANE PITCH DEGREES"] = -2.5,
        ["VELOCITY BODY Z"] = -1.5,
        ["PUSHBACK STATE"] = 3,
    };

    [Theory]
    [InlineData("FenixA320 IAE SL", typeof(FenixAdapter))]
    [InlineData("Fenix A321 CFM", typeof(FenixAdapter))]
    [InlineData("737-800BCF BW", typeof(GenericAdapter))]
    [InlineData("Airbus A320neo Asobo", typeof(GenericAdapter))]
    public void Elige_el_adaptador_por_la_aeronave(string title, Type expected) =>
        Assert.Equal(expected, AdapterRegistry.For(new AircraftIdentity(title, null, null, null)).GetType());

    [Fact]
    public void El_generico_convierte_unidades_y_signos()
    {
        var s = new GenericAdapter().Map(Parked(brake: 1), T, paused: false);
        Assert.Equal(1, s.EnginesRunning);
        Assert.Equal(2, s.EngineCount);
        Assert.True(s.ParkingBrake);
        Assert.Equal(2.5, s.PitchDeg);          // nariz arriba positiva
        Assert.True(s.MovingBackward);          // VELOCITY BODY Z negativa en tierra
        Assert.False(s.PushbackActive);         // PUSHBACK STATE 3 = sin pushback
        Assert.Null(s.TouchdownVsFpm);
    }

    [Fact]
    public void El_generico_no_inventa_datos_que_faltan()
    {
        var s = new GenericAdapter().Map(new Dictionary<string, double> { ["SIM ON GROUND"] = 1 }, T, paused: false);
        Assert.Null(s.IasKt);
        Assert.Null(s.GForce);
        Assert.Null(s.GearDown);
        Assert.False(s.ParkingBrake);
    }

    [Fact]
    public void Fenix_lee_su_palanca_de_freno_de_estacionamiento()
    {
        var fenix = new FenixAdapter();
        var values = Parked();
        Assert.False(fenix.Map(values, T, false).ParkingBrake);

        values[FenixAdapter.ParkingBrakeLever] = 1;
        Assert.True(fenix.Map(values, T, false).ParkingBrake);
    }

    [Fact]
    public void Fenix_con_calzos_cuenta_como_asegurado()
    {
        var values = Parked();
        values[FenixAdapter.Chocks] = 1;
        Assert.True(new FenixAdapter().Map(values, T, false).ParkingBrake);
    }

    [Fact]
    public void Fenix_pide_sus_variables_y_las_vigila()
    {
        var fenix = new FenixAdapter();
        Assert.Contains(fenix.Variables, v => v.Name == FenixAdapter.ParkingBrakeLever);
        Assert.Contains(fenix.Variables, v => v.Name == "PLANE LATITUDE");
        Assert.Contains(FenixAdapter.ParkingBrakeLever, fenix.Diagnostics);
        Assert.Equal(fenix.Variables.Count, fenix.Variables.Select(v => v.Name).Distinct().Count());
    }
}
