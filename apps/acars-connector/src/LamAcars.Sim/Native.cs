using System.Runtime.InteropServices;

namespace LamAcars.Sim;

/// <summary>
/// Declaraciones mínimas de la API C de SimConnect (SimConnect.h del SDK de
/// MSFS 2024). Todas las estructuras de SimConnect usan empaquetado de 1 byte.
/// </summary>
internal static class Native
{
    private const string Dll = "SimConnect.dll";

    public const int S_OK = 0;
    public const uint UNUSED = 0xFFFFFFFF;
    public const uint USER_OBJECT = 0;

    public enum DataType : uint
    {
        Invalid = 0,
        Int32 = 1,
        Int64 = 2,
        Float32 = 3,
        Float64 = 4,
        String8 = 5,
        String32 = 6,
        String64 = 7,
        String128 = 8,
        String256 = 9,
        String260 = 10,
    }

    public enum Period : uint
    {
        Never = 0,
        Once = 1,
        VisualFrame = 2,
        SimFrame = 3,
        Second = 4,
    }

    [Flags]
    public enum RequestFlags : uint
    {
        Default = 0,
        Changed = 1,
        Tagged = 2,
    }

    public enum RecvId : uint
    {
        Null = 0,
        Exception = 1,
        Open = 2,
        Quit = 3,
        Event = 4,
        SimObjectData = 8,
        SystemState = 15,
    }

    // Desplazamientos dentro de los mensajes (SIMCONNECT_RECV mide 12 bytes).
    public const int RecvHeaderSize = 12;
    public const int SimObjectDataHeaderSize = 40;   // + dwRequestID…dwDefineCount
    public const int OffsetRequestId = 12;
    public const int OffsetDefineCount = 36;
    public const int OffsetEventId = 16;
    public const int OffsetEventData = 20;
    public const int OffsetException = 12;
    public const int OffsetExceptionSendId = 16;
    public const int OffsetExceptionIndex = 20;

    [DllImport(Dll, CharSet = CharSet.Ansi, ExactSpelling = true)]
    public static extern int SimConnect_Open(out IntPtr phSimConnect, string szName, IntPtr hWnd, uint userEventWin32, IntPtr hEventHandle, uint configIndex);

    [DllImport(Dll, ExactSpelling = true)]
    public static extern int SimConnect_Close(IntPtr hSimConnect);

    [DllImport(Dll, CharSet = CharSet.Ansi, ExactSpelling = true)]
    public static extern int SimConnect_AddToDataDefinition(IntPtr hSimConnect, uint defineId, string datumName, string? unitsName, DataType datumType, float epsilon, uint datumId);

    [DllImport(Dll, ExactSpelling = true)]
    public static extern int SimConnect_RequestDataOnSimObject(IntPtr hSimConnect, uint requestId, uint defineId, uint objectId, Period period, RequestFlags flags, uint origin, uint interval, uint limit);

    [DllImport(Dll, CharSet = CharSet.Ansi, ExactSpelling = true)]
    public static extern int SimConnect_SubscribeToSystemEvent(IntPtr hSimConnect, uint eventId, string systemEventName);

    [DllImport(Dll, CharSet = CharSet.Ansi, ExactSpelling = true)]
    public static extern int SimConnect_RequestSystemState(IntPtr hSimConnect, uint requestId, string state);

    [DllImport(Dll, ExactSpelling = true)]
    public static extern int SimConnect_GetNextDispatch(IntPtr hSimConnect, out IntPtr ppData, out uint pcbData);

    [DllImport(Dll, ExactSpelling = true)]
    public static extern int SimConnect_GetLastSentPacketID(IntPtr hSimConnect, out uint pdwSendId);
}
