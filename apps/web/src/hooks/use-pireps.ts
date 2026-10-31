import type { Database, PirepStatus, Tables } from '@lam/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';

const PIREP_LIST_SELECT =
  'id, airline_id, user_id, callsign, flight_number, aircraft_registration, status, score, has_critical, diverted, block_minutes, flight_minutes, distance_nm, landing_vs_fpm, block_on_at, created_at, auto_approved, airline:airlines!pireps_airline_id_fkey(name, icao_code, slug, logo_path, brand_primary_color), pilot:profiles!pireps_user_id_fkey(display_name, pilot_number), type:aircraft_types!pireps_aircraft_type_id_fkey(icao_code), origin:airports!pireps_origin_airport_id_fkey(icao_code), destination:airports!pireps_destination_airport_id_fkey(icao_code), arrival:airports!pireps_arrival_airport_id_fkey(icao_code)' as const;

export type PirepListView = 'mine' | 'review' | 'airline';

/**
 * PIREPs: los propios ("mine"), los pendientes de revisión de la aerolínea
 * ("review") o todos los de la aerolínea ("airline"). La RLS decide qué se ve.
 */
export function usePireps(view: PirepListView, airlineId: string | null, status: PirepStatus | 'all' = 'all', includeOwnInReview = false) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['pireps', view, airlineId, status, user?.id, includeOwnInReview],
    enabled: Boolean(user),
    queryFn: async () => {
      let query = getSupabase().from('pireps').select(PIREP_LIST_SELECT).order('created_at', { ascending: view === 'review' }).limit(200);
      if (view === 'mine') query = query.eq('user_id', user!.id);
      if (view === 'review') {
        query = query.eq('status', 'pending');
        // Solo el superadministrador revisa sus propios PIREP.
        if (!includeOwnInReview) query = query.neq('user_id', user!.id);
      }
      if (airlineId) query = query.eq('airline_id', airlineId);
      if (status !== 'all' && view !== 'review') query = query.eq('status', status);
      // Los archivados solo aparecen si se piden (y solo los ve el superadministrador).
      if (status === 'all') query = query.neq('status', 'archived');
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

export type PirepListItem = NonNullable<ReturnType<typeof usePireps>['data']>[number];

const PIREP_DETAIL_SELECT =
  '*, airline:airlines!pireps_airline_id_fkey(name, icao_code, slug, logo_path, brand_primary_color), pilot:profiles!pireps_user_id_fkey(display_name, pilot_number), reviewer:profiles!pireps_reviewed_by_fkey(display_name), type:aircraft_types!pireps_aircraft_type_id_fkey(icao_code, manufacturer, model), origin:airports!pireps_origin_airport_id_fkey(icao_code, name, city, latitude, longitude), destination:airports!pireps_destination_airport_id_fkey(icao_code, name, city, latitude, longitude), arrival:airports!pireps_arrival_airport_id_fkey(icao_code, name, city, latitude, longitude)' as const;

export function usePirep(id: string | undefined) {
  return useQuery({
    queryKey: ['pirep', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await getSupabase().from('pireps').select(PIREP_DETAIL_SELECT).eq('id', id!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export type PirepDetail = NonNullable<NonNullable<ReturnType<typeof usePirep>['data']>>;

export type TrackPoint = Pick<
  Tables<'flight_track_points'>,
  | 'seq'
  | 'sampled_at'
  | 'latitude'
  | 'longitude'
  | 'altitude_ft'
  | 'gs_kt'
  | 'ias_kt'
  | 'vs_fpm'
  | 'heading_deg'
  | 'on_ground'
  | 'phase'
  | 'fuel_kg'
  | 'wind_dir_deg'
  | 'wind_kt'
>;
export type FlightEvent = Pick<
  Tables<'flight_events'>,
  'id' | 'seq' | 'type' | 'phase' | 'occurred_at' | 'latitude' | 'longitude' | 'altitude_ft' | 'data'
>;

/** Traza completa del vuelo (en páginas de 1,000 puntos) y sus eventos. */
export function usePirepTrack(flightId: string | undefined, sessionId: string | undefined) {
  return useQuery({
    queryKey: ['pirep-track', flightId, sessionId],
    enabled: Boolean(flightId && sessionId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const supabase = getSupabase();
      const points: TrackPoint[] = [];
      for (let from = 0; from < 20_000; from += 1000) {
        const { data, error } = await supabase
          .from('flight_track_points')
          .select('seq, sampled_at, latitude, longitude, altitude_ft, gs_kt, ias_kt, vs_fpm, heading_deg, on_ground, phase, fuel_kg, wind_dir_deg, wind_kt')
          .eq('flight_id', flightId!)
          .eq('session_id', sessionId!)
          .order('seq')
          .range(from, from + 999);
        if (error) throw error;
        points.push(...data);
        if (data.length < 1000) break;
      }
      const { data: events, error } = await supabase
        .from('flight_events')
        .select('id, seq, type, phase, occurred_at, latitude, longitude, altitude_ft, data')
        .eq('session_id', sessionId!)
        .order('seq')
        .limit(1000);
      if (error) throw error;
      return { points, events: events as FlightEvent[] };
    },
  });
}

function refreshPireps(queryClient: ReturnType<typeof useQueryClient>) {
  for (const key of ['pireps', 'pirep', 'pilot-statistics', 'dashboard-summary', 'fleet']) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export function useReviewPirep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, decision, comment }: { id: string; decision: 'accepted' | 'rejected'; comment: string }) => {
      const { data, error } = await getSupabase().rpc('review_pirep', {
        p_pirep_id: id,
        p_decision: decision,
        p_comment: comment.trim() || undefined,
      });
      if (error) throw error;
      return data;
    },
    onSettled: () => refreshPireps(queryClient),
  });
}

/** Anula (o restaura, con waive=false) una falta del PIREP en revisión. */
export function useWaiveFinding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, code, reason, waive }: { id: string; code: string; reason?: string; waive: boolean }) => {
      const { data, error } = await getSupabase().rpc('waive_pirep_finding', {
        p_pirep_id: id,
        p_code: code,
        p_reason: reason?.trim() || undefined,
        p_waive: waive,
      });
      if (error) throw error;
      return data;
    },
    onSettled: () => refreshPireps(queryClient),
  });
}

/** Archiva un PIREP (staff de la aerolínea o superadministrador). */
export function useArchivePirep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data, error } = await getSupabase().rpc('archive_pirep', { p_pirep_id: id, p_reason: reason.trim() });
      if (error) throw error;
      return data;
    },
    onSettled: () => refreshPireps(queryClient),
  });
}

/** Restaura un PIREP archivado (superadministrador). */
export function useRestorePirep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { data, error } = await getSupabase().rpc('restore_pirep', { p_pirep_id: id });
      if (error) throw error;
      return data;
    },
    onSettled: () => refreshPireps(queryClient),
  });
}

export function useCommentPirep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment: string }) => {
      const { data, error } = await getSupabase().rpc('comment_pirep', { p_pirep_id: id, p_comment: comment });
      if (error) throw error;
      return data;
    },
    onSettled: () => refreshPireps(queryClient),
  });
}

export type PilotStatistics = Database['public']['Views']['pilot_statistics']['Row'];

/** Estadísticas por piloto y aerolínea (solo filas visibles por la RLS de pireps). */
export function usePilotStatistics(airlineId: string | null, userId?: string) {
  return useQuery({
    queryKey: ['pilot-statistics', airlineId, userId],
    queryFn: async (): Promise<PilotStatistics[]> => {
      let query = getSupabase().from('pilot_statistics').select('*');
      if (airlineId) query = query.eq('airline_id', airlineId);
      if (userId) query = query.eq('user_id', userId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}

/** Suma las filas de varias aerolíneas (vista consolidada). */
export function combineStatistics(rows: readonly PilotStatistics[]) {
  const total = (k: keyof PilotStatistics) => rows.reduce((sum, r) => sum + (Number(r[k]) || 0), 0);
  const accepted = total('pireps_accepted');
  const weighted = (k: 'average_score' | 'average_landing_vs_fpm') =>
    accepted > 0
      ? rows.reduce((sum, r) => sum + (Number(r[k]) || 0) * (r.pireps_accepted ?? 0), 0) / accepted
      : null;
  return {
    pireps_total: total('pireps_total'),
    pireps_accepted: accepted,
    pireps_pending: total('pireps_pending'),
    pireps_rejected: total('pireps_rejected'),
    block_minutes: total('block_minutes'),
    flight_minutes: total('flight_minutes'),
    distance_nm: total('distance_nm'),
    average_score: weighted('average_score'),
    average_landing_vs_fpm: weighted('average_landing_vs_fpm'),
  };
}

// -----------------------------------------------------------------------------
// Reglas de puntuación
// -----------------------------------------------------------------------------
export type ScoringRule = Tables<'pirep_scoring_rules'> & { definition: Tables<'pirep_rule_definitions'> | null };

export function useScoringRules(airlineId: string | undefined) {
  return useQuery({
    queryKey: ['scoring-rules', airlineId],
    enabled: Boolean(airlineId),
    queryFn: async (): Promise<ScoringRule[]> => {
      const { data, error } = await getSupabase()
        .from('pirep_scoring_rules')
        .select('*, definition:pirep_rule_definitions!pirep_scoring_rules_rule_code_fkey(*)')
        .eq('airline_id', airlineId!);
      if (error) throw error;
      return [...data].sort((a, b) => (a.definition?.sort_order ?? 0) - (b.definition?.sort_order ?? 0));
    },
  });
}

export function useUpdateScoringRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      airlineId,
      code,
      changes,
    }: {
      airlineId: string;
      code: string;
      changes: Pick<Tables<'pirep_scoring_rules'>, 'enabled' | 'penalty' | 'threshold' | 'critical'>;
    }) => {
      const { data, error } = await getSupabase()
        .from('pirep_scoring_rules')
        .update(changes)
        .eq('airline_id', airlineId)
        .eq('rule_code', code)
        .select('rule_code');
      if (error) throw error;
      if (data.length === 0) throw new Error('No tienes permiso para cambiar la puntuación de esta aerolínea.');
    },
    onSettled: (_d, _e, vars) => void queryClient.invalidateQueries({ queryKey: ['scoring-rules', vars.airlineId] }),
  });
}
