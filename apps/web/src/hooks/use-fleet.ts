import type { Tables, TablesInsert, TablesUpdate } from '@lam/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';

export type AircraftType = Tables<'aircraft_types'>;

export function useAircraftTypes() {
  return useQuery({
    queryKey: ['aircraft-types'],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<AircraftType[]> => {
      const { data, error } = await getSupabase().from('aircraft_types').select('*').order('icao_code');
      if (error) throw error;
      return data;
    },
  });
}

export function useSaveAircraftType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: number; values: TablesInsert<'aircraft_types'> }) => {
      const supabase = getSupabase();
      if (id) {
        const { icao_code: _code, ...changes } = values;
        const { error } = await supabase.from('aircraft_types').update(changes satisfies TablesUpdate<'aircraft_types'>).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('aircraft_types').insert(values);
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['aircraft-types'] }),
  });
}

const AIRCRAFT_SELECT = 'id, airline_id, aircraft_type_id, registration, fleet_number, configuration, operation_type, status, base_airport_id, current_airport_id, total_minutes, cycles, last_flight_at, notes, type:aircraft_types!aircraft_aircraft_type_id_fkey(icao_code, manufacturer, model), base:airports!aircraft_base_airport_id_fkey(icao_code, name), current:airports!aircraft_current_airport_id_fkey(icao_code, name)' as const;

export function useFleet(airlineId: string | null) {
  return useQuery({
    queryKey: ['fleet', airlineId],
    enabled: Boolean(airlineId),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('aircraft')
        .select(AIRCRAFT_SELECT)
        .eq('airline_id', airlineId!)
        .order('registration');
      if (error) throw error;
      return data;
    },
  });
}

export type FleetAircraft = NonNullable<ReturnType<typeof useFleet>['data']>[number];

export type AircraftValues = Omit<TablesInsert<'aircraft'>, 'id' | 'total_minutes' | 'cycles' | 'last_flight_at' | 'created_at' | 'updated_at'>;

export function useSaveAircraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: AircraftValues }) => {
      const supabase = getSupabase();
      if (id) {
        const { airline_id: _airline, ...changes } = values;
        const { error } = await supabase.from('aircraft').update(changes).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('aircraft').insert(values);
        if (error) throw error;
      }
    },
    onSuccess: (_data, { values }) => queryClient.invalidateQueries({ queryKey: ['fleet', values.airline_id] }),
  });
}

export function useDeleteAircraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; airlineId: string }) => {
      const { error } = await getSupabase().from('aircraft').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_data, { airlineId }) => queryClient.invalidateQueries({ queryKey: ['fleet', airlineId] }),
  });
}
