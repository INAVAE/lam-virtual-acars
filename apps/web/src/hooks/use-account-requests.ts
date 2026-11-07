import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAirlineScope } from '@/lib/airline-scope';
import { getSupabase } from '@/lib/supabase';

export interface AccountRequest {
  id: string;
  email: string;
  display_name: string;
  airline_id: string | null;
  ivao_vid: string | null;
  message: string | null;
  status: 'pending' | 'approved' | 'rejected';
  review_note: string | null;
  reviewed_at: string | null;
  invited_at: string | null;
  last_error: string | null;
  user_id: string | null;
  created_at: string;
  airline: { name: string; icao_code: string | null } | null;
}

/** Solicitudes de cuenta de piloto (solo el superadministrador las ve). */
export function useAccountRequests() {
  const { isOrgAdmin } = useAirlineScope();
  return useQuery({
    queryKey: ['account-requests'],
    enabled: isOrgAdmin,
    refetchInterval: 2 * 60_000,
    queryFn: async (): Promise<AccountRequest[]> => {
      const { data, error } = await getSupabase()
        .from('account_requests')
        .select(
          'id, email, display_name, airline_id, ivao_vid, message, status, review_note, reviewed_at, invited_at, last_error, user_id, created_at, airline:airlines(name, icao_code)',
        )
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) throw error;
      return data as unknown as AccountRequest[];
    },
  });
}

/** Pendientes por aprobar: el aviso del Dashboard y el contador de la pestaña. */
export function usePendingAccountRequests() {
  const { isOrgAdmin } = useAirlineScope();
  return useQuery({
    queryKey: ['account-requests', 'pending-count'],
    enabled: isOrgAdmin,
    refetchInterval: 2 * 60_000,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<number> => {
      const { count, error } = await getSupabase().from('account_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending');
      if (error) throw error;
      return count ?? 0;
    },
  });
}

type AccountAction =
  | { action: 'approve' | 'resend'; request_id: string }
  | { action: 'revoke'; user_id: string; note: string | null }
  | { action: 'restore'; user_id: string }
  | { action: 'reject'; request_id: string; note: string | null }
  | { action: 'invite'; email: string; display_name: string };

/** Aprobar (manda la invitación), reenviar, rechazar o invitar directamente: Edge Function account-requests. */
export function useAccountRequestAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: AccountAction) => {
      const { error } = await getSupabase().functions.invoke('account-requests', { body });
      if (error) {
        const context = (error as { context?: Response }).context;
        if (context && typeof context.json === 'function') {
          const res = (await context.json().catch(() => null)) as { error?: string } | null;
          if (res?.error) throw new Error(res.error);
        }
        throw error;
      }
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['account-requests'] }),
        queryClient.invalidateQueries({ queryKey: ['platform-accounts'] }),
      ]),
  });
}

export interface PlatformAccountMembership {
  airline_id: string;
  name: string;
  icao_code: string | null;
  status: 'pending' | 'active' | 'suspended' | 'rejected';
  roles: string[];
}

export interface PlatformAccount {
  user_id: string;
  pilot_number: number;
  display_name: string;
  email: string;
  account_status: 'active' | 'suspended';
  created_at: string;
  last_sign_in_at: string | null;
  is_superadmin: boolean;
  suspended_at: string | null;
  suspension_note: string | null;
  suspended_by_name: string | null;
  memberships: PlatformAccountMembership[];
  pirep_count: number;
}

/** Todas las cuentas de la plataforma, con sus aerolíneas (solo superadministrador). */
export function usePlatformAccounts() {
  const { isOrgAdmin } = useAirlineScope();
  return useQuery({
    queryKey: ['platform-accounts'],
    enabled: isOrgAdmin,
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<PlatformAccount[]> => {
      const { data, error } = await getSupabase().rpc('list_platform_accounts');
      if (error) throw error;
      return (data ?? []) as unknown as PlatformAccount[];
    },
  });
}
