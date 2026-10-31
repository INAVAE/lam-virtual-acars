using System.Buffers.Binary;
using System.Text.RegularExpressions;
using LamAcars.Core.Models;

namespace LamAcars.Core.Aircraft;

/// <summary>Área de datos de cliente (SimConnect ClientData) que publica una aeronave.</summary>
public sealed record ClientDataArea(string Name, uint Id, uint DefinitionId, int Size);

/// <summary>Adaptador que además lee un área de ClientData publicada por la aeronave.</summary>
public interface IClientDataAdapter : IAircraftAdapter
{
    ClientDataArea ClientData { get; }

    /// <summary>Lee el bloque recibido y escribe sus valores (con prefijo propio) en <paramref name="values"/>.</summary>
    void Read(ReadOnlySpan<byte> data, IDictionary<string, double> values);
}

/// <summary>
/// Base de los adaptadores PMDG. El avión publica su estado en un bloque de
/// ClientData (SDK de PMDG) solo si el piloto activó EnableDataBroadcast=1 en el
/// archivo *_Options.ini. Sin ese bloque, el adaptador se comporta igual que el
/// genérico; con él, toma el freno de estacionamiento, la palanca del tren, los
/// flaps en grados y la variante exacta del avión.
/// </summary>
public abstract class PmdgAdapter : GenericAdapter, IClientDataAdapter
{
    public const string KeyParkingBrake = "PMDG:PARKING_BRAKE";
    public const string KeyGearDown = "PMDG:GEAR_DOWN";
    public const string KeyFlapsDeg = "PMDG:FLAPS_DEG";
    public const string KeyModel = "PMDG:MODEL";
    public const string KeyFuelLbs = "PMDG:FUEL_LBS";
    public const string KeyApuRunning = "PMDG:APU_RUNNING";

    public abstract ClientDataArea ClientData { get; }

    public override IReadOnlyList<string> Diagnostics { get; } =
        new[] { KeyModel, KeyParkingBrake, KeyGearDown, KeyFlapsDeg, KeyApuRunning, "BRAKE PARKING POSITION", "GEAR HANDLE POSITION", "APU PCT RPM" };

    public void Read(ReadOnlySpan<byte> data, IDictionary<string, double> values)
    {
        if (data.Length < ClientData.Size) return;
        ReadFields(data, values);
    }

    protected abstract void ReadFields(ReadOnlySpan<byte> data, IDictionary<string, double> values);

    protected abstract string? IcaoForModel(int model);

    /// <summary>true si el SDK da la posición real de los flaps; false si solo da el retén de la palanca (se usa a falta del dato estándar).</summary>
    protected virtual bool SdkFlapsAreActual => true;

    public override string? IdentifyIcao(IReadOnlyDictionary<string, double> values) =>
        values.TryGetValue(KeyModel, out var model) ? IcaoForModel((int)model) : null;

    public override SimSample Map(IReadOnlyDictionary<string, double> values, DateTimeOffset time, bool paused)
    {
        var sample = base.Map(values, time, paused);
        if (!values.ContainsKey(KeyModel)) return sample;   // sin datos del SDK: lectura genérica

        return sample with
        {
            ParkingBrake = sample.ParkingBrake || values.GetValueOrDefault(KeyParkingBrake) > 0.5,
            GearDown = values.TryGetValue(KeyGearDown, out var gear) ? gear > 0.5 : sample.GearDown,
            FlapsDeg = values.TryGetValue(KeyFlapsDeg, out var flaps) && (SdkFlapsAreActual || sample.FlapsDeg is null) ? flaps : sample.FlapsDeg,
            FuelTotalKg = sample.FuelTotalKg ?? (values.TryGetValue(KeyFuelLbs, out var lbs) ? lbs * 0.45359237 : (double?)null),
            ApuRunning = values.TryGetValue(KeyApuRunning, out var apu) ? apu > 0.5 : sample.ApuRunning,
        };
    }

    protected static bool Bool(ReadOnlySpan<byte> data, int offset) => data[offset] != 0;

    protected static float Float(ReadOnlySpan<byte> data, int offset) => BinaryPrimitives.ReadSingleLittleEndian(data[offset..]);

    protected static double Fuel(params float[] tanks) => tanks.Where(float.IsFinite).Sum(t => Math.Max(0, (double)t));
}

/// <summary>
/// PMDG 737 (NG3: -600/-700/-800/-900, BBJ y cargueros) para MSFS 2024.
/// Desplazamientos de <c>struct PMDG_NG3_Data</c> (pmdg_ng3_sdk.h), calculados
/// con offsetof sobre el encabezado del SDK; tamaño total 916 bytes.
/// </summary>
public sealed class Pmdg737Adapter : PmdgAdapter
{
    public static readonly ClientDataArea Area = new("PMDG_NG3_Data", 0x4E473331, 0x4E473332, 916);

    public const int FuelCenter = 116;        // float LBS
    public const int FuelLeft = 120;          // float LBS
    public const int FuelRight = 124;         // float LBS
    public const int TeFlapsNeedle = 492;     // float[2], grados
    public const int GearLever = 506;         // uchar: 0 UP, 1 OFF, 2 DOWN
    public const int ParkingBrakeAnnun = 574; // bool
    public const int AircraftModel = 654;     // ushort
    public const int ApuEgtNeedle = 200;      // float, °C
    public const int ApuSelector = 379;       // uchar: 0 OFF, 1 ON, 2 START

    private static readonly Regex Title = new(@"\b737-?[6789]00|\bPMDG\b.*\b737\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public override string Name => "PMDG 737";

    public override ClientDataArea ClientData => Area;

    public override bool Matches(AircraftIdentity aircraft) =>
        Title.IsMatch(aircraft.Title) && !aircraft.Title.Contains("MAX", StringComparison.OrdinalIgnoreCase);

    protected override void ReadFields(ReadOnlySpan<byte> d, IDictionary<string, double> v)
    {
        v[KeyParkingBrake] = Bool(d, ParkingBrakeAnnun) ? 1 : 0;
        v[KeyGearDown] = d[GearLever] == 2 ? 1 : 0;
        v[KeyFlapsDeg] = Math.Round(Float(d, TeFlapsNeedle), 1);
        v[KeyModel] = BinaryPrimitives.ReadUInt16LittleEndian(d[AircraftModel..]);
        v[KeyFuelLbs] = Fuel(Float(d, FuelCenter), Float(d, FuelLeft), Float(d, FuelRight));
        // El SDK del 737 no publica "APU en marcha": selector en ON/START y EGT de APU encendida.
        v[KeyApuRunning] = d[ApuSelector] >= 1 && Float(d, ApuEgtNeedle) > 300 ? 1 : 0;
    }

    protected override string? IcaoForModel(int model) => model switch
    {
        1 => "B736",
        2 or 3 or 4 or 13 or 14 or 19 or 20 => "B737",
        5 or 6 or 7 or (>= 15 and <= 18) or 21 or 22 => "B738",
        >= 8 and <= 12 => "B739",
        _ => null,
    };
}

/// <summary>
/// PMDG 777 (-200ER, -300ER, 777F, -200LR). Desplazamientos de
/// <c>struct PMDG_777X_Data</c> (PMDG_777X_SDK.h); tamaño total 684 bytes.
/// </summary>
public sealed class Pmdg777Adapter : PmdgAdapter
{
    public static readonly ClientDataArea Area = new("PMDG_777X_Data", 0x504D4447, 0x504D4448, 684);

    public const int GearLever = 212;          // uchar: 0 UP, 1 DOWN
    public const int FlapsLever = 421;         // uchar: 0 UP, 1: 1, 2: 5, 3: 15, 4: 20, 5: 25, 6: 30
    public const int ParkingBrakeLever = 424;  // bool
    public const int FuelCenter = 496;         // float LBS
    public const int FuelLeft = 500;
    public const int FuelRight = 504;
    public const int FuelAux = 508;
    public const int AircraftModel = 542;      // uchar
    public const int ApuRunningFlag = 586;     // bool

    private static readonly double[] FlapDetents = { 0, 1, 5, 15, 20, 25, 30 };
    private static readonly Regex Title = new(@"\b777-?(200|300|F)|\b777F\b|\bB?77[WL]\b|\bPMDG\b.*\b777\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public override string Name => "PMDG 777";

    public override ClientDataArea ClientData => Area;

    protected override bool SdkFlapsAreActual => false;

    public override bool Matches(AircraftIdentity aircraft) => Title.IsMatch(aircraft.Title);

    protected override void ReadFields(ReadOnlySpan<byte> d, IDictionary<string, double> v)
    {
        v[KeyParkingBrake] = Bool(d, ParkingBrakeLever) ? 1 : 0;
        v[KeyGearDown] = d[GearLever] == 1 ? 1 : 0;
        if (d[FlapsLever] < FlapDetents.Length) v[KeyFlapsDeg] = FlapDetents[d[FlapsLever]];
        v[KeyModel] = d[AircraftModel];
        v[KeyFuelLbs] = Fuel(Float(d, FuelCenter), Float(d, FuelLeft), Float(d, FuelRight), Float(d, FuelAux));
        v[KeyApuRunning] = Bool(d, ApuRunningFlag) ? 1 : 0;
    }

    protected override string? IcaoForModel(int model) => model switch
    {
        1 or 2 => "B772",
        3 => "B773",
        4 or 5 => "B77L",
        6 => "B77W",
        _ => null,
    };
}
