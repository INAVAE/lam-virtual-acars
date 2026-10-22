import type { Json, RouteImportResult, RouteImportRow, TablesInsert } from '@lam/shared-types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';

const ROUTE_SELECT = 'id, airline_id, flight_number, origin_airport_id, destination_airport_id, distance_nm, estimated_minutes, departure_time_utc, days_of_week, operation_type, is_active, notes, origin:airports!routes_origin_airport_id_fkey(icao_code, name, city), destination:airports!routes_destination_airport_id_fkey(icao_code, name, city), route_aircraft_types(aircraft_type_id, aircraft_types(icao_code))' as const;

export interface RouteFilters {
  origin: string;
  destination: string;
  aircraftTypeId: number | null;
  status: 'all' | 'active' | 'inactive';
  page: number;
  pageSize: number;
}

async function airportIdsByIcao(prefix: string): Promise<number[]> {
  const { data, error } = await getSupabase()
    .from('airports')
    .select('id')
    .ilike('icao_code', `${prefix.toUpperCase()}%`)
    .limit(200);
  if (error) throw error;
  return data.map((a) => a.id);
}

export function useRoutes(airlineId: string | null, filters: RouteFilters) {
  return useQuery({
    queryKey: ['routes', airlineId, filters],
    enabled: Boolean(airlineId),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const supabase = getSupabase();
      let routeIdsByType: string[] | null = null;
      if (filters.aircraftTypeId) {
        const { data, error } = await supabase
          .from('route_aircraft_types')
          .select('route_id')
          .eq('aircraft_type_id', filters.aircraftTypeId);
        if (error) throw error;
        routeIdsByType = data.map((r) => r.route_id);
        if (routeIdsByType.length === 0) return { rows: [], total: 0 };
      }

      let query = supabase
        .from('routes')
        .select(ROUTE_SELECT, { count: 'exact' })
        .eq('airline_id', airlineId!)
        .order('flight_number')
        .range(filters.page * filters.pageSize, (filters.page + 1) * filters.pageSize - 1);

      const origin = filters.origin.replace(/[^A-Za-z0-9]/g, '');
      if (origin) {
        const ids = await airportIdsByIcao(origin);
        if (ids.length === 0) return { rows: [], total: 0 };
        query = query.in('origin_airport_id', ids);
      }
      const destination = filters.destination.replace(/[^A-Za-z0-9]/g, '');
      if (destination) {
        const ids = await airportIdsByIcao(destination);
        if (ids.length === 0) return { rows: [], total: 0 };
        query = query.in('destination_airport_id', ids);
      }
      if (routeIdsByType) query = query.in('id', routeIdsByType);
      if (filters.status !== 'all') query = query.eq('is_active', filters.status === 'active');

      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data, total: count ?? 0 };
    },
  });
}

export type RouteRow = NonNullable<ReturnType<typeof useRoutes>['data']>['rows'][number];

export type RouteValues = Omit<TablesInsert<'routes'>, 'id' | 'distance_nm' | 'created_at' | 'updated_at' | 'estimated_minutes'> & {
  estimated_minutes: number | null;
};

export function useSaveRoute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      values,
      aircraftTypeIds,
      previousTypeIds = [],
    }: {
      id?: string;
      values: RouteValues;
      aircraftTypeIds: number[];
      previousTypeIds?: number[];
    }) => {
      const supabase = getSupabase();
      // La base de datos calcula la duración si llega vacía.
      const row = { ...values, estimated_minutes: values.estimated_minutes as number };
      let routeId = id;
      if (id) {
        const { airline_id: _airline, ...changes } = row;
        const { error } = await supabase.from('routes').update(changes).eq('id', id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('routes').insert(row).select('id').single();
        if (error) throw error;
        routeId = data.id;
      }

      const toAdd = aircraftTypeIds.filter((t) => !previousTypeIds.includes(t));
      const toRemove = previousTypeIds.filter((t) => !aircraftTypeIds.includes(t));
      if (toAdd.length > 0) {
        const { error } = await supabase
          .from('route_aircraft_types')
          .insert(toAdd.map((aircraft_type_id) => ({ route_id: routeId!, aircraft_type_id })));
        if (error) throw error;
      }
      if (toRemove.length > 0) {
        const { error } = await supabase
          .from('route_aircraft_types')
          .delete()
          .eq('route_id', routeId!)
          .in('aircraft_type_id', toRemove);
        if (error) throw error;
      }
    },
    onSuccess: (_data, { values }) => queryClient.invalidateQueries({ queryKey: ['routes', values.airline_id] }),
  });
}

export function useDeleteRoute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; airlineId: string }) => {
      const { error } = await getSupabase().from('routes').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_data, { airlineId }) => queryClient.invalidateQueries({ queryKey: ['routes', airlineId] }),
  });
}

function toResult(value: Json): RouteImportResult {
  const v = (value ?? {}) as Record<string, unknown>;
  const errors = Array.isArray(v.errors) ? (v.errors as RouteImportResult['errors']) : [];
  return {
    total: Number(v.total ?? 0),
    valid: Number(v.valid ?? 0),
    created: Number(v.created ?? 0),
    updated: Number(v.updated ?? 0),
    errors,
  };
}

export function useImportRoutes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ airlineId, rows, dryRun }: { airlineId: string; rows: RouteImportRow[]; dryRun: boolean }) => {
      const { data, error } = await getSupabase().rpc('import_routes', {
        p_airline_id: airlineId,
        p_rows: rows as unknown as Json,
        p_dry_run: dryRun,
      });
      if (error) throw error;
      return toResult(data);
    },
    onSuccess: (_data, { airlineId, dryRun }) => {
      if (!dryRun) void queryClient.invalidateQueries({ queryKey: ['routes', airlineId] });
    },
  });
}
