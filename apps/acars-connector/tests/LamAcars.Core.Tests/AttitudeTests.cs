using LamAcars.Core.Engine;
using LamAcars.Core.Models;
using Xunit;

namespace LamAcars.Core.Tests;

public class AttitudeTests
{
    private static List<FlightEventRecord> Run(IEnumerable<SimSample> samples)
    {
        var sink = new ListSink();
        var recorder = new FlightRecorder(sink, new FlightRecorderOptions { InitialPhase = FlightPhase.Cruise });
        foreach (var s in samples) recorder.Process(s);
        return sink.Events.Where(e => e.Type == FlightEventTypes.Note && Equals(e.Data["kind"], "attitude")).ToList();
    }

    private static SimSample At(int t, double bank = 0, double pitch = 2, bool ground = false) =>
        Samples.Air(t, 30000, 0, 25000) with { BankDeg = bank, PitchDeg = pitch, OnGround = ground };

    [Fact]
    public void Registra_un_alabeo_sostenido_con_su_maximo_y_duracion()
    {
        var notes = Run(new[] { At(0, 20), At(1, 31), At(2, 38), At(3, -36), At(4, 33), At(5, 20), At(6, 15), At(7, 10) });
        var n = Assert.Single(notes);
        Assert.Equal("bank", n.Data["axis"]);
        Assert.Equal(38.0, n.Data["peak_deg"]);
        Assert.Equal(3.0, n.Data["seconds"]);
        Assert.Equal(Samples.T0.AddSeconds(1), n.OccurredAt);
    }

    [Fact]
    public void Ignora_picos_de_menos_de_2_segundos()
    {
        Assert.Empty(Run(new[] { At(0, 10), At(1, 40), At(2, 10), At(3, 10), At(4, 10), At(5, 35, 25), At(6, 0), At(7, 0), At(8, 0) }));
    }

    [Fact]
    public void Un_regreso_breve_bajo_el_umbral_no_parte_la_excursion()
    {
        // 0.5 s por debajo del umbral no cierra la excursión.
        var samples = new[] { At(0, 32), At(1, 33) }
            .Append(At(2, 29) with { Time = Samples.T0.AddSeconds(1.5) })
            .Concat(new[] { At(2, 34), At(3, 31), At(4, 0), At(6, 0) });
        var n = Assert.Single(Run(samples));
        Assert.Equal(34.0, n.Data["peak_deg"]);
        Assert.Equal(3.0, n.Data["seconds"]);
    }

    [Fact]
    public void Registra_cabeceo_arriba_y_abajo_por_separado()
    {
        var notes = Run(new[]
        {
            At(0), At(1, pitch: 19), At(2, pitch: 23.4), At(3, pitch: 21), At(4, pitch: 5), At(6, pitch: 2),
            At(10, pitch: -7), At(11, pitch: -11.2), At(12, pitch: -8), At(13, pitch: -1), At(15, pitch: 0),
        });
        Assert.Equal(new[] { "pitch_up", "pitch_down" }, notes.Select(n => (string)n.Data["axis"]!));
        Assert.Equal(23.4, notes[0].Data["peak_deg"]);
        Assert.Equal(-11.2, notes[1].Data["peak_deg"]);
    }

    [Fact]
    public void En_tierra_no_cuenta_y_el_aterrizaje_cierra_la_excursion()
    {
        Assert.Empty(Run(new[] { At(0, pitch: 20, ground: true), At(5, pitch: 20, ground: true), At(9, pitch: 20, ground: true) }));
        var n = Assert.Single(Run(new[] { At(0, 33), At(1, 33), At(2, 33), At(3, 0, ground: true) }));
        Assert.Equal(2.0, n.Data["seconds"]);
    }

    [Fact]
    public void Una_actitud_normal_no_genera_notas()
    {
        Assert.Empty(Run(Enumerable.Range(0, 120).Select(t => At(t, bank: 25 * Math.Sin(t / 10.0), pitch: 3 + 8 * Math.Sin(t / 7.0)))));
    }
}
