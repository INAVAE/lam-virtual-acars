namespace LamAcars.Core.Engine;

/// <summary>Componentes del viento respecto al rumbo verdadero de la aeronave.</summary>
public static class WindMath
{
    /// <summary>
    /// Viento de cabeza (+) o de cola (−) y cruzado desde la derecha (+) o la
    /// izquierda (−), en nudos. Null si falta algún dato.
    /// </summary>
    public static (double Headwind, double Crosswind)? Components(double? windDirDeg, double? windKt, double? headingDeg)
    {
        if (windDirDeg is not { } dir || windKt is not { } kt || headingDeg is not { } hdg) return null;
        var angle = (dir - hdg) * Math.PI / 180;
        return (Math.Round(kt * Math.Cos(angle), 1), Math.Round(kt * Math.Sin(angle), 1));
    }

    /// <summary>Datos del viento para un evento (despegue o contacto): dirección, velocidad y componentes.</summary>
    public static void AddTo(IDictionary<string, object?> data, Models.SimSample s)
    {
        if (s.WindDirDeg is not { } dir || s.WindKt is not { } kt) return;
        data["wind_dir_deg"] = Math.Round(dir);
        data["wind_kt"] = Math.Round(kt);
        if (Components(dir, kt, s.HeadingDeg) is { } c)
        {
            data["headwind_kt"] = c.Headwind;
            data["crosswind_kt"] = c.Crosswind;
        }
    }
}
