import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { ICAO_PATTERN, MAX_WEATHER_AIRPORTS, type WeatherReport, type WeatherResponse } from '@/lib/weather';

/**
 * METAR y TAF de hasta 10 aeropuertos (Edge Function `weather`, datos de NOAA).
 * El servidor guarda cada METAR 5 minutos; aquí se vuelve a pedir cada 5 minutos
 * mientras la página está abierta.
 */
export function useWeather(icaos: readonly string[]) {
  const list = [...new Set(icaos.map((i) => i.trim().toUpperCase()).filter((i) => ICAO_PATTERN.test(i)))]
    .slice(0, MAX_WEATHER_AIRPORTS)
    .sort();
  return useQuery({
    queryKey: ['weather', list],
    enabled: list.length > 0,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<{ byIcao: Map<string, WeatherReport>; upstreamError: string | null }> => {
      const { data, error } = await getSupabase().functions.invoke<WeatherResponse>('weather', { body: { icaos: list } });
      if (error) {
        // La función responde { code, error } con el motivo en español.
        const context = (error as { context?: Response }).context;
        if (context && typeof context.json === 'function') {
          const body = (await context.json().catch(() => null)) as { error?: string } | null;
          if (body?.error) throw new Error(body.error);
        }
        throw error;
      }
      const reports = data?.reports ?? [];
      return { byIcao: new Map(reports.map((r) => [r.icao, r])), upstreamError: data?.upstream_error ?? null };
    },
  });
}
