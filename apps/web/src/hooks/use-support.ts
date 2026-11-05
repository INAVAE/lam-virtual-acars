import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TicketKind, TicketStatus } from '@/content/help-content';
import { useMyMemberships } from '@/hooks/use-lam-data';
import { useAirlineScope } from '@/lib/airline-scope';
import { useAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';

export interface SupportTicket {
  id: string;
  folio: string;
  user_id: string;
  author_name: string;
  author_pilot_number: number | null;
  airline_id: string | null;
  kind: TicketKind;
  module: string | null;
  reference: string | null;
  title: string;
  details: string;
  context: Record<string, unknown>;
  status: TicketStatus;
  response: string | null;
  handler_name: string | null;
  handled_at: string | null;
  created_at: string;
  airline: { name: string; icao_code: string | null } | null;
}

const SELECT =
  'id, folio, user_id, author_name, author_pilot_number, airline_id, kind, module, reference, title, details, context, status, response, handler_name, handled_at, created_at, airline:airlines(name, icao_code)';

/**
 * Quien atiende reportes: el superadministrador y el administrador o jefe de
 * operaciones de alguna aerolínea. Solo decide qué se muestra; la base aplica
 * las reglas con RLS.
 */
export function useCanHandleTickets(): boolean {
  const { isOrgAdmin } = useAirlineScope();
  const memberships = useMyMemberships();
  return (
    isOrgAdmin ||
    (memberships.data ?? []).some((m) => m.status === 'active' && (m.roles.includes('airline_admin') || m.roles.includes('ops_chief')))
  );
}

export function useMyTickets() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['support-tickets', 'mine', user?.id ?? ''],
    enabled: Boolean(user),
    queryFn: async (): Promise<SupportTicket[]> => {
      const { data, error } = await getSupabase()
        .from('support_tickets')
        .select(SELECT)
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as unknown as SupportTicket[];
    },
  });
}

/** Reportes que atiende quien mira (de sus aerolíneas, o todos si es superadministrador). */
export function useTicketInbox(enabled: boolean) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['support-tickets', 'inbox', user?.id ?? ''],
    enabled: enabled && Boolean(user),
    refetchInterval: 2 * 60_000,
    queryFn: async (): Promise<SupportTicket[]> => {
      const { data, error } = await getSupabase()
        .from('support_tickets')
        .select(SELECT)
        .neq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(300);
      if (error) throw error;
      return data as unknown as SupportTicket[];
    },
  });
}

/** Reportes sin revisar que le tocan a quien mira: el contador del botón de ayuda. */
export function useTicketInboxCount(enabled: boolean) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['support-tickets', 'inbox-count', user?.id ?? ''],
    enabled: enabled && Boolean(user),
    refetchInterval: 2 * 60_000,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<number> => {
      const { count, error } = await getSupabase()
        .from('support_tickets')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'new')
        .neq('user_id', user!.id);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export interface NewTicket {
  kind: TicketKind;
  airline_id: string | null;
  module: string | null;
  reference: string | null;
  title: string;
  details: string;
  context: Record<string, string | number | null>;
}

export function useCreateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ticket: NewTicket): Promise<{ folio: string }> => {
      const { data, error } = await getSupabase().from('support_tickets').insert(ticket).select('folio').single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['support-tickets'] }),
  });
}

export function useUpdateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, response }: { id: string; status?: TicketStatus; response?: string | null }) => {
      const patch: { status?: TicketStatus; response?: string | null } = {};
      if (status) patch.status = status;
      if (response !== undefined) patch.response = response;
      const { data, error } = await getSupabase().from('support_tickets').update(patch).eq('id', id).select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('No tienes permiso para atender este reporte');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['support-tickets'] }),
  });
}
