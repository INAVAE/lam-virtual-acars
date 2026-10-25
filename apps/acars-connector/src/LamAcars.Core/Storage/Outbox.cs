using System.Globalization;
using System.Text.Json;
using LamAcars.Core.Api;
using LamAcars.Core.Engine;
using LamAcars.Core.Models;
using Microsoft.Data.Sqlite;

namespace LamAcars.Core.Storage;

public enum OutboxKind
{
    Event,
    Point,
    Position,
    End,
}

public sealed record OutboxItem(long Id, Guid SessionId, OutboxKind Kind, string Payload, int Attempts);

/// <summary>Estado local de una sesión: lo necesario para reanudar sin repetir secuencias.</summary>
public sealed record LocalSession(Guid SessionId, Guid FlightId, string Callsign, string Phase, int NextEventSeq, int NextPointSeq, bool EndRequested);

/// <summary>
/// Cola local en SQLite. Todo lo que el conector produce se guarda aquí antes
/// de enviarse; si no hay internet o el equipo se reinicia, nada se pierde.
/// Cada evento y punto conserva su id y secuencia, así que reenviar es seguro.
/// </summary>
public sealed class Outbox : IDisposable
{
    private readonly SqliteConnection _db;
    private readonly object _gate = new();

    public Outbox(string path)
    {
        var builder = new SqliteConnectionStringBuilder { DataSource = path, Mode = SqliteOpenMode.ReadWriteCreate, Cache = SqliteCacheMode.Private };
        _db = new SqliteConnection(builder.ToString());
        _db.Open();
        Execute("""
            pragma journal_mode = wal;
            pragma synchronous = normal;
            create table if not exists outbox (
              id integer primary key autoincrement,
              session_id text not null,
              kind integer not null,
              payload text not null,
              created_at text not null,
              attempts integer not null default 0,
              last_error text
            );
            create index if not exists outbox_session_kind on outbox (session_id, kind, id);
            create table if not exists sessions (
              session_id text primary key,
              flight_id text not null,
              callsign text not null,
              phase text not null,
              next_event_seq integer not null,
              next_point_seq integer not null,
              end_requested integer not null default 0,
              updated_at text not null
            );
            create table if not exists dead_letters (
              id integer primary key autoincrement,
              session_id text not null,
              kind integer not null,
              payload text not null,
              error text not null,
              created_at text not null
            );
            """);
    }

    public void Dispose() => _db.Dispose();

    // ------------------------------------------------------------------------
    // Sesiones
    // ------------------------------------------------------------------------
    public void SaveSession(LocalSession s)
    {
        Execute("""
            insert into sessions (session_id, flight_id, callsign, phase, next_event_seq, next_point_seq, end_requested, updated_at)
            values ($sid, $fid, $cs, $phase, $ev, $pt, $end, $now)
            on conflict (session_id) do update set
              phase = excluded.phase,
              next_event_seq = max(sessions.next_event_seq, excluded.next_event_seq),
              next_point_seq = max(sessions.next_point_seq, excluded.next_point_seq),
              end_requested = max(sessions.end_requested, excluded.end_requested),
              updated_at = excluded.updated_at
            """,
            ("$sid", s.SessionId.ToString()), ("$fid", s.FlightId.ToString()), ("$cs", s.Callsign), ("$phase", s.Phase),
            ("$ev", s.NextEventSeq), ("$pt", s.NextPointSeq), ("$end", s.EndRequested ? 1 : 0), ("$now", Now()));
    }

    public LocalSession? GetSession(Guid sessionId)
    {
        lock (_gate)
        {
            using var cmd = _db.CreateCommand();
            cmd.CommandText = "select session_id, flight_id, callsign, phase, next_event_seq, next_point_seq, end_requested from sessions where session_id = $sid";
            cmd.Parameters.AddWithValue("$sid", sessionId.ToString());
            using var r = cmd.ExecuteReader();
            return r.Read() ? ReadSession(r) : null;
        }
    }

    /// <summary>Sesiones con algo pendiente o sin cerrar (para reanudar al abrir el conector).</summary>
    public IReadOnlyList<LocalSession> OpenSessions()
    {
        lock (_gate)
        {
            using var cmd = _db.CreateCommand();
            cmd.CommandText = """
                select s.session_id, s.flight_id, s.callsign, s.phase, s.next_event_seq, s.next_point_seq, s.end_requested
                from sessions s
                where s.end_requested = 0 or exists (select 1 from outbox o where o.session_id = s.session_id)
                order by s.updated_at desc
                """;
            using var r = cmd.ExecuteReader();
            var list = new List<LocalSession>();
            while (r.Read()) list.Add(ReadSession(r));
            return list;
        }
    }

    /// <summary>Olvida una sesión cerrada en el servidor (y lo que quedara pendiente de ella).</summary>
    public void ForgetSession(Guid sessionId, string reason)
    {
        lock (_gate)
        {
            using var tx = _db.BeginTransaction();
            Run(tx, """
                insert into dead_letters (session_id, kind, payload, error, created_at)
                select session_id, kind, payload, $reason, $now from outbox where session_id = $sid and kind <> $pos
                """, ("$sid", sessionId.ToString()), ("$reason", reason), ("$now", Now()), ("$pos", (int)OutboxKind.Position));
            Run(tx, "delete from outbox where session_id = $sid", ("$sid", sessionId.ToString()));
            Run(tx, "delete from sessions where session_id = $sid", ("$sid", sessionId.ToString()));
            tx.Commit();
        }
    }

    // ------------------------------------------------------------------------
    // Cola
    // ------------------------------------------------------------------------
    public void Enqueue(Guid sessionId, OutboxKind kind, string payload)
    {
        lock (_gate)
        {
            using var tx = _db.BeginTransaction();
            // De la posición viva solo importa la última.
            if (kind == OutboxKind.Position)
                Run(tx, "delete from outbox where session_id = $sid and kind = $k", ("$sid", sessionId.ToString()), ("$k", (int)kind));
            Run(tx, "insert into outbox (session_id, kind, payload, created_at) values ($sid, $k, $p, $now)",
                ("$sid", sessionId.ToString()), ("$k", (int)kind), ("$p", payload), ("$now", Now()));
            tx.Commit();
        }
    }

    public IReadOnlyList<OutboxItem> Peek(Guid sessionId, OutboxKind kind, int limit)
    {
        lock (_gate)
        {
            using var cmd = _db.CreateCommand();
            cmd.CommandText = "select id, session_id, kind, payload, attempts from outbox where session_id = $sid and kind = $k order by id limit $n";
            cmd.Parameters.AddWithValue("$sid", sessionId.ToString());
            cmd.Parameters.AddWithValue("$k", (int)kind);
            cmd.Parameters.AddWithValue("$n", limit);
            using var r = cmd.ExecuteReader();
            var list = new List<OutboxItem>();
            while (r.Read())
                list.Add(new OutboxItem(r.GetInt64(0), Guid.Parse(r.GetString(1)), (OutboxKind)r.GetInt32(2), r.GetString(3), r.GetInt32(4)));
            return list;
        }
    }

    /// <summary>Sesiones con elementos en la cola.</summary>
    public IReadOnlyList<Guid> SessionsWithPending()
    {
        lock (_gate)
        {
            using var cmd = _db.CreateCommand();
            cmd.CommandText = "select distinct session_id from outbox order by session_id";
            using var r = cmd.ExecuteReader();
            var list = new List<Guid>();
            while (r.Read()) list.Add(Guid.Parse(r.GetString(0)));
            return list;
        }
    }

    public void Ack(IEnumerable<long> ids) => Delete(ids);

    public void MarkFailed(IEnumerable<long> ids, string error)
    {
        lock (_gate)
        {
            using var tx = _db.BeginTransaction();
            foreach (var id in ids)
                Run(tx, "update outbox set attempts = attempts + 1, last_error = $e where id = $id", ("$e", error), ("$id", id));
            tx.Commit();
        }
    }

    /// <summary>Aparta elementos que el servidor rechaza por formato, para no bloquear la cola.</summary>
    public void DeadLetter(IEnumerable<long> ids, string error)
    {
        lock (_gate)
        {
            using var tx = _db.BeginTransaction();
            foreach (var id in ids)
            {
                Run(tx, """
                    insert into dead_letters (session_id, kind, payload, error, created_at)
                    select session_id, kind, payload, $e, $now from outbox where id = $id
                    """, ("$e", error), ("$now", Now()), ("$id", id));
                Run(tx, "delete from outbox where id = $id", ("$id", id));
            }
            tx.Commit();
        }
    }

    public int PendingCount(Guid? sessionId = null)
    {
        lock (_gate)
        {
            using var cmd = _db.CreateCommand();
            cmd.CommandText = sessionId is null
                ? "select count(*) from outbox where kind <> $pos"
                : "select count(*) from outbox where kind <> $pos and session_id = $sid";
            cmd.Parameters.AddWithValue("$pos", (int)OutboxKind.Position);
            if (sessionId is { } sid) cmd.Parameters.AddWithValue("$sid", sid.ToString());
            return Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
        }
    }

    public int DeadLetterCount()
    {
        lock (_gate)
        {
            using var cmd = _db.CreateCommand();
            cmd.CommandText = "select count(*) from dead_letters";
            return Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
        }
    }

    private void Delete(IEnumerable<long> ids)
    {
        lock (_gate)
        {
            using var tx = _db.BeginTransaction();
            foreach (var id in ids) Run(tx, "delete from outbox where id = $id", ("$id", id));
            tx.Commit();
        }
    }

    private void Execute(string sql, params (string Name, object Value)[] args)
    {
        lock (_gate)
        {
            using var cmd = _db.CreateCommand();
            cmd.CommandText = sql;
            foreach (var (name, value) in args) cmd.Parameters.AddWithValue(name, value);
            cmd.ExecuteNonQuery();
        }
    }

    private void Run(SqliteTransaction tx, string sql, params (string Name, object Value)[] args)
    {
        using var cmd = _db.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = sql;
        foreach (var (name, value) in args) cmd.Parameters.AddWithValue(name, value);
        cmd.ExecuteNonQuery();
    }

    private static LocalSession ReadSession(SqliteDataReader r) => new(
        Guid.Parse(r.GetString(0)), Guid.Parse(r.GetString(1)), r.GetString(2), r.GetString(3), r.GetInt32(4), r.GetInt32(5), r.GetInt32(6) == 1);

    private static string Now() => DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture);
}

/// <summary>Sumidero del registrador que escribe en la cola local y guarda las secuencias.</summary>
public sealed class OutboxSink(Outbox outbox, LocalSession session, Func<FlightRecorder?> recorder) : IFlightSink
{
    public LocalSession Session { get; private set; } = session;

    public void Event(FlightEventRecord e)
    {
        outbox.Enqueue(Session.SessionId, OutboxKind.Event, JsonSerializer.Serialize(FlightEventDto.From(e), AcarsJson.Options));
        Persist();
    }

    public void TrackPoint(TrackPointRecord p)
    {
        outbox.Enqueue(Session.SessionId, OutboxKind.Point, JsonSerializer.Serialize(TrackPointDto.From(p), AcarsJson.Options));
        Persist();
    }

    public void Position(PositionRecord p) =>
        outbox.Enqueue(Session.SessionId, OutboxKind.Position, JsonSerializer.Serialize(PositionDto.From(p), AcarsJson.Options));

    /// <summary>Guarda la fase y las próximas secuencias para reanudar sin repetirlas.</summary>
    public void Persist()
    {
        if (recorder() is not { } r) return;
        Session = Session with { Phase = r.Phase.ToWire(), NextEventSeq = r.NextEventSeq, NextPointSeq = r.NextPointSeq };
        outbox.SaveSession(Session);
    }
}
