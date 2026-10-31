using System.Text.Json;
using System.Text.Json.Serialization;
using LamAcars.Core.Models;

namespace LamAcars.Core.Api;

/// <summary>
/// Modelos del contrato ACARS v1 (packages/validation/src/acars.ts). Los nombres
/// se serializan en snake_case. Las pruebas comparan estos modelos con los
/// ejemplos de docs/integrations/acars-v1-examples.
/// </summary>
public static class AcarsJson
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DictionaryKeyPolicy = null,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        PropertyNameCaseInsensitive = true,
    };
}

// ----------------------------------------------------------------------------
// Vinculación
// ----------------------------------------------------------------------------
public sealed record LinkStartRequest(string DeviceName, string AppVersion);
public sealed record LinkStartResponse(string Code, string PollSecret, DateTimeOffset ExpiresAt, int PollIntervalS);
public sealed record LinkPollRequest(string Code, string PollSecret);
public sealed record PilotInfo(string DisplayName, int PilotNumber);
public sealed record LinkPollResponse(string Status, string? Token, Guid? DeviceId, PilotInfo? Pilot);

// ----------------------------------------------------------------------------
// Piloto y vuelos
// ----------------------------------------------------------------------------
public sealed record AirportInfo(string Icao, string Name, double Latitude, double Longitude, double? ElevationFt);
public sealed record AirlineInfo(string Name, string Icao);
public sealed record AircraftInfo(string Icao, string Model, string Registration);
public sealed record OfpSummary(string? Route, double? CruiseAltitudeFt, double? BlockFuel, string? FuelUnits, string? AlternateIcao, double? EstEnrouteMinutes);

public sealed record FlightInfo(
    Guid FlightId,
    string Status,
    AirlineInfo Airline,
    string FlightNumber,
    string Callsign,
    AirportInfo Origin,
    AirportInfo Destination,
    AircraftInfo Aircraft,
    int PlannedDistanceNm,
    int PlannedMinutes,
    DateTimeOffset? ScheduledDepartureAt,
    string Network,
    string? FlightPlanRemarks,
    DateTimeOffset? BookingExpiresAt,
    bool HasOfp,
    OfpSummary? Ofp)
{
    public string Display => $"{Callsign} · {Origin.Icao} → {Destination.Icao} · {Aircraft.Icao} {Aircraft.Registration}";
}

public sealed record DeviceInfo(Guid Id, string Name);
public sealed record ActiveSessionInfo(Guid SessionId, Guid FlightId, string Phase);
public sealed record MeResponse(DeviceInfo Device, PilotInfo Pilot, ActiveSessionInfo? ActiveSession, IReadOnlyList<FlightInfo> Flights);

// ----------------------------------------------------------------------------
// Sesión
// ----------------------------------------------------------------------------
public sealed record SimAircraft(string? Title, string? Icao, string? Registration);
public sealed record SessionStartRequest(Guid FlightId, SimAircraft Aircraft, string ClientVersion);
public sealed record SessionConfig(int PositionIntervalS, int TrackBatchIntervalS, int MaxPointsPerBatch, int MaxEventsPerCall);
public sealed record SessionStartResponse(
    Guid SessionId,
    bool Resumed,
    string Phase,
    int? LastEventSeq,
    int? LastPointSeq,
    FlightInfo Flight,
    SessionConfig Config);

public sealed record PositionDto(
    DateTimeOffset SampledAt,
    double Latitude,
    double Longitude,
    double AltitudeFt,
    double? AglFt,
    double? IasKt,
    double? GsKt,
    double? HeadingDeg,
    double? VsFpm,
    bool OnGround,
    string Phase,
    double? WindDirDeg = null,
    double? WindKt = null)
{
    public static PositionDto From(PositionRecord p) => new(
        p.SampledAt.ToUniversalTime(), p.Latitude, p.Longitude, Clamp(p.AltitudeFt, -2000, 70000),
        p.AglFt is { } agl ? Clamp(agl, -100, 70000) : null,
        p.IasKt is { } ias ? Clamp(ias, 0, 1000) : null,
        p.GsKt is { } gs ? Clamp(gs, 0, 2000) : null,
        p.HeadingDeg is { } h ? NormalizeHeading(h) : null,
        p.VsFpm is { } vs ? Clamp(vs, -20000, 20000) : null,
        p.OnGround, p.Phase.ToWire(), WindDir(p.WindDirDeg), WindSpeed(p.WindKt));

    internal static double? WindDir(double? d) => d is { } v && double.IsFinite(v) ? Math.Round(((v % 360) + 360) % 360) : null;
    internal static double? WindSpeed(double? k) => k is { } v && double.IsFinite(v) ? Math.Round(Math.Clamp(v, 0, 400)) : null;

    internal static double Clamp(double v, double min, double max) => Math.Round(Math.Min(max, Math.Max(min, v)), 6);
    internal static double NormalizeHeading(double h) => Math.Round(((h % 360) + 360) % 360, 1);
}

public sealed record PositionRequest(Guid SessionId, PositionDto Position);

public sealed record TrackPointDto(
    int Seq,
    DateTimeOffset SampledAt,
    double Latitude,
    double Longitude,
    double AltitudeFt,
    double? IasKt,
    double? GsKt,
    double? HeadingDeg,
    double? VsFpm,
    bool OnGround,
    string Phase,
    double? FuelKg,
    double? WindDirDeg = null,
    double? WindKt = null)
{
    public static TrackPointDto From(TrackPointRecord p) => new(
        p.Seq, p.SampledAt.ToUniversalTime(), p.Latitude, p.Longitude, PositionDto.Clamp(p.AltitudeFt, -2000, 70000),
        p.IasKt is { } ias ? PositionDto.Clamp(ias, 0, 1000) : null,
        p.GsKt is { } gs ? PositionDto.Clamp(gs, 0, 2000) : null,
        p.HeadingDeg is { } h ? PositionDto.NormalizeHeading(h) : null,
        p.VsFpm is { } vs ? PositionDto.Clamp(vs, -20000, 20000) : null,
        p.OnGround, p.Phase.ToWire(),
        p.FuelKg is { } fuel && double.IsFinite(fuel) ? Math.Round(Math.Clamp(fuel, 0, 1_000_000)) : null,
        PositionDto.WindDir(p.WindDirDeg), PositionDto.WindSpeed(p.WindKt));
}

public sealed record TrackBatchRequest(Guid SessionId, IReadOnlyList<TrackPointDto> Points);

public sealed record FlightEventDto(
    Guid Id,
    int Seq,
    string Type,
    string Phase,
    DateTimeOffset OccurredAt,
    double? Latitude,
    double? Longitude,
    double? AltitudeFt,
    IReadOnlyDictionary<string, object?> Data)
{
    public static FlightEventDto From(FlightEventRecord e) => new(
        e.Id, e.Seq, e.Type, e.Phase.ToWire(), e.OccurredAt.ToUniversalTime(), e.Latitude, e.Longitude,
        e.AltitudeFt is { } a ? PositionDto.Clamp(a, -2000, 70000) : null, e.Data);
}

public sealed record EventsRequest(Guid SessionId, IReadOnlyList<FlightEventDto> Events);
public sealed record IngestResponse(int Received, int Inserted, int Duplicates);

public sealed record SessionEndRequest(Guid SessionId, string Reason, double? Latitude, double? Longitude);
public sealed record SessionEndResponse(string Status, Guid? FlightId, string? FinalAirport, bool? AlreadyClosed);

public sealed record ApiErrorBody(string Code, string Message);
public sealed record ApiErrorEnvelope(ApiErrorBody Error);
