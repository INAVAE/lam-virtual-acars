using System.Net;
using System.Text;
using System.Text.Json;
using LamAcars.Core.Api;
using LamAcars.Core.Engine;
using LamAcars.Core.Models;
using LamAcars.Core.Storage;
using LamAcars.Core.Sync;
using Xunit;

namespace LamAcars.Core.Tests;

/// <summary>Servidor falso: registra lo recibido, simula cortes de red y descarta duplicados como el real.</summary>
internal sealed class FakeServer : HttpMessageHandler
{
    public bool Offline { get; set; }
    public HttpStatusCode? ForcedStatus { get; set; }
    public string ForcedCode { get; set; } = "server_error";
    public HashSet<Guid> EventIds { get; } = new();
    public List<int> EventSeqs { get; } = new();
    public HashSet<int> PointSeqs { get; } = new();
    public int DuplicateEvents { get; private set; }
    public int Calls { get; private set; }
    public List<string> Paths { get; } = new();

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        Calls++;
        if (Offline) throw new HttpRequestException("Sin red");
        var path = request.RequestUri!.AbsolutePath.Split("/v1/").Last();
        Paths.Add(path);
        if (ForcedStatus is { } status)
            return Json(status, $"{{\"error\":{{\"code\":\"{ForcedCode}\",\"message\":\"forzado\"}}}}");

        var body = request.Content is null ? "{}" : await request.Content.ReadAsStringAsync(ct);
        using var doc = JsonDocument.Parse(body);
        switch (path)
        {
            case "events":
            {
                var inserted = 0;
                foreach (var e in doc.RootElement.GetProperty("events").EnumerateArray())
                {
                    if (EventIds.Add(e.GetProperty("id").GetGuid()))
                    {
                        inserted++;
                        EventSeqs.Add(e.GetProperty("seq").GetInt32());
                    }
                    else DuplicateEvents++;
                }
                return Json(HttpStatusCode.OK, $"{{\"received\":{doc.RootElement.GetProperty("events").GetArrayLength()},\"inserted\":{inserted},\"duplicates\":0}}");
            }
            case "track-batch":
                foreach (var p in doc.RootElement.GetProperty("points").EnumerateArray()) PointSeqs.Add(p.GetProperty("seq").GetInt32());
                return Json(HttpStatusCode.OK, "{\"received\":1,\"inserted\":1,\"duplicates\":0}");
            case "position":
                return Json(HttpStatusCode.OK, "{\"ok\":true}");
            case "session/end":
                return Json(HttpStatusCode.OK, "{\"status\":\"completed\",\"flight_id\":null,\"final_airport\":\"MMGL\"}");
            default:
                return Json(HttpStatusCode.NotFound, "{\"error\":{\"code\":\"not_found\",\"message\":\"no\"}}");
        }
    }

    private static HttpResponseMessage Json(HttpStatusCode status, string json) =>
        new(status) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
}

public sealed class SyncTests : IDisposable
{
    private readonly string _dbPath = Path.Combine(Path.GetTempPath(), $"lam-acars-test-{Guid.NewGuid():N}.db");
    private readonly Guid _session = Guid.NewGuid();

    public void Dispose()
    {
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        foreach (var f in new[] { _dbPath, _dbPath + "-wal", _dbPath + "-shm" })
        {
            try { File.Delete(f); } catch (IOException) { }
        }
    }

    private static (AcarsApiClient Api, FakeServer Server) Api()
    {
        var server = new FakeServer();
        var api = new AcarsApiClient(new HttpClient(server), "https://example.test/functions/v1/acars/v1/") { Token = "lamd_" + new string('A', 43) };
        return (api, server);
    }

    private static Task NoDelay(TimeSpan _, CancellationToken __) => Task.CompletedTask;

    /// <summary>Graba el vuelo sintético completo en la cola local.</summary>
    private (Outbox Outbox, ListSink Produced) RecordFlight(int upToSample = int.MaxValue)
    {
        var outbox = new Outbox(_dbPath);
        var local = new LocalSession(_session, Guid.NewGuid(), "MXL100", "aircraft_connected", 0, 0, false);
        outbox.SaveSession(local);
        FlightRecorder? recorder = null;
        var sink = new OutboxSink(outbox, local, () => recorder);
        var produced = new ListSink();
        recorder = new FlightRecorder(new TeeSink(sink, produced));
        var i = 0;
        foreach (var s in Fixtures.Load("synthetic-mmmx-mmgl.jsonl"))
        {
            if (i++ >= upToSample) break;
            recorder.Process(s);
        }
        return (outbox, produced);
    }

    [Fact]
    public async Task Sin_internet_no_se_pierde_nada_y_al_volver_se_envia_sin_duplicados()
    {
        var (outbox, produced) = RecordFlight();
        var (api, server) = Api();
        var sync = new SyncWorker(outbox, api, NoDelay);

        // Se corta internet: nada sale, todo queda en la cola.
        server.Offline = true;
        await sync.FlushOnceAsync();
        Assert.Equal(SyncState.Offline, sync.State);
        Assert.Equal(produced.Events.Count + produced.Points.Count, outbox.PendingCount(_session));

        // Vuelve internet.
        server.Offline = false;
        while (await sync.FlushOnceAsync() > 0) { }

        Assert.Equal(SyncState.Online, sync.State);
        Assert.Equal(0, outbox.PendingCount(_session));
        Assert.Equal(produced.Events.Select(e => e.Id).ToHashSet(), server.EventIds);
        Assert.Equal(produced.Events.Select(e => e.Seq), server.EventSeqs);  // en orden
        Assert.Equal(produced.Points.Select(p => p.Seq).ToHashSet(), server.PointSeqs);
        Assert.Equal(0, server.DuplicateEvents);
    }

    [Fact]
    public async Task Si_la_respuesta_se_pierde_el_reenvio_no_duplica()
    {
        var (outbox, produced) = RecordFlight(upToSample: 700);
        var (api, server) = Api();
        var sync = new SyncWorker(outbox, api, NoDelay);
        while (await sync.FlushOnceAsync() > 0) { }

        // Simula que el conector no recibió la confirmación: vuelve a encolar los mismos eventos.
        foreach (var e in produced.Events) outbox.Enqueue(_session, OutboxKind.Event, JsonSerializer.Serialize(FlightEventDto.From(e), AcarsJson.Options));
        while (await sync.FlushOnceAsync() > 0) { }

        Assert.Equal(produced.Events.Count, server.EventIds.Count);
        Assert.Equal(produced.Events.Count, server.DuplicateEvents);
    }

    [Fact]
    public void La_cola_sobrevive_a_un_reinicio_del_conector()
    {
        var (outbox, produced) = RecordFlight(upToSample: 1000);
        var pending = outbox.PendingCount(_session);
        outbox.Dispose();

        using var reopened = new Outbox(_dbPath);
        Assert.Equal(pending, reopened.PendingCount(_session));
        var session = Assert.Single(reopened.OpenSessions());
        Assert.Equal(produced.Events.Count, session.NextEventSeq);
        Assert.Equal(produced.Points.Count, session.NextPointSeq);
        Assert.Equal("climb", session.Phase);
    }

    [Fact]
    public async Task Un_dispositivo_revocado_detiene_el_envio_y_conserva_la_cola()
    {
        var (outbox, _) = RecordFlight(upToSample: 300);
        var (api, server) = Api();
        server.ForcedStatus = HttpStatusCode.Unauthorized;
        server.ForcedCode = "device_revoked";
        var sync = new SyncWorker(outbox, api, NoDelay);

        await sync.FlushOnceAsync();
        Assert.Equal(SyncState.Unauthorized, sync.State);
        Assert.True(outbox.PendingCount(_session) > 0);
        Assert.Equal(1, server.Calls);
    }

    [Fact]
    public async Task Una_sesion_cerrada_en_el_servidor_se_olvida()
    {
        var (outbox, _) = RecordFlight(upToSample: 300);
        var (api, server) = Api();
        server.ForcedStatus = HttpStatusCode.Conflict;
        server.ForcedCode = "session_closed";
        var sync = new SyncWorker(outbox, api, NoDelay);
        Guid? closed = null;
        sync.SessionClosed += (id, _) => closed = id;

        await sync.FlushOnceAsync();
        Assert.Equal(_session, closed);
        Assert.Equal(0, outbox.PendingCount(_session));
        Assert.True(outbox.DeadLetterCount() > 0);
    }

    [Fact]
    public async Task El_cierre_se_envia_al_final()
    {
        var (outbox, _) = RecordFlight();
        outbox.Enqueue(_session, OutboxKind.End, JsonSerializer.Serialize(new SessionEndRequest(_session, "completed", 20.52, -103.31), AcarsJson.Options));
        var (api, server) = Api();
        var sync = new SyncWorker(outbox, api, NoDelay);
        SessionEndResponse? ended = null;
        sync.SessionEnded += (_, r) => ended = r;

        while (await sync.FlushOnceAsync() > 0) { }

        Assert.Equal("session/end", server.Paths.Last());
        Assert.Equal("MMGL", ended?.FinalAirport);
        Assert.Empty(outbox.OpenSessions());
    }

    [Fact]
    public void La_posicion_viva_conserva_solo_la_ultima()
    {
        using var outbox = new Outbox(_dbPath);
        outbox.Enqueue(_session, OutboxKind.Position, "{\"n\":1}");
        outbox.Enqueue(_session, OutboxKind.Position, "{\"n\":2}");
        var item = Assert.Single(outbox.Peek(_session, OutboxKind.Position, 10));
        Assert.Equal("{\"n\":2}", item.Payload);
    }
}

internal sealed class TeeSink(params IFlightSink[] sinks) : IFlightSink
{
    public void Event(FlightEventRecord e) { foreach (var s in sinks) s.Event(e); }
    public void TrackPoint(TrackPointRecord p) { foreach (var s in sinks) s.TrackPoint(p); }
    public void Position(PositionRecord p) { foreach (var s in sinks) s.Position(p); }
}
