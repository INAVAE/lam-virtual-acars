using System.Text.Json;
using LamAcars.Core.Api;
using LamAcars.Core.Models;
using Xunit;

namespace LamAcars.Core.Tests;

/// <summary>
/// Los modelos de C# deben producir exactamente los nombres de campo de los
/// ejemplos documentados, que a su vez valida Zod en packages/validation.
/// </summary>
public class ContractTests
{
    private static JsonElement Example(string name) =>
        JsonDocument.Parse(File.ReadAllText(Path.Combine(Fixtures.ContractDir, name))).RootElement;

    private static HashSet<string> Keys(JsonElement e) => e.EnumerateObject().Select(p => p.Name).ToHashSet();

    private static JsonElement Serialize(object value) =>
        JsonDocument.Parse(JsonSerializer.Serialize(value, value.GetType(), AcarsJson.Options)).RootElement;

    [Fact]
    public void Posicion()
    {
        var example = Example("position.request.json");
        var dto = new PositionRequest(Guid.NewGuid(), PositionDto.From(new PositionRecord(
            DateTimeOffset.UtcNow, 19.4, -99.1, 7316, 0, 0, 14, 52, 0, true, FlightPhase.TaxiOut)));
        var json = Serialize(dto);
        Assert.Equal(Keys(example), Keys(json));
        Assert.Equal(Keys(example.GetProperty("position")), Keys(json.GetProperty("position")));
        Assert.Equal("taxi_out", json.GetProperty("position").GetProperty("phase").GetString());
    }

    [Fact]
    public void Lote_de_traza()
    {
        var example = Example("track-batch.request.json");
        var point = TrackPointDto.From(new TrackPointRecord(0, DateTimeOffset.UtcNow, 19.4, -99.1, 7316, 140, 142, 52, 0, true, FlightPhase.Takeoff));
        var json = Serialize(new TrackBatchRequest(Guid.NewGuid(), [point]));
        Assert.Equal(Keys(example), Keys(json));
        Assert.Equal(Keys(example.GetProperty("points")[0]), Keys(json.GetProperty("points")[0]));
    }

    [Fact]
    public void Eventos()
    {
        var example = Example("events.request.json");
        var e = FlightEventDto.From(new FlightEventRecord(Guid.NewGuid(), 7, FlightEventTypes.PhaseChange, FlightPhase.Takeoff,
            DateTimeOffset.UtcNow, 19.4, -99.1, 7316, new Dictionary<string, object?> { ["from"] = "taxi_out", ["to"] = "takeoff" }));
        var json = Serialize(new EventsRequest(Guid.NewGuid(), [e]));
        Assert.Equal(Keys(example), Keys(json));
        Assert.Equal(Keys(example.GetProperty("events")[0]), Keys(json.GetProperty("events")[0]));
        // Las llaves de data no se convierten.
        Assert.Equal("taxi_out", json.GetProperty("events")[0].GetProperty("data").GetProperty("from").GetString());
    }

    [Theory]
    [InlineData("link-start.request.json")]
    [InlineData("link-poll.request.json")]
    [InlineData("session-start.request.json")]
    [InlineData("session-end.request.json")]
    public void Solicitudes_simples(string file)
    {
        var example = Example(file);
        object dto = file switch
        {
            "link-start.request.json" => new LinkStartRequest("PC", "0.1.0"),
            "link-poll.request.json" => new LinkPollRequest("K7QF-2M9P", new string('a', 43)),
            "session-start.request.json" => new SessionStartRequest(Guid.NewGuid(), new SimAircraft("t", "A320", "XA-MXL"), "0.1.0"),
            _ => new SessionEndRequest(Guid.NewGuid(), "completed", 21.0, -86.8),
        };
        var json = Serialize(dto);
        Assert.Equal(Keys(example), Keys(json));
        if (file == "session-start.request.json")
            Assert.Equal(Keys(example.GetProperty("aircraft")), Keys(json.GetProperty("aircraft")));
    }

    [Fact]
    public void Las_fases_coinciden_con_el_contrato()
    {
        var wire = Enum.GetValues<FlightPhase>().Select(p => p.ToWire()).ToArray();
        Assert.Equal(new[]
        {
            "aircraft_connected", "preflight", "engines_started", "pushback", "taxi_out", "takeoff", "initial_climb", "climb",
            "cruise", "descent", "approach", "landing", "taxi_in", "engines_shutdown", "flight_completed",
        }, wire);
        Assert.All(Enum.GetValues<FlightPhase>(), p => Assert.Equal(p, FlightPhaseExtensions.FromWire(p.ToWire())));
    }

    [Fact]
    public void Lee_la_respuesta_de_inicio_de_sesion()
    {
        const string json = """
            {"session_id":"0b9a8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d","resumed":false,"phase":"aircraft_connected","last_event_seq":null,"last_point_seq":null,
             "flight":{"flight_id":"6f1c1d5e-2a8b-4c3d-9e7f-1a2b3c4d5e6f","status":"in_progress","airline":{"name":"Líneas Aéreas Mexicanas","icao":"MXL"},
               "flight_number":"106","callsign":"MXL106",
               "origin":{"icao":"MMBT","name":"Huatulco","latitude":15.77,"longitude":-96.26,"elevation_ft":464},
               "destination":{"icao":"MMSD","name":"Los Cabos","latitude":23.15,"longitude":-109.72,"elevation_ft":374},
               "aircraft":{"icao":"A320","model":"A320","registration":"XA-MXL"},"planned_distance_nm":881,"planned_minutes":153,
               "scheduled_departure_at":null,"network":"IVAO","flight_plan_remarks":"IVAOVA/MXL","booking_expires_at":"2026-10-25T22:21:00+00:00",
               "has_ofp":true,"ofp":{"route":"HUX1F HUX UJ9","cruise_altitude_ft":36000,"block_fuel":8358,"fuel_units":"kg","alternate_icao":"MMLP","est_enroute_minutes":137}},
             "config":{"position_interval_s":10,"track_batch_interval_s":60,"max_points_per_batch":600,"max_events_per_call":50}}
            """;
        var r = JsonSerializer.Deserialize<SessionStartResponse>(json, AcarsJson.Options)!;
        Assert.Equal("MXL106", r.Flight.Callsign);
        Assert.Equal(36000, r.Flight.Ofp!.CruiseAltitudeFt);
        Assert.Null(r.LastEventSeq);
        Assert.Equal(10, r.Config.PositionIntervalS);
    }
}
