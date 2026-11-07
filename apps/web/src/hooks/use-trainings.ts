import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import type { TrainingCategory, TrainingLevel, TrainingRegistrationStatus, TrainingResult } from '@/lib/training';

export interface TrainingPerson {
  user_id: string | null;
  display_name: string | null;
  pilot_number: number | null;
  avatar_url: string | null;
}

export interface TrainingSummary {
  id: string;
  folio: string;
  title: string;
  category: TrainingCategory;
  level: TrainingLevel;
  description: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  status: 'scheduled' | 'cancelled';
  cancel_reason: string | null;
  discord_url: string | null;
  discord_channel: string | null;
  materials_url: string | null;
  aircraft_type: { id: number; icao_code: string; model: string } | null;
  airline: { id: string; name: string; icao_code: string | null; logo_path: string | null; brand_primary_color: string } | null;
  instructor: TrainingPerson | null;
  created_by: { user_id: string; display_name: string; pilot_number: number } | null;
  approved: number;
  pending: number;
  completed: number;
  my_registration: {
    id: string;
    status: TrainingRegistrationStatus;
    result: TrainingResult | null;
    review_comment: string | null;
    notes: string | null;
    created_at: string;
  } | null;
  can_manage: boolean;
}

export interface TrainingRegistration {
  id: string;
  status: TrainingRegistrationStatus;
  result: TrainingResult | null;
  notes: string | null;
  review_comment: string | null;
  created_at: string;
  reviewed_at: string | null;
  result_at: string | null;
  pilot: {
    user_id: string;
    display_name: string;
    pilot_number: number;
    avatar_url: string | null;
    discord_username: string | null;
    airlines: string | null;
  };
}

export interface TrainingDetail extends TrainingSummary {
  can_join: boolean;
  aircraft_type_id: number | null;
  airline_id: string | null;
  instructor_id: string | null;
  instructor_name: string | null;
  registrations: TrainingRegistration[];
}

export interface TrainingInput {
  title: string;
  category: TrainingCategory;
  level: TrainingLevel;
  description: string | null;
  aircraft_type_id: number | null;
  airline_id: string | null;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  instructor_id: string | null;
  instructor_name: string | null;
  discord_url: string | null;
  discord_channel: string | null;
  materials_url: string | null;
}

export interface PilotTraining {
  training_id: string;
  folio: string;
  title: string;
  category: TrainingCategory;
  level: TrainingLevel;
  starts_at: string;
  completed_at: string;
  instructor: string | null;
}

const KEY = ['trainings'] as const;

export function useTrainings(from: string | null = null, to: string | null = null) {
  return useQuery({
    queryKey: [...KEY, 'list', from, to],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_trainings', { p_from: from ?? undefined, p_to: to ?? undefined });
      if (error) throw error;
      return data as unknown as { can_create: boolean; can_join: boolean; trainings: TrainingSummary[] };
    },
  });
}

export function useTraining(id: string | undefined) {
  return useQuery({
    queryKey: [...KEY, 'detail', id],
    enabled: Boolean(id),
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_training', { p_training_id: id! });
      if (error) throw error;
      return data as unknown as TrainingDetail;
    },
  });
}

export function usePilotTrainings(pilotNumber: number | null) {
  return useQuery({
    queryKey: [...KEY, 'pilot', pilotNumber],
    enabled: pilotNumber !== null,
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_pilot_trainings', { p_pilot_number: pilotNumber! });
      if (error) throw error;
      return (data ?? []) as unknown as PilotTraining[];
    },
  });
}

export function useInstructorSearch(query: string, enabled: boolean) {
  return useQuery({
    queryKey: [...KEY, 'instructors', query],
    enabled: enabled && query.trim().length >= 2,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('search_training_instructors', { p_query: query.trim() });
      if (error) throw error;
      return (data ?? []) as unknown as TrainingPerson[];
    },
  });
}

function useTrainingMutation<T>(fn: (input: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSaveTraining() {
  return useTrainingMutation(async ({ id, input }: { id: string | null; input: TrainingInput }) => {
    const { data, error } = await getSupabase().rpc('save_training', { p_training_id: id, p_training: input as never });
    if (error) throw error;
    return data as unknown as string;
  });
}

export function useCancelTraining() {
  return useTrainingMutation(async ({ id, reason }: { id: string; reason: string | null }) => {
    const { error } = await getSupabase().rpc('cancel_training', { p_training_id: id, p_reason: reason ?? undefined });
    if (error) throw error;
  });
}

export function useRegisterTraining() {
  return useTrainingMutation(async ({ id, notes }: { id: string; notes: string | null }) => {
    const { error } = await getSupabase().rpc('register_training', { p_training_id: id, p_notes: notes ?? undefined });
    if (error) throw error;
  });
}

export function useWithdrawTraining() {
  return useTrainingMutation(async (registrationId: string) => {
    const { error } = await getSupabase().rpc('withdraw_training_registration', { p_registration_id: registrationId });
    if (error) throw error;
  });
}

export function useReviewTrainingRegistration() {
  return useTrainingMutation(async ({ id, approve, comment }: { id: string; approve: boolean; comment: string | null }) => {
    const { error } = await getSupabase().rpc('review_training_registration', {
      p_registration_id: id,
      p_approve: approve,
      p_comment: comment ?? undefined,
    });
    if (error) throw error;
  });
}

export function useSetTrainingResult() {
  return useTrainingMutation(async ({ id, result }: { id: string; result: TrainingResult | null }) => {
    const { error } = await getSupabase().rpc('set_training_result', { p_registration_id: id, p_result: result });
    if (error) throw error;
  });
}
