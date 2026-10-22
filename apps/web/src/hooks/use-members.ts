import type { AirlineRole, MembershipStatus } from '@lam/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';

const MEMBER_SELECT =
  'id, airline_id, user_id, roles, status, requested_at, decided_at, profile:profiles!airline_memberships_user_id_fkey(id, pilot_number, display_name, email, country_code, account_status, simbrief_username)' as const;

export function useAirlineMembers(airlineId: string | null) {
  return useQuery({
    queryKey: ['members', airlineId],
    enabled: Boolean(airlineId),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('airline_memberships')
        .select(MEMBER_SELECT)
        .eq('airline_id', airlineId!)
        .order('requested_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export type AirlineMember = NonNullable<ReturnType<typeof useAirlineMembers>['data']>[number];

function invalidate(queryClient: ReturnType<typeof useQueryClient>, airlineId: string) {
  void queryClient.invalidateQueries({ queryKey: ['members', airlineId] });
  void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
}

export function useUpdateMembership() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      changes,
    }: {
      id: string;
      airlineId: string;
      changes: { status?: MembershipStatus; roles?: AirlineRole[] };
    }) => {
      const { data, error } = await getSupabase().from('airline_memberships').update(changes).eq('id', id).select('id');
      if (error) throw error;
      if (data.length === 0) throw new Error('No tienes permiso para cambiar esta membresía.');
    },
    onSuccess: (_data, { airlineId }) => invalidate(queryClient, airlineId),
  });
}

export function useRemoveMembership() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; airlineId: string }) => {
      const { error } = await getSupabase().from('airline_memberships').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_data, { airlineId }) => invalidate(queryClient, airlineId),
  });
}
