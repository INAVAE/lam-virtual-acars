using LamAcars.Core.Aircraft;
using LamAcars.Core.Engine;
using LamAcars.Core.Models;
using Xunit;

namespace LamAcars.Core.Tests;

/// <summary>
/// A340-600 del 2026-11-01 (PIREP de MXL2201): GENERAL ENG COMBUSTION alternaba 4 y 0
/// en cada lectura desde el arranque. Se registraron 6,550 arranques y apagados en
/// 28 min, la fase no salió de pushback y la traza se quedó atrás de los eventos.
/// </summary>
public class EngineFlickerTests
{
    private static SimSample Four(double seconds, int running, double gs = 0, bool ground = true) => new()
    {
        Time = Samples.T0.AddSeconds(seconds),
        Latitude = 19.4363,
        Longitude = -99.0721,
        AltitudeFt = 7316,
        AglFt = 0,
        GsKt = gs,
        OnGround = ground,
        EnginesRunning = running,
        EngineCount = 4,
    };

    [Fact]
    public void El_filtro_ignora_apagados_momentaneos_y_acepta_los_reales()
    {
        var f = new EngineCountFilter();
        Assert.Equal(0, f.Filter(Samples.T0, 0));
        Assert.Equal(4, f.Filter(Samples.T0.AddSeconds(0.1), 4));
        // Alterna 0/4 cada 0.1 s: sigue en 4.
        for (var i = 2; i < 100; i++) Assert.Equal(4, f.Filter(Samples.T0.AddSeconds(i * 0.1), i % 2 == 0 ? 0 : 4));
        // Apagado real: tras 3 s sin verse en marcha, baja a 0.
        var t = 10.0;
        for (; t < 12.9; t += 0.1) Assert.Equal(4, f.Filter(Samples.T0.AddSeconds(t), 0));
        Assert.Equal(0, f.Filter(Samples.T0.AddSeconds(13.2), 0));
    }

    [Fact]
    public void Con_la_combustion_alternando_hay_un_arranque_por_motor_y_el_vuelo_avanza_al_rodaje()
    {
        var sink = new ListSink();
        var recorder = new FlightRecorder(sink, new FlightRecorderOptions { InitialPhase = FlightPhase.Preflight });
        var t = 0.0;
        // Motores apagados con el freno puesto.
        for (var i = 0; i < 50; i++, t += 0.1) recorder.Process(Four(t, 0) with { ParkingBrake = true });
        // Arranque: la combustión parpadea durante 3 minutos, 10 lecturas por segundo.
        for (var i = 0; i < 1800; i++, t += 0.1) recorder.Process(Four(t, i % 2 == 0 ? 4 : 0) with { ParkingBrake = true });
        // Rodaje con el mismo parpadeo.
        for (var i = 0; i < 300; i++, t += 0.1) recorder.Process(Four(t, i % 2 == 0 ? 4 : 0, gs: 15));

        Assert.Equal(4, sink.Events.Count(e => e.Type == FlightEventTypes.EngineStart));
        Assert.Equal(0, sink.Events.Count(e => e.Type == FlightEventTypes.EngineShutdown));
        Assert.Equal(FlightPhase.TaxiOut, recorder.Phase);
    }

    [Fact]
    public void El_N2_cuenta_el_motor_aunque_la_combustion_falle()
    {
        var adapter = new GenericAdapter();
        var values = new Dictionary<string, double>
        {
            ["SIM ON GROUND"] = 1, ["NUMBER OF ENGINES"] = 4,
            ["GENERAL ENG COMBUSTION:1"] = 0, ["GENERAL ENG COMBUSTION:2"] = 0, ["GENERAL ENG COMBUSTION:3"] = 1, ["GENERAL ENG COMBUSTION:4"] = 0,
            ["TURB ENG N2:1"] = 62.5, ["TURB ENG N2:2"] = 61, ["TURB ENG N2:3"] = 0, ["TURB ENG N2:4"] = 20,
        };
        Assert.Equal(3, adapter.Map(values, Samples.T0, false).EnginesRunning);
        Assert.Contains(adapter.Variables, v => v.Name == "TURB ENG N2:4");
    }

    [Fact]
    public void Un_evento_que_se_repite_sin_parar_se_corta_con_una_nota()
    {
        var guard = new EventFloodGuard();
        var decisions = Enumerable.Range(0, 40)
            .Select(i => guard.Check(FlightEventTypes.EngineStart, Samples.T0.AddSeconds(i)))
            .ToList();
        Assert.Equal(EventFloodGuard.MaxPerWindow, decisions.Count(d => d == EventFloodGuard.Decision.Allow));
        Assert.Equal(1, decisions.Count(d => d == EventFloodGuard.Decision.DropWithNotice));
        Assert.Equal(40 - EventFloodGuard.MaxPerWindow, guard.Dropped[FlightEventTypes.EngineStart]);
        // Los hitos del vuelo nunca se descartan.
        Assert.All(Enumerable.Range(0, 40), i => Assert.Equal(EventFloodGuard.Decision.Allow, guard.Check(FlightEventTypes.PhaseChange, Samples.T0.AddSeconds(i))));
        // Pasado el minuto, vuelve a dejar pasar.
        Assert.Equal(EventFloodGuard.Decision.Allow, guard.Check(FlightEventTypes.EngineStart, Samples.T0.AddSeconds(200)));
    }

    [Fact]
    public void El_vuelo_real_conserva_sus_eventos_de_motor()
    {
        var sink = new ListSink();
        var recorder = new FlightRecorder(sink);
        foreach (var s in Fixtures.Load("synthetic-mmmx-mmgl.jsonl")) recorder.Process(s);
        Assert.Empty(recorder.DroppedEvents);
        Assert.Equal(2, sink.Events.Count(e => e.Type == FlightEventTypes.EngineStart));
        Assert.Equal(2, sink.Events.Count(e => e.Type == FlightEventTypes.EngineShutdown));
    }
}
