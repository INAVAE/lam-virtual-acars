using System.Text.Json;
using LamAcars.Core.Api;
using LamAcars.Core.Engine;
using LamAcars.Core.Models;

namespace LamAcars.Core.Tests;

internal static class Fixtures
{
    public static string Dir => Path.Combine(AppContext.BaseDirectory, "fixtures");
    public static string ContractDir => Path.Combine(AppContext.BaseDirectory, "contract");

    /// <summary>Lee una grabación en formato JSON por línea (el mismo que escribe «Grabar vuelo»).</summary>
    public static List<SimSample> Load(string name)
    {
        var list = new List<SimSample>();
        foreach (var line in File.ReadLines(Path.Combine(Dir, name)))
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            list.Add(JsonSerializer.Deserialize<SimSample>(line, AcarsJson.Options)!);
        }
        return list;
    }
}

internal sealed class ListSink : IFlightSink
{
    public List<FlightEventRecord> Events { get; } = new();
    public List<TrackPointRecord> Points { get; } = new();
    public List<PositionRecord> Positions { get; } = new();

    public void Event(FlightEventRecord e) => Events.Add(e);
    public void TrackPoint(TrackPointRecord p) => Points.Add(p);
    public void Position(PositionRecord p) => Positions.Add(p);
}

internal static class Samples
{
    public static readonly DateTimeOffset T0 = new(2026, 10, 25, 12, 0, 0, TimeSpan.Zero);

    public static SimSample Ground(int t, double gs = 0, int engines = 0, bool brake = false) => new()
    {
        Time = T0.AddSeconds(t),
        Latitude = 19.4363,
        Longitude = -99.0721,
        AltitudeFt = 7316,
        AglFt = 0,
        GsKt = gs,
        OnGround = true,
        EnginesRunning = engines,
        EngineCount = 2,
        ParkingBrake = brake,
    };

    public static SimSample Air(int t, double alt, double vs, double agl) => new()
    {
        Time = T0.AddSeconds(t),
        Latitude = 20,
        Longitude = -100,
        AltitudeFt = alt,
        AglFt = agl,
        GsKt = 300,
        IasKt = 250,
        VsFpm = vs,
        OnGround = false,
        EnginesRunning = 2,
        EngineCount = 2,
    };
}
