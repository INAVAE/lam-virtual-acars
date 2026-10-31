import type { DashboardSummary, Tables, TablesUpdate } from '@lam/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';

export type Airline = Pick<
  Tables<'airlines'>,
  | 'id'
  | 'slug'
  | 'name'
  | 'icao_code'
  | 'iata_code'
  | 'flight_plan_remarks'
  | 'operation_type'
  | 'website_url'
  | 'network'
  | 'brand_primary_color'
  | 'brand_secondary_color'
  | 'logo_path'
  | 'is_active'
  | 'is_unofficial_brand'
  | 'description'
>;
export type Membership = Pick<Tables<'airline_memberships'>, 'id' | 'airline_id' | 'roles' | 'status' | 'requested_at'>;
export type Profile = Tables<'profiles'>;

const AIRLINE_COLUMNS =
  'id, slug, name, icao_code, iata_code, flight_plan_remarks, network, operation_type, website_url, brand_primary_color, brand_secondary_color, logo_path, is_active, is_unofficial_brand, description' as const;

/** Aerolínea principal de la organización: aparece primero en listas y selectores. */
export const HOME_AIRLINE_SLUG = 'lineas-aereas-mexicanas';

export function sortAirlines<T extends { slug: string; name: string }>(airlines: T[]): T[] {
  return [...airlines].sort((a, b) => {
    if (a.slug === HOME_AIRLINE_SLUG) return -1;
    if (b.slug === HOME_AIRLINE_SLUG) return 1;
    return a.name.localeCompare(b.name, 'es');
  });
}

export const queryKeys = {
  airlines: (userId: string | null) => ['airlines', userId] as const,
  memberships: (userId: string) => ['memberships', userId] as const,
  profile: (userId: string) => ['profile', userId] as const,
  orgAdmin: (userId: string) => ['org-admin', userId] as const,
  summary: (userId: string, airlineId: string | null) => ['dashboard-summary', userId, airlineId] as const,
};

/** Aerolíneas que la sesión actual puede ver (las activas para visitantes). */
export function useAirlines() {
  const { user, loading } = useAuth();
  const userId = user?.id ?? null;
  return useQuery({
    queryKey: queryKeys.airlines(userId),
    enabled: !loading,
    queryFn: async (): Promise<Airline[]> => {
      const { data, error } = await getSupabase().from('airlines').select(AIRLINE_COLUMNS).order('name');
      if (error) throw error;
      return sortAirlines(data);
    },
  });
}

export function useMyMemberships() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.memberships(user?.id ?? ''),
    enabled: Boolean(user),
    queryFn: async (): Promise<Membership[]> => {
      const { data, error } = await getSupabase()
        .from('airline_memberships')
        .select('id, airline_id, roles, status, requested_at')
        .eq('user_id', user!.id)
        .order('requested_at');
      if (error) throw error;
      return data;
    },
  });
}

export function useProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.profile(user?.id ?? ''),
    enabled: Boolean(user),
    queryFn: async (): Promise<Profile> => {
      const { data, error } = await getSupabase().from('profiles').select('*').eq('id', user!.id).single();
      if (error) throw error;
      return data;
    },
  });
}

export function useIsOrgAdmin() {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.orgAdmin(user?.id ?? ''),
    enabled: Boolean(user),
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await getSupabase()
        .from('organization_members')
        .select('role')
        .eq('user_id', user!.id)
        .eq('role', 'superadmin')
        .limit(1);
      if (error) throw error;
      return data.length > 0;
    },
  });
}

function toSummary(value: unknown): DashboardSummary {
  const v = (value ?? {}) as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === 'number' ? x : Number(x ?? 0));
  const scope = v.scope === 'organization' || v.scope === 'airline' ? v.scope : 'member';
  return {
    scope,
    airlines_total: num(v.airlines_total),
    airlines_active: num(v.airlines_active),
    pilots_active_members: num(v.pilots_active_members),
    pending_requests: num(v.pending_requests),
    profiles_total: v.profiles_total === null || v.profiles_total === undefined ? null : num(v.profiles_total),
    bookings_active: num(v.bookings_active),
    my_bookings_active: num(v.my_bookings_active),
    pireps_pending_review: num(v.pireps_pending_review),
    my_pireps_pending: num(v.my_pireps_pending),
    my_block_minutes: num(v.my_block_minutes),
    my_flights_accepted: num(v.my_flights_accepted),
    live_flights: num(v.live_flights),
    airline_block_minutes_30d: num(v.airline_block_minutes_30d),
    airline_flights_30d: num(v.airline_flights_30d),
  };
}

export function useDashboardSummary(airlineId: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: queryKeys.summary(user?.id ?? '', airlineId),
    enabled: Boolean(user),
    queryFn: async (): Promise<DashboardSummary> => {
      const { data, error } = await getSupabase().rpc('get_dashboard_summary', airlineId ? { p_airline_id: airlineId } : {});
      if (error) throw error;
      return toSummary(data);
    },
  });
}

export function useUpdateProfile() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (changes: TablesUpdate<'profiles'>) => {
      const { data, error } = await getSupabase()
        .from('profiles')
        .update(changes)
        .eq('id', user!.id)
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.profile(data.id), data);
    },
  });
}

export function useRequestMembership() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (airlineId: string) => {
      const { error } = await getSupabase()
        .from('airline_memberships')
        .insert({ airline_id: airlineId, user_id: user!.id, roles: ['pilot'], status: 'pending' });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['memberships'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    },
  });
}

export function useCancelMembershipRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (membershipId: string) => {
      const { error } = await getSupabase().from('airline_memberships').delete().eq('id', membershipId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['memberships'] });
    },
  });
}
