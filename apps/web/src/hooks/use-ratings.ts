import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';

export interface Rating {
  airline_id: string;
  user_id: string;
  aircraft_type_id: number;
  granted_at: string;
}

/** Habilitaciones de todos los pilotos de una aerolínea (solo el staff las ve todas). */
export function useAirlineRatings(airlineId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['ratings', airlineId],
    enabled: Boolean(airlineId) && enabled,
    queryFn: async (): Promise<Rating[]> => {
      const { data, error } = await getSupabase()
        .from('pilot_type_ratings')
        .select('airline_id, user_id, aircraft_type_id, granted_at')
        .eq('airline_id', airlineId!);
      if (error) throw error;
      return data;
    },
  });
}

/** Habilitaciones propias en una aerolínea. */
export function useMyRatings(airlineId: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['ratings', airlineId, 'mine', user?.id],
    enabled: Boolean(airlineId && user),
    queryFn: async (): Promise<Rating[]> => {
      const { data, error } = await getSupabase()
        .from('pilot_type_ratings')
        .select('airline_id, user_id, aircraft_type_id, granted_at')
        .eq('airline_id', airlineId!)
        .eq('user_id', user!.id);
      if (error) throw error;
      return data;
    },
  });
}

/** Otorga y retira habilitaciones de un piloto según la diferencia con las actuales. */
export function useSaveRatings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      airlineId,
      userId,
      typeIds,
      previous,
    }: {
      airlineId: string;
      userId: string;
      typeIds: number[];
      previous: number[];
    }) => {
      const supabase = getSupabase();
      const toAdd = typeIds.filter((t) => !previous.includes(t));
      const toRemove = previous.filter((t) => !typeIds.includes(t));
      if (toAdd.length > 0) {
        const { error } = await supabase
          .from('pilot_type_ratings')
          .insert(toAdd.map((aircraft_type_id) => ({ airline_id: airlineId, user_id: userId, aircraft_type_id })));
        if (error) throw error;
      }
      if (toRemove.length > 0) {
        const { error } = await supabase
          .from('pilot_type_ratings')
          .delete()
          .eq('airline_id', airlineId)
          .eq('user_id', userId)
          .in('aircraft_type_id', toRemove);
        if (error) throw error;
      }
    },
    onSettled: (_data, _error, { airlineId }) => {
      void queryClient.invalidateQueries({ queryKey: ['ratings', airlineId] });
      void queryClient.invalidateQueries({ queryKey: ['route-aircraft-options'] });
    },
  });
}
