using LamAcars.Core.Engine;
using LamAcars.Core.Models;
using Xunit;

namespace LamAcars.Core.Tests;

public class FlightRecorderTests
{
    private static ListSink Record(out FlightRecorder recorder)
    {
        var sink = new ListSink();
        recorder = new FlightRecorder(sink);
        foreach (var s in Fixtures.Load("synthetic-mmmx-mmgl.jsonl")) recorder.Process(s);
        return sink;
    }

    [Fact]
    public void El_aterrizaje_se_mide_con_la_variable_del_simulador()
    {
        var sink = Record(out _);
        var touchdown = Assert.Single(sink.Events, e => e.Type == FlightEventTypes.Touchdown);

        Assert.Equal(-152.4, (double)touchdown.Data["vs_fpm"]!, 1);
        Assert.Equal("touchdown_normal_velocity", touchdown.Data["vs_source"]);
        Assert.Equal(1.25, (double)touchdown.Data["g_force"]!, 2);
        Assert.Equal(4.2, (double)touchdown.Data["pitch_deg"]!, 1);
        Assert.Equal(0, touchdown.Data["bounces"]);
        Assert.Equal(new DateTimeOffset(2026, 10, 25, 14, 57, 20, TimeSpan.Zero), touchdown.OccurredAt);
    }

    [Fact]
    public void Los_eventos_operacionales_aparecen_una_vez_y_en_orden()
    {
        var sink = Record(out _);
        var order = sink.Events
            .Where(e => e.Type is FlightEventTypes.BlockOff or FlightEventTypes.Takeoff or FlightEventTypes.Touchdown or FlightEventTypes.BlockOn)
            .Select(e => e.Type)
            .ToList();

        Assert.Equal(new[] { FlightEventTypes.BlockOff, FlightEventTypes.Takeoff, FlightEventTypes.Touchdown, FlightEventTypes.BlockOn }, order);
        Assert.Equal(2, sink.Events.Count(e => e.Type == FlightEventTypes.EngineStart));
        Assert.Equal(2, sink.Events.Count(e => e.Type == FlightEventTypes.EngineShutdown));
        Assert.Equal(14, sink.Events.Count(e => e.Type == FlightEventTypes.PhaseChange));
        Assert.Equal(new DateTimeOffset(2026, 10, 25, 14, 10, 40, TimeSpan.Zero),
            sink.Events.Single(e => e.Type == FlightEventTypes.Takeoff).OccurredAt);
    }

    [Fact]
    public void Las_secuencias_son_consecutivas_y_los_ids_unicos()
    {
        var sink = Record(out var recorder);
        Assert.Equal(Enumerable.Range(0, sink.Events.Count), sink.Events.Select(e => e.Seq));
        Assert.Equal(sink.Events.Count, sink.Events.Select(e => e.Id).Distinct().Count());
        Assert.Equal(Enumerable.Range(0, sink.Points.Count), sink.Points.Select(p => p.Seq));
        Assert.Equal(sink.Events.Count, recorder.NextEventSeq);
    }

    [Fact]
    public void La_traza_es_densa_en_despegue_y_rala_en_crucero()
    {
        var sink = Record(out _);
        var cruise = sink.Points.Count(p => p.Phase == FlightPhase.Cruise);
        var initialClimb = sink.Points.Count(p => p.Phase == FlightPhase.InitialClimb);
        // ~1,060 s de crucero a 1 punto cada 30 s; ascenso inicial ~36 s a 1 cada 2 s.
        Assert.InRange(cruise, 30, 45);
        Assert.InRange(initialClimb, 12, 22);
        // Todo el vuelo (65 min) son ~590 puntos: uno o dos lotes.
        Assert.InRange(sink.Points.Count, 400, 700);
    }

    [Fact]
    public void La_posicion_viva_sale_cada_10_segundos()
    {
        var sink = Record(out _);
        Assert.InRange(sink.Positions.Count, 385, 395);
        var gaps = sink.Positions.Zip(sink.Positions.Skip(1), (a, b) => (b.SampledAt - a.SampledAt).TotalSeconds);
        Assert.All(gaps, g => Assert.Equal(10, g));
    }

    [Fact]
    public void Al_reanudar_continua_las_secuencias_y_no_repite_calzos_fuera()
    {
        var sink = new ListSink();
        var recorder = new FlightRecorder(sink, new FlightRecorderOptions { InitialPhase = FlightPhase.Cruise, NextEventSeq = 40, NextPointSeq = 90 });
        for (var t = 0; t <= 40; t++) recorder.Process(Samples.Air(t, 34000, -1800, 29000));

        Assert.Equal(FlightPhase.Descent, recorder.Phase);
        Assert.Equal(40, sink.Events[0].Seq);
        Assert.Equal(90, sink.Points[0].Seq);
        Assert.DoesNotContain(sink.Events, e => e.Type == FlightEventTypes.BlockOff);
    }

    [Fact]
    public void Los_rebotes_se_cuentan()
    {
        var sink = new ListSink();
        var recorder = new FlightRecorder(sink, new FlightRecorderOptions { InitialPhase = FlightPhase.Approach });
        var t = 0;
        recorder.Process(Samples.Air(t++, 5050, -300, 30));
        recorder.Process(Samples.Ground(t++, gs: 140, engines: 2) with { VsFpm = -300, GForce = 1.6 });
        recorder.Process(Samples.Air(t++, 5020, 200, 4) with { GsKt = 138 });
        recorder.Process(Samples.Ground(t++, gs: 135, engines: 2));
        for (; t < 8; t++) recorder.Process(Samples.Ground(t, gs: 120, engines: 2));

        var touchdown = Assert.Single(sink.Events, e => e.Type == FlightEventTypes.Touchdown);
        Assert.Equal(1, touchdown.Data["bounces"]);
        Assert.Equal("vertical_speed", touchdown.Data["vs_source"]);
        Assert.Equal(1.6, (double)touchdown.Data["g_force"]!, 2);
    }
}
