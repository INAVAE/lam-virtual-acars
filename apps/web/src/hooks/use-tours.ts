import type { Json } from '@lam/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';
import type { PilotBadge, TourDetail, TourStatus, TourSummary } from '@/lib/tours';

export function useTours() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['tours', user?.id],
    enabled: Boolean(user),
    queryFn: async (): Promise<TourSummary[]> => {
      const { data, error } = await getSupabase().rpc('get_tours');
      if (error) throw error;
      return (data ?? []) as unknown as TourSummary[];
    },
  });
}

export function useTour(id: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['tour', id, user?.id],
    enabled: Boolean(id && user),
    queryFn: async (): Promise<TourDetail> => {
      const { data, error } = await getSupabase().rpc('get_tour', { p_tour_id: id! });
      if (error) throw error;
      return data as unknown as TourDetail;
    },
  });
}

export function usePilotBadges(userId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['pilot-badges', userId ?? user?.id],
    enabled: Boolean(user),
    queryFn: async (): Promise<PilotBadge[]> => {
      const { data, error } = await getSupabase().rpc('get_pilot_badges', userId ? { p_user_id: userId } : {});
      if (error) throw error;
      return (data ?? []) as unknown as PilotBadge[];
    },
  });
}

function refreshTours(queryClient: ReturnType<typeof useQueryClient>, extra: string[] = []) {
  for (const key of ['tours', 'tour', 'pilot-badges', ...extra]) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export interface TourInput {
  airline_id?: string;
  code: string;
  name: string;
  description: string | null;
  color: string;
  badge_path: string | null;
  aircraft_type_ids: number[];
  starts_on: string | null;
  ends_on: string | null;
  ordered_legs: boolean;
  allow_unreviewed_progress: boolean;
  max_unreviewed_legs: number;
  auto_approve_same_airline: boolean;
}

export interface LegInput {
  origin_airport_id: number;
  destination_airport_id: number;
  notes: string | null;
}

/** Crea o edita un tour. Los legs solo se mandan mientras el tour no está publicado. */
export function useSaveTour() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, tour, legs }: { id: string | null; tour: TourInput; legs: LegInput[] | null }) => {
      const { data, error } = await getSupabase().rpc('save_tour', {
        p_tour_id: id,
        p_tour: tour as unknown as Json,
        ...(legs ? { p_legs: legs as unknown as Json } : {}),
      });
      if (error) throw error;
      return data as string;
    },
    onSettled: () => refreshTours(queryClient),
  });
}

const BADGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
export const MAX_BADGE_BYTES = 512 * 1024;

/** Sube la insignia a la carpeta del tour y devuelve su URL pública. */
export async function uploadTourBadge(tourId: string, file: File): Promise<string> {
  const extension = BADGE_TYPES[file.type];
  if (!extension) throw new Error('Usa una imagen PNG, JPG o WebP.');
  if (file.size > MAX_BADGE_BYTES) throw new Error('La insignia debe pesar menos de 512 KB.');
  const supabase = getSupabase();
  const path = `${tourId}/badge-${Date.now()}.${extension}`;
  const { error } = await supabase.storage.from('tour-badges').upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
  if (error) throw error;
  return supabase.storage.from('tour-badges').getPublicUrl(path).data.publicUrl;
}

export function useSubmitTour() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tourId: string): Promise<TourStatus> => {
      const { data, error } = await getSupabase().rpc('submit_tour', { p_tour_id: tourId });
      if (error) throw error;
      return data as TourStatus;
    },
    onSettled: () => refreshTours(queryClient),
  });
}

export function useReviewTour() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tourId, approve, comment }: { tourId: string; approve: boolean; comment?: string }) => {
      const { error } = await getSupabase().rpc('review_tour', { p_tour_id: tourId, p_approve: approve, ...(comment ? { p_comment: comment } : {}) });
      if (error) throw error;
    },
    onSettled: () => refreshTours(queryClient),
  });
}

export function useCloseTour() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tourId: string) => {
      const { error } = await getSupabase().rpc('close_tour', { p_tour_id: tourId });
      if (error) throw error;
    },
    onSettled: () => refreshTours(queryClient),
  });
}

export function useEnrollTour() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tourId, airlineId }: { tourId: string; airlineId: string }) => {
      const { data, error } = await getSupabase().rpc('enroll_tour', { p_tour_id: tourId, p_airline_id: airlineId });
      if (error) throw error;
      return data as unknown as { enrollment_id: string; status: 'pending' | 'approved' };
    },
    onSettled: () => refreshTours(queryClient),
  });
}

export function useReviewEnrollment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ enrollmentId, approve, comment }: { enrollmentId: string; approve: boolean; comment?: string }) => {
      const { error } = await getSupabase().rpc('review_tour_enrollment', {
        p_enrollment_id: enrollmentId,
        p_approve: approve,
        ...(comment ? { p_comment: comment } : {}),
      });
      if (error) throw error;
    },
    onSettled: () => refreshTours(queryClient),
  });
}

export function useWithdrawEnrollment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (enrollmentId: string) => {
      const { error } = await getSupabase().rpc('withdraw_tour_enrollment', { p_enrollment_id: enrollmentId });
      if (error) throw error;
    },
    onSettled: () => refreshTours(queryClient),
  });
}

export function useBookTourLeg() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (v: { enrollmentId: string; legId: string; aircraftId: string; callsign: string; flightNumber: string }) => {
      const { data, error } = await getSupabase().rpc('book_tour_leg', {
        p_enrollment_id: v.enrollmentId,
        p_leg_id: v.legId,
        p_aircraft_id: v.aircraftId,
        p_callsign: v.callsign,
        p_flight_number: v.flightNumber,
      });
      if (error) throw error;
      return data as unknown as { booking_id: string; flight_id: string; expires_at: string };
    },
    onSettled: () => refreshTours(queryClient, ['my-flights', 'fleet', 'dashboard-summary', 'airline-bookings']),
  });
}

export interface TourLegTag {
  id: string;
  leg_number: number;
  tour: { id: string; code: string; name: string; color: string } | null;
}

/** Tour y número de leg de los vuelos que son de un tour (para etiquetarlos). */
export function useTourLegTags(legIds: readonly string[]) {
  const ids = [...new Set(legIds)].sort();
  return useQuery({
    queryKey: ['tour-leg-tags', ids.join(',')],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<Record<string, TourLegTag>> => {
      const { data, error } = await getSupabase().from('tour_legs').select('id, leg_number, tour:tours!tour_legs_tour_id_fkey(id, code, name, color)').in('id', ids);
      if (error) throw error;
      return Object.fromEntries((data as unknown as TourLegTag[]).map((l) => [l.id, l]));
    },
  });
}
