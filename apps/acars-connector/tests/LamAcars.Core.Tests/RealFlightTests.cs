using LamAcars.Core.Engine;
using LamAcars.Core.Models;
using Xunit;

namespace LamAcars.Core.Tests;

/// <summary>
/// Vuelo real en MSFS 2024 (2026-10-28, MXL106 MMMX-MMAA, 737-800 predeterminado, LAM ACARS 0.1.5).
/// Pushback con motores apagados (remolcador sin PUSHBACK STATE) y arranque durante el empuje.
/// </summary>
public class RealFlightTests
{
    private const string File = "real-msfs2024-b738-mmmx-mmaa.jsonl";

    /// <summary>La grabación termina al cerrar el vuelo; se agregan 10 s detenido para completar la última fase.</summary>
    private static List<SimSample> Load()
    {
        var samples = Fixtures.Load(File);
        var last = samples[^1];
        for (var i = 1; i <= 10; i++) samples.Add(last with { Time = last.Time.AddSeconds(i) });
        return samples;
    }

    [Fact]
    public void Registra_las_15_fases_con_el_pushback_antes_del_arranque()
    {
        var machine = new PhaseMachine();
        var phases = new List<FlightPhase> { machine.Phase };
        foreach (var s in Load())
        {
            foreach (var tr in machine.Update(s)) phases.Add(tr.To);
        }

        Assert.Equal(new[]
        {
            FlightPhase.AircraftConnected, FlightPhase.Preflight, FlightPhase.Pushback, FlightPhase.EnginesStarted,
            FlightPhase.TaxiOut, FlightPhase.Takeoff, FlightPhase.InitialClimb, FlightPhase.Climb, FlightPhase.Cruise,
            FlightPhase.Descent, FlightPhase.Approach, FlightPhase.Landing, FlightPhase.TaxiIn, FlightPhase.EnginesShutdown,
            FlightPhase.FlightCompleted,
        }, phases);
    }

    [Fact]
    public void El_aterrizaje_usa_las_variables_del_simulador_aunque_lleguen_tarde()
    {
        var sink = new ListSink();
        var recorder = new FlightRecorder(sink);
        foreach (var s in Load()) recorder.Process(s);

        var touchdown = Assert.Single(sink.Events, e => e.Type == FlightEventTypes.Touchdown);
        // MSFS reporta 4.9 ft/s (−294 fpm) un segundo después del contacto; antes conserva el valor anterior.
        Assert.Equal("touchdown_normal_velocity", touchdown.Data["vs_source"]);
        Assert.InRange((double)touchdown.Data["vs_fpm"]!, -295, -293);
        Assert.InRange((double)touchdown.Data["pitch_deg"]!, 3.0, 3.2);
        Assert.Equal(0, touchdown.Data["bounces"]);
    }

    [Fact]
    public void Los_motores_se_registran_durante_el_pushback()
    {
        var sink = new ListSink();
        var recorder = new FlightRecorder(sink);
        foreach (var s in Load()) recorder.Process(s);

        var order = sink.Events.Where(e => e.Type is FlightEventTypes.BlockOff or FlightEventTypes.EngineStart or FlightEventTypes.Takeoff
            or FlightEventTypes.Touchdown or FlightEventTypes.BlockOn or FlightEventTypes.EngineShutdown).Select(e => e.Type).ToList();
        Assert.Equal(new[]
        {
            FlightEventTypes.BlockOff, FlightEventTypes.EngineStart, FlightEventTypes.EngineStart, FlightEventTypes.Takeoff,
            FlightEventTypes.Touchdown, FlightEventTypes.BlockOn, FlightEventTypes.EngineShutdown, FlightEventTypes.EngineShutdown,
        }, order);
    }

    [Theory]
    [InlineData("737-800BCF BW", "B738")]
    [InlineData("737-800 PAX SSW TC", "B738")]
    [InlineData("FenixA320 IAE SL", "A320")]
    [InlineData("Airbus A320neo Asobo", "A20N")]
    [InlineData("PMDG 777-300ER", "B77W")]
    [InlineData("Boeing 787-10 Dreamliner", "B78X")]
    [InlineData("Cessna 208B Grand Caravan EX", "C208")]
    [InlineData("Avión desconocido", null)]
    public void Deduce_el_tipo_por_el_titulo(string title, string? icao) => Assert.Equal(icao, AircraftTypeGuesser.FromTitle(title));
}
