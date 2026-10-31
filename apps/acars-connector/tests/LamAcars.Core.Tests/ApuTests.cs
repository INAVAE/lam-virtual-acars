using LamAcars.Core.Aircraft;
using LamAcars.Core.Engine;
using LamAcars.Core.Models;
using Xunit;

namespace LamAcars.Core.Tests;

public class ApuTests
{
    private static List<(string State, DateTimeOffset At)> Run(params (int T, bool? Apu)[] samples)
    {
        var sink = new ListSink();
        var recorder = new FlightRecorder(sink);
        foreach (var (t, apu) in samples) recorder.Process(Samples.Ground(t) with { ApuRunning = apu, FuelTotalKg = 6000 - t });
        return sink.Events
            .Where(e => e.Type == FlightEventTypes.Note && Equals(e.Data["kind"], "apu"))
            .Select(e => ((string)e.Data["state"]!, e.OccurredAt))
            .ToList();
    }

    [Fact]
    public void Registra_encendido_y_apagado_con_la_hora_del_cambio()
    {
        var notes = Run((0, false), (1, false), (10, true), (12, true), (16, true), (100, false), (103, false), (106, false));
        Assert.Equal(new[] { "start", "stop" }, notes.Select(n => n.State));
        Assert.Equal(Samples.T0.AddSeconds(10), notes[0].At);
        Assert.Equal(Samples.T0.AddSeconds(100), notes[1].At);
    }

    [Fact]
    public void Ignora_cambios_de_menos_de_5_segundos()
    {
        var notes = Run((0, false), (1, true), (3, false), (10, false), (11, true), (13, false));
        Assert.Empty(notes);
    }

    [Fact]
    public void Avisa_si_ya_estaba_en_marcha_al_iniciar_ACARS()
    {
        var notes = Run((0, true), (5, true), (60, true));
        Assert.Equal(new[] { "running" }, notes.Select(n => n.State));
    }

    [Fact]
    public void Sin_dato_de_APU_no_registra_nada()
    {
        Assert.Empty(Run((0, null), (10, null)));
    }

    [Theory]
    [InlineData(0.30, false)]
    [InlineData(0.96, true)]
    public void El_generico_usa_las_RPM_de_la_APU(double rpm, bool running)
    {
        var s = new GenericAdapter().Map(new Dictionary<string, double> { ["SIM ON GROUND"] = 1, ["APU PCT RPM"] = rpm }, Samples.T0, false);
        Assert.Equal(running, s.ApuRunning);
        Assert.Null(new GenericAdapter().Map(new Dictionary<string, double> { ["SIM ON GROUND"] = 1 }, Samples.T0, false).ApuRunning);
    }

    [Theory]
    [InlineData(1, 450f, true)]
    [InlineData(0, 450f, false)]   // selector en OFF: enfriamiento, ya cuenta como apagada
    [InlineData(2, 120f, false)]   // arrancando, aún sin EGT de marcha
    public void PMDG_737_APU_por_selector_y_EGT(byte selector, float egt, bool running)
    {
        var d = new byte[Pmdg737Adapter.Area.Size];
        d[Pmdg737Adapter.ApuSelector] = selector;
        BitConverter.GetBytes(egt).CopyTo(d, Pmdg737Adapter.ApuEgtNeedle);
        var values = new Dictionary<string, double> { ["SIM ON GROUND"] = 1, ["APU PCT RPM"] = 0 };
        var pmdg = new Pmdg737Adapter();
        pmdg.Read(d, values);
        Assert.Equal(running, pmdg.Map(values, Samples.T0, false).ApuRunning);
    }

    [Fact]
    public void PMDG_777_APU_por_su_indicador()
    {
        var d = new byte[Pmdg777Adapter.Area.Size];
        d[Pmdg777Adapter.ApuRunningFlag] = 1;
        var values = new Dictionary<string, double>();
        var pmdg = new Pmdg777Adapter();
        pmdg.Read(d, values);
        Assert.True(pmdg.Map(values, Samples.T0, false).ApuRunning);
    }
}
