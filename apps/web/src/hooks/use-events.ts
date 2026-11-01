import type { Json } from '@lam/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import type { EventDetail, EventScenario, EventStatus, EventSummary, PrizeCriterion } from '@/lib/events';
import { getSupabase } from '@/lib/supabase';

export function useEvents() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['events', user?.id],
    enabled: Boolean(user),
    refetchInterval: 60_000,
    queryFn: async (): Promise<EventSummary[]> => {
      const { data, error } = await getSupabase().rpc('get_events');
      if (error) throw error;
      return (data ?? []) as unknown as EventSummary[];
    },
  });
}

export function useEvent(id: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['event', id, user?.id],
    enabled: Boolean(id && user),
    refetchInterval: 60_000,
    queryFn: async (): Promise<EventDetail> => {
      const { data, error } = await getSupabase().rpc('get_event', { p_event_id: id! });
      if (error) throw error;
      return data as unknown as EventDetail;
    },
  });
}

function refreshEvents(queryClient: ReturnType<typeof useQueryClient>, extra: string[] = []) {
  for (const key of ['events', 'event', 'tours', 'tour', ...extra]) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export interface EventInput {
  airline_id?: string;
  name: string;
  description: string | null;
  scenario: EventScenario;
  origin_airport_id: number | null;
  destination_airport_id: number | null;
  starts_at: string;
  ends_at: string;
  aircraft_type_ids: number[];
  airline_ids: string[];
  color: string;
  prize_criterion: PrizeCriterion;
  prize_description: string | null;
  prize_places: number;
}

export function useSaveEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, event }: { id: string | null; event: EventInput }) => {
      const { data, error } = await getSupabase().rpc('save_event', { p_event_id: id, p_event: event as unknown as Json });
      if (error) throw error;
      return data as string;
    },
    onSettled: () => refreshEvents(queryClient),
  });
}

export function useSubmitEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (eventId: string): Promise<EventStatus> => {
      const { data, error } = await getSupabase().rpc('submit_event', { p_event_id: eventId });
      if (error) throw error;
      return data as EventStatus;
    },
    onSettled: () => refreshEvents(queryClient),
  });
}

export function useReviewEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ eventId, approve, comment }: { eventId: string; approve: boolean; comment?: string }) => {
      const { error } = await getSupabase().rpc('review_event', { p_event_id: eventId, p_approve: approve, ...(comment ? { p_comment: comment } : {}) });
      if (error) throw error;
    },
    onSettled: () => refreshEvents(queryClient),
  });
}

export function useCancelEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ eventId, reason }: { eventId: string; reason?: string }) => {
      const { error } = await getSupabase().rpc('cancel_event', { p_event_id: eventId, ...(reason ? { p_reason: reason } : {}) });
      if (error) throw error;
    },
    onSettled: () => refreshEvents(queryClient),
  });
}

export function useRegisterEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: { eventId: string; airlineId: string; proposedAirportId: number | null; notes: string }) => {
      const { data, error } = await getSupabase().rpc('register_event', {
        p_event_id: v.eventId,
        p_airline_id: v.airlineId,
        ...(v.proposedAirportId ? { p_proposed_airport_id: v.proposedAirportId } : {}),
        ...(v.notes.trim() ? { p_notes: v.notes.trim() } : {}),
      });
      if (error) throw error;
      return data as unknown as { registration_id: string; status: 'pending' | 'approved' };
    },
    onSettled: () => refreshEvents(queryClient),
  });
}

export function useReviewRegistration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ registrationId, approve, comment }: { registrationId: string; approve: boolean; comment?: string }) => {
      const { error } = await getSupabase().rpc('review_event_registration', {
        p_registration_id: registrationId,
        p_approve: approve,
        ...(comment ? { p_comment: comment } : {}),
      });
      if (error) throw error;
    },
    onSettled: () => refreshEvents(queryClient),
  });
}

export function useWithdrawRegistration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (registrationId: string) => {
      const { error } = await getSupabase().rpc('withdraw_event_registration', { p_registration_id: registrationId });
      if (error) throw error;
    },
    onSettled: () => refreshEvents(queryClient),
  });
}

export function useBookEventFlight() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: { registrationId: string; aircraftId: string; callsign: string; flightNumber: string; originId: number | null; destinationId: number | null }) => {
      const { data, error } = await getSupabase().rpc('book_event_flight', {
        p_registration_id: v.registrationId,
        p_aircraft_id: v.aircraftId,
        p_callsign: v.callsign,
        p_flight_number: v.flightNumber,
        ...(v.originId ? { p_origin_airport_id: v.originId } : {}),
        ...(v.destinationId ? { p_destination_airport_id: v.destinationId } : {}),
      });
      if (error) throw error;
      return data as unknown as { booking_id: string; flight_id: string; expires_at: string };
    },
    onSettled: () => refreshEvents(queryClient, ['my-flights', 'fleet', 'dashboard-summary', 'airline-bookings']),
  });
}

export interface EventRegistrationTag {
  id: string;
  event: { id: string; folio: string; name: string; color: string } | null;
}

/** Evento de los vuelos que son de un evento (para etiquetarlos). */
export function useEventTags(registrationIds: readonly string[]) {
  const ids = [...new Set(registrationIds)].sort();
  return useQuery({
    queryKey: ['event-tags', ids.join(',')],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, EventRegistrationTag>> => {
      const { data, error } = await getSupabase()
        .from('event_registrations')
        .select('id, event:events!event_registrations_event_id_fkey(id, folio, name, color)')
        .in('id', ids);
      if (error) throw error;
      return Object.fromEntries((data as unknown as EventRegistrationTag[]).map((r) => [r.id, r]));
    },
  });
}
