import type { LiveFlight, LiveTrackPoint } from '@lam/shared-types';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';

/** El conector manda la posición cada 10 s: la web consulta con la misma frecuencia (ADR 0008). */
export const LIVE_REFRESH_MS = 10_000;

/**
 * Vuelos en curso de las aerolíneas de quien consulta (o de una). La consulta se
 * repite cada 10 s mientras la pestaña está visible.
 */
export function useLiveFlights(airlineId: string | null, refreshMs = LIVE_REFRESH_MS) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['live-flights', user?.id, airlineId],
    enabled: Boolean(user),
    refetchInterval: refreshMs,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<LiveFlight[]> => {
      const { data, error } = await getSupabase().rpc('get_live_flights', airlineId ? { p_airline_id: airlineId } : {});
      if (error) throw error;
      return Array.isArray(data) ? (data as unknown as LiveFlight[]) : [];
    },
  });
}

/** Traza del vuelo seleccionado; llega por lotes del conector, así que basta cada 30 s. */
export function useLiveTrack(flightId: string | null) {
  return useQuery({
    queryKey: ['live-track', flightId],
    enabled: Boolean(flightId),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<LiveTrackPoint[]> => {
      const { data, error } = await getSupabase().rpc('get_live_flight_track', { p_flight_id: flightId! });
      if (error) throw error;
      return Array.isArray(data) ? (data as unknown as LiveTrackPoint[]) : [];
    },
  });
}
