import type { Tables, TablesInsert, TablesUpdate } from '@lam/shared-types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';

export type Airport = Tables<'airports'>;
export type AirportSummary = Pick<Airport, 'id' | 'icao_code' | 'iata_code' | 'name' | 'city' | 'country_code'>;

const SUMMARY = 'id, icao_code, iata_code, name, city, country_code' as const;

/** Limpia el texto de búsqueda para el filtro or() de PostgREST. */
export function searchTerm(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[^\p{L}\p{N} -]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function searchFilter(term: string): string {
  const upper = term.toUpperCase();
  return `icao_code.ilike.${upper}%,iata_code.ilike.${upper}%,name.ilike.%${term}%,city.ilike.%${term}%`;
}

export interface AirportFilters {
  search: string;
  country: string;
  type: string;
  page: number;
  pageSize: number;
}

export function useAirportList(filters: AirportFilters) {
  return useQuery({
    queryKey: ['airports', 'list', filters],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let query = getSupabase()
        .from('airports')
        .select('*', { count: 'exact' })
        .order('icao_code')
        .range(filters.page * filters.pageSize, (filters.page + 1) * filters.pageSize - 1);
      const term = searchTerm(filters.search);
      if (term) query = query.or(searchFilter(term));
      if (filters.country) query = query.eq('country_code', filters.country);
      if (filters.type) query = query.eq('airport_type', filters.type);
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: data, total: count ?? 0 };
    },
  });
}

/** Búsqueda rápida para el selector de aeropuertos. */
export function useAirportSearch(raw: string) {
  const term = searchTerm(raw);
  return useQuery({
    queryKey: ['airports', 'search', term],
    enabled: term.length >= 2,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AirportSummary[]> => {
      const { data, error } = await getSupabase()
        .from('airports')
        .select(SUMMARY)
        .or(searchFilter(term))
        .order('icao_code')
        .limit(12);
      if (error) throw error;
      return data;
    },
  });
}

export function useAirportById(id: number | null | undefined) {
  return useQuery({
    queryKey: ['airports', 'one', id],
    enabled: typeof id === 'number',
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<AirportSummary> => {
      const { data, error } = await getSupabase().from('airports').select(SUMMARY).eq('id', id!).single();
      if (error) throw error;
      return data;
    },
  });
}

export function useAirportCount() {
  return useQuery({
    queryKey: ['airports', 'count'],
    queryFn: async () => {
      const { count, error } = await getSupabase().from('airports').select('id', { count: 'exact', head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useSaveAirport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: number; values: TablesInsert<'airports'> & TablesUpdate<'airports'> }) => {
      const supabase = getSupabase();
      const { error } = id
        ? await supabase.from('airports').update(values).eq('id', id)
        : await supabase.from('airports').insert({ ...values, source: 'manual' });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['airports'] }),
  });
}

export function useDeleteAirport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await getSupabase().from('airports').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['airports'] }),
  });
}

export interface AirportImportResult {
  mode: 'insert' | 'refresh';
  sourceRows: number;
  eligible: number;
  written: number;
}

export function useImportAirports() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (mode: 'insert' | 'refresh'): Promise<AirportImportResult> => {
      const { data, error } = await getSupabase().functions.invoke<AirportImportResult>('import-airports', {
        body: { mode },
      });
      if (error) {
        // El cuerpo de la respuesta trae el motivo en español.
        const context = (error as { context?: Response }).context;
        if (context && typeof context.json === 'function') {
          const body = (await context.json().catch(() => null)) as { error?: string } | null;
          if (body?.error) throw new Error(body.error);
        }
        throw error;
      }
      if (!data) throw new Error('La importación no devolvió resultados');
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['airports'] }),
  });
}
