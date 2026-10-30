using System.Buffers.Binary;
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
    [InlineData("737-800BCF BW", typeof(Pmdg737Adapter))]
    [InlineData("PMDG 737-700 BBJ", typeof(Pmdg737Adapter))]
    [InlineData("Boeing 737 MAX 8", typeof(GenericAdapter))]
    [InlineData("PMDG 777-300ER Aeromexico", typeof(Pmdg777Adapter))]
    [InlineData("777F", typeof(Pmdg777Adapter))]
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

    [Fact]
    public void El_generico_da_los_flaps_en_grados()
    {
        var values = Parked();
        values["TRAILING EDGE FLAPS LEFT ANGLE"] = 14.96;
        Assert.Equal(15.0, new GenericAdapter().Map(values, T, false).FlapsDeg);
    }

    // ---------------------------------------------------------------- PMDG

    private static byte[] Ng3(bool brake, byte gearLever, float flapsNeedle, ushort model)
    {
        var d = new byte[Pmdg737Adapter.Area.Size];
        d[Pmdg737Adapter.ParkingBrakeAnnun] = brake ? (byte)1 : (byte)0;
        d[Pmdg737Adapter.GearLever] = gearLever;
        BinaryPrimitives.WriteSingleLittleEndian(d.AsSpan(Pmdg737Adapter.TeFlapsNeedle), flapsNeedle);
        BinaryPrimitives.WriteUInt16LittleEndian(d.AsSpan(Pmdg737Adapter.AircraftModel), model);
        BinaryPrimitives.WriteSingleLittleEndian(d.AsSpan(Pmdg737Adapter.FuelCenter), 1000f);
        BinaryPrimitives.WriteSingleLittleEndian(d.AsSpan(Pmdg737Adapter.FuelLeft), 5000f);
        BinaryPrimitives.WriteSingleLittleEndian(d.AsSpan(Pmdg737Adapter.FuelRight), 5000f);
        return d;
    }

    private static byte[] B777(bool brake, byte gearLever, byte flapsLever, byte model)
    {
        var d = new byte[Pmdg777Adapter.Area.Size];
        d[Pmdg777Adapter.ParkingBrakeLever] = brake ? (byte)1 : (byte)0;
        d[Pmdg777Adapter.GearLever] = gearLever;
        d[Pmdg777Adapter.FlapsLever] = flapsLever;
        d[Pmdg777Adapter.AircraftModel] = model;
        return d;
    }

    [Fact]
    public void Las_areas_PMDG_tienen_el_tamano_del_SDK()
    {
        // sizeof(PMDG_NG3_Data) y sizeof(PMDG_777X_Data) calculados sobre los encabezados del SDK.
        Assert.Equal(916, Pmdg737Adapter.Area.Size);
        Assert.Equal(684, Pmdg777Adapter.Area.Size);
        Assert.Equal(0x4E473331u, Pmdg737Adapter.Area.Id);
        Assert.Equal(0x504D4447u, Pmdg777Adapter.Area.Id);
        Assert.Equal(2, AdapterRegistry.ClientDataAreas.Count);
        Assert.IsType<Pmdg737Adapter>(AdapterRegistry.ForClientData("PMDG_NG3_Data"));
        Assert.IsType<Pmdg777Adapter>(AdapterRegistry.ForClientData("PMDG_777X_Data"));
        Assert.Null(AdapterRegistry.ForClientData("OTRO"));
    }

    [Fact]
    public void PMDG_737_lee_freno_tren_flaps_y_variante()
    {
        var pmdg = new Pmdg737Adapter();
        var values = Parked(brake: 0);
        values["TRAILING EDGE FLAPS LEFT ANGLE"] = 0;
        values["GEAR HANDLE POSITION"] = 1;
        pmdg.Read(Ng3(brake: true, gearLever: 0, flapsNeedle: 4.98f, model: 6), values);

        var s = pmdg.Map(values, T, false);
        Assert.True(s.ParkingBrake);
        Assert.False(s.GearDown);           // palanca UP manda sobre la variable estándar
        Assert.Equal(5.0, s.FlapsDeg);
        Assert.Equal("B738", pmdg.IdentifyIcao(values));
        Assert.Equal(11000, values[PmdgAdapter.KeyFuelLbs]);
    }

    [Theory]
    [InlineData(1, "B736")]
    [InlineData(3, "B737")]
    [InlineData(7, "B738")]
    [InlineData(11, "B739")]
    [InlineData(17, "B738")]
    [InlineData(19, "B737")]
    [InlineData(99, null)]
    public void PMDG_737_identifica_la_variante(int model, string? icao)
    {
        var values = new Dictionary<string, double>();
        new Pmdg737Adapter().Read(Ng3(false, 2, 0, (ushort)model), values);
        Assert.Equal(icao, new Pmdg737Adapter().IdentifyIcao(values));
    }

    [Fact]
    public void PMDG_777_usa_la_palanca_de_flaps_si_falta_el_angulo()
    {
        var pmdg = new Pmdg777Adapter();
        var values = new Dictionary<string, double> { ["SIM ON GROUND"] = 1 };
        pmdg.Read(B777(brake: true, gearLever: 1, flapsLever: 6, model: 6), values);

        var s = pmdg.Map(values, T, false);
        Assert.True(s.ParkingBrake);
        Assert.True(s.GearDown);
        Assert.Equal(30, s.FlapsDeg);
        Assert.Equal("B77W", pmdg.IdentifyIcao(values));

        values["TRAILING EDGE FLAPS LEFT ANGLE"] = 24.6;   // ángulo real disponible: manda sobre el retén
        Assert.Equal(24.6, pmdg.Map(values, T, false).FlapsDeg);
    }

    [Fact]
    public void PMDG_sin_SDK_se_comporta_como_generico()
    {
        var values = Parked(brake: 1);
        values["GEAR HANDLE POSITION"] = 1;
        var generic = new GenericAdapter().Map(values, T, false);
        var pmdg = new Pmdg737Adapter().Map(values, T, false);
        Assert.Equal(generic, pmdg);
        Assert.Null(new Pmdg737Adapter().IdentifyIcao(values));
    }

    [Fact]
    public void PMDG_ignora_bloques_incompletos()
    {
        var values = new Dictionary<string, double>();
        new Pmdg737Adapter().Read(new byte[100], values);
        Assert.Empty(values);
    }
}
