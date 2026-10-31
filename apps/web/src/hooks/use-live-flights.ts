import type { LiveFlight } from '@lam/shared-types';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { mergeTrace, type LiveTrace, type TraceResponse } from '@/lib/live';
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

/**
 * Trazas de los vuelos elegidos en el mapa. Cada consulta pide solo los puntos y
 * eventos nuevos desde la anterior y los agrega a lo que ya se tiene.
 */
export function useLiveTraces(flightIds: readonly string[]) {
  const queryClient = useQueryClient();
  return useQueries({
    queries: flightIds.map((id) => ({
      queryKey: ['live-trace', id],
      refetchInterval: 15_000,
      refetchIntervalInBackground: false,
      staleTime: 10_000,
      queryFn: async (): Promise<LiveTrace> => {
        const prev = queryClient.getQueryData<LiveTrace>(['live-trace', id]);
        const { data, error } = await getSupabase().rpc('get_live_flight_trace', {
          p_flight_id: id,
          p_after_seq: prev?.lastSeq ?? -1,
          p_after_event_seq: prev?.lastEventSeq ?? -1,
        });
        if (error) throw error;
        return mergeTrace(prev, data as unknown as TraceResponse);
      },
    })),
  });
}
