using System.Text.RegularExpressions;

namespace LamAcars.Core.Models;

/// <summary>Deduce el designador ICAO a partir del título de la aeronave en MSFS (aeronaves predeterminadas y de terceros).</summary>
public static class AircraftTypeGuesser
{
    // Títulos de MSFS y de terceros, del más específico al más general.
    private static readonly (string Pattern, string Icao)[] TitlePatterns =
    {
        (@"A?319\s*-?neo|A19N", "A19N"), (@"A?320\s*-?neo|A20N", "A20N"), (@"A?321\s*-?neo|A21N", "A21N"),
        (@"A?318", "A318"), (@"A?319", "A319"), (@"A?320", "A320"), (@"A?321", "A321"),
        (@"A?330\s*-?900|A339", "A339"), (@"A?330\s*-?300|A333", "A333"), (@"A?350\s*-?1000|A35K", "A35K"), (@"A?350", "A359"), (@"A?380", "A388"),
        (@"737\s*MAX\s*8|B38M", "B38M"), (@"737\s*MAX\s*9|B39M", "B39M"), (@"737\s*-?600", "B736"), (@"737\s*-?700", "B737"),
        (@"737\s*-?800", "B738"), (@"737\s*-?900", "B739"), (@"727\s*-?200", "B722"),
        (@"747\s*-?8", "B748"), (@"747\s*-?400", "B744"), (@"777\s*-?300\s*ER|77W", "B77W"), (@"777\s*F|777\s*-?200\s*LR?F", "B77L"),
        (@"777\s*-?200", "B772"), (@"787\s*-?10", "B78X"), (@"787\s*-?9", "B789"), (@"787\s*-?8", "B788"),
        (@"MD\s*-?11", "MD11"), (@"DC\s*-?9", "DC93"), (@"E\s*-?190|ERJ\s*-?190|E190", "E190"), (@"E\s*-?175|E175", "E175"),
        (@"CRJ\s*-?700", "CRJ7"), (@"CRJ\s*-?900", "CRJ9"), (@"ATR\s*72", "AT76"), (@"Q400|DHC\s*-?8", "DH8D"),
        (@"208|Caravan", "C208"), (@"Longitude", "C700"), (@"CJ4", "C25C"), (@"TBM\s*9", "TBM9"),
    };

    public static string? FromTitle(string? title)
    {
        if (string.IsNullOrWhiteSpace(title)) return null;
        foreach (var (pattern, icao) in TitlePatterns)
        {
            if (Regex.IsMatch(title, pattern, RegexOptions.IgnoreCase))
                return icao;
        }
        return null;
    }
}
