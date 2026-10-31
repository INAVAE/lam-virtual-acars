using LamAcars.Core.Aircraft;
using LamAcars.Core.Api;
using LamAcars.Core.Engine;
using LamAcars.Core.Models;
using Xunit;

namespace LamAcars.Core.Tests;

public class WindApuTests
{
    [Fact]
    public void El_generico_lee_el_viento()
    {
        var s = new GenericAdapter().Map(new Dictionary<string, double>
        {
            ["SIM ON GROUND"] = 0, ["AMBIENT WIND DIRECTION"] = -10, ["AMBIENT WIND VELOCITY"] = 23.4,
        }, Samples.T0, false);
        Assert.Equal(350, s.WindDirDeg!.Value, 3);
        Assert.Equal(23.4, s.WindKt!.Value, 3);
        Assert.Null(new GenericAdapter().Map(new Dictionary<string, double> { ["SIM ON GROUND"] = 1 }, Samples.T0, false).WindKt);
    }

    [Theory]
    [InlineData(270, 20, 270, 20, 0)]    // de frente
    [InlineData(90, 20, 270, -20, 0)]    // de cola
    [InlineData(270, 20, 0, 0, -20)]     // cruzado desde la izquierda
    [InlineData(90, 20, 0, 0, 20)]       // cruzado desde la derecha
    public void Componentes_del_viento(double dir, double kt, double heading, double head, double cross)
    {
        var c = WindMath.Components(dir, kt, heading)!.Value;
        Assert.Equal(head, c.Headwind, 1);
        Assert.Equal(cross, c.Crosswind, 1);
        Assert.Null(WindMath.Components(null, kt, heading));
    }

    [Fact]
    public void La_traza_la_posicion_y_los_eventos_llevan_el_viento()
    {
        var sink = new ListSink();
        var recorder = new FlightRecorder(sink);
        foreach (var s in Fixtures.Load("synthetic-mmmx-mmgl.jsonl")) recorder.Process(s with { WindDirDeg = 300, WindKt = 18 });

        Assert.All(sink.Points, p => Assert.Equal(18.0, p.WindKt));
        Assert.All(sink.Positions, p => Assert.Equal(300.0, p.WindDirDeg));

        var takeoff = sink.Events.Single(e => e.Type == FlightEventTypes.Takeoff);
        Assert.Equal(18.0, takeoff.Data["wind_kt"]);
        Assert.True(takeoff.Data.ContainsKey("headwind_kt"));
        var touchdown = sink.Events.Single(e => e.Type == FlightEventTypes.Touchdown);
        Assert.Equal(300.0, touchdown.Data["wind_dir_deg"]);
        Assert.True(touchdown.Data.ContainsKey("crosswind_kt"));

        var dto = TrackPointDto.From(sink.Points[0]);
        Assert.Equal(300.0, dto.WindDirDeg);
        Assert.Equal(18.0, dto.WindKt);
    }

    private static SimSample Parked(int t, bool? apu) => Samples.Ground(t, engines: 0, brake: true) with { ApuRunning = apu };

    [Fact]
    public void El_vuelo_no_se_cierra_con_la_APU_encendida()
    {
        var machine = new PhaseMachine(FlightPhase.EnginesShutdown);
        for (var t = 0; t <= 120; t += 1) Assert.Empty(machine.Update(Parked(t, true)));
        Assert.Equal(FlightPhase.EnginesShutdown, machine.Phase);

        var closed = new List<PhaseTransition>();
        for (var t = 121; t <= 130; t += 1) closed.AddRange(machine.Update(Parked(t, false)));
        var tr = Assert.Single(closed);
        Assert.Equal(FlightPhase.FlightCompleted, tr.To);
        Assert.Equal("parking_brake", tr.Reason);
    }

    [Fact]
    public void Sin_dato_de_APU_se_cierra_como_antes()
    {
        var machine = new PhaseMachine(FlightPhase.EnginesShutdown);
        var closed = new List<PhaseTransition>();
        for (var t = 0; t <= 10; t += 1) closed.AddRange(machine.Update(Parked(t, null)));
        Assert.Equal(FlightPhase.FlightCompleted, Assert.Single(closed).To);
    }
}
