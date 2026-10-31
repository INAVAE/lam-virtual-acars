import type { AirlineStatistics, OperationsOverview, PilotLandingStats, PilotPerformance } from '@lam/shared-types';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';

/** Estadísticas de la aerolínea elegida (o de todas las del piloto) a partir de los PIREP aceptados. */
export function useAirlineStatistics(airlineId: string | null, months = 12) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['airline-statistics', user?.id, airlineId, months],
    enabled: Boolean(user),
    staleTime: 60_000,
    queryFn: async (): Promise<AirlineStatistics> => {
      const { data, error } = await getSupabase().rpc('get_airline_statistics', {
        ...(airlineId ? { p_airline_id: airlineId } : {}),
        p_months: months,
      });
      if (error) throw error;
      return data as unknown as AirlineStatistics;
    },
  });
}

/** Operations Center: salidas y reservas, cola de PIREP, flota. Se refresca cada minuto. */
export function useOperationsOverview(airlineId: string | null, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['operations-overview', user?.id, airlineId],
    enabled: Boolean(user) && enabled,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<OperationsOverview> => {
      const { data, error } = await getSupabase().rpc('get_operations_overview', airlineId ? { p_airline_id: airlineId } : {});
      if (error) throw error;
      return data as unknown as OperationsOverview;
    },
  });
}

/** Rendimiento de cada piloto en los últimos `days` días (staff). */
export function usePilotPerformance(airlineId: string | null, days: number, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['pilot-performance', user?.id, airlineId, days],
    enabled: Boolean(user) && enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<{ days: number; pilots: PilotPerformance[] }> => {
      const { data, error } = await getSupabase().rpc('get_pilot_performance', {
        ...(airlineId ? { p_airline_id: airlineId } : {}),
        p_days: days,
      });
      if (error) throw error;
      const v = (data ?? {}) as { days?: number; pilots?: PilotPerformance[] };
      return { days: v.days ?? days, pilots: v.pilots ?? [] };
    },
  });
}

/** Promedios y proporciones de los parámetros del aterrizaje de un piloto (por omisión, el propio). */
export function usePilotLandingStats(userId: string | null, airlineId: string | null, limit = 30) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['pilot-landing-stats', user?.id, userId, airlineId, limit],
    enabled: Boolean(user),
    staleTime: 60_000,
    queryFn: async (): Promise<PilotLandingStats> => {
      const { data, error } = await getSupabase().rpc('get_pilot_landing_stats', {
        ...(userId ? { p_user_id: userId } : {}),
        ...(airlineId ? { p_airline_id: airlineId } : {}),
        p_limit: limit,
      });
      if (error) throw error;
      return data as unknown as PilotLandingStats;
    },
  });
}
