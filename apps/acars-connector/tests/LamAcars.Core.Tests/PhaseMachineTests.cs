using LamAcars.Core.Engine;
using LamAcars.Core.Models;
using Xunit;

namespace LamAcars.Core.Tests;

public class PhaseMachineTests
{
    private const string Synthetic = "synthetic-mmmx-mmgl.jsonl";

    [Fact]
    public void Un_vuelo_completo_pasa_por_todas_las_fases_en_orden()
    {
        var machine = new PhaseMachine();
        var phases = new List<FlightPhase> { machine.Phase };
        foreach (var s in Fixtures.Load(Synthetic))
        {
            foreach (var tr in machine.Update(s)) phases.Add(tr.To);
        }

        Assert.Equal(Enum.GetValues<FlightPhase>(), phases);
    }

    [Fact]
    public void Las_transiciones_ocurren_en_los_momentos_esperados()
    {
        var machine = new PhaseMachine();
        var at = new Dictionary<FlightPhase, DateTimeOffset>();
        var samples = Fixtures.Load(Synthetic);
        foreach (var s in samples)
        {
            foreach (var tr in machine.Update(s)) at[tr.To] = tr.At;
        }
        var t0 = samples[0].Time;
        double Sec(FlightPhase p) => (at[p] - t0).TotalSeconds;

        Assert.InRange(Sec(FlightPhase.EnginesStarted), 124, 126);   // motor 1 a los 120 s + 5 s
        Assert.InRange(Sec(FlightPhase.Pushback), 201, 203);
        Assert.InRange(Sec(FlightPhase.TaxiOut), 304, 306);
        Assert.InRange(Sec(FlightPhase.InitialClimb), 640, 642);     // despega a los 640 s
        Assert.InRange(Sec(FlightPhase.Descent), 2429, 2431);
        Assert.Equal(3440, Sec(FlightPhase.Landing));                 // contacto exacto
        Assert.InRange(Sec(FlightPhase.FlightCompleted), 3849, 3851);
    }

    [Fact]
    public void La_pausa_no_cuenta_como_tiempo_de_permanencia()
    {
        var machine = new PhaseMachine(FlightPhase.Preflight);
        machine.Update(Samples.Ground(0, engines: 2));
        machine.Update(Samples.Ground(3, engines: 2) with { Paused = true });
        machine.Update(Samples.Ground(30, engines: 2) with { Paused = true });
        Assert.Equal(FlightPhase.Preflight, machine.Phase);
        machine.Update(Samples.Ground(31, engines: 2));
        machine.Update(Samples.Ground(36, engines: 2));
        Assert.Equal(FlightPhase.EnginesStarted, machine.Phase);
    }

    [Fact]
    public void Conectar_en_el_aire_infiere_la_fase()
    {
        var machine = new PhaseMachine();
        var tr = machine.Update(Samples.Air(0, 34000, 0, 29000));
        Assert.Equal(FlightPhase.Cruise, Assert.Single(tr).To);

        var low = new PhaseMachine();
        low.Update(Samples.Air(0, 7000, -700, 2000));
        Assert.Equal(FlightPhase.Approach, low.Phase);
    }

    [Fact]
    public void Un_motor_y_al_aire_vuelve_a_ascenso()
    {
        var machine = new PhaseMachine(FlightPhase.Approach);
        for (var t = 0; t <= 16; t++) machine.Update(Samples.Air(t, 6000 + t * 30, 1800, 900 + t * 30));
        Assert.Equal(FlightPhase.Climb, machine.Phase);
    }

    [Fact]
    public void Un_despegue_abortado_regresa_a_rodaje()
    {
        var machine = new PhaseMachine(FlightPhase.Takeoff);
        for (var t = 0; t <= 11; t++) machine.Update(Samples.Ground(t, gs: 20, engines: 2));
        Assert.Equal(FlightPhase.TaxiOut, machine.Phase);
    }

    [Fact]
    public void Una_nivelacion_baja_en_ascenso_no_es_crucero()
    {
        var machine = new PhaseMachine(FlightPhase.Climb, plannedCruiseFt: 34000);
        for (var t = 0; t <= 120; t++) machine.Update(Samples.Air(t, 15000, 0, 10000));
        Assert.Equal(FlightPhase.Climb, machine.Phase);
        for (var t = 121; t <= 190; t++) machine.Update(Samples.Air(t, 33000, 0, 28000));
        Assert.Equal(FlightPhase.Cruise, machine.Phase);
    }
}
