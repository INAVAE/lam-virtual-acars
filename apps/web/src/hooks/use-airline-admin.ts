import type { Tables, TablesInsert, TablesUpdate } from '@lam/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';

export type AirlineRecord = Tables<'airlines'>;
export type AirlineSettings = Tables<'airline_settings'>;

export function useAirlineBySlug(slug: string | undefined) {
  return useQuery({
    queryKey: ['airline', slug],
    enabled: Boolean(slug),
    queryFn: async (): Promise<AirlineRecord | null> => {
      const { data, error } = await getSupabase().from('airlines').select('*').eq('slug', slug!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useAirlineSettings(airlineId: string | undefined) {
  return useQuery({
    queryKey: ['airline-settings', airlineId],
    enabled: Boolean(airlineId),
    queryFn: async (): Promise<AirlineSettings | null> => {
      const { data, error } = await getSupabase().from('airline_settings').select('*').eq('airline_id', airlineId!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

function refreshAirlines(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['airlines'] });
  void queryClient.invalidateQueries({ queryKey: ['airline'] });
  void queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
}

export function useUpdateAirline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, changes }: { id: string; changes: TablesUpdate<'airlines'> }) => {
      const { data, error } = await getSupabase().from('airlines').update(changes).eq('id', id).select('id');
      if (error) throw error;
      if (data.length === 0) throw new Error('No tienes permiso para editar esta aerolínea.');
    },
    onSuccess: () => refreshAirlines(queryClient),
  });
}

export function useCreateAirline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: Omit<TablesInsert<'airlines'>, 'organization_id'>) => {
      const supabase = getSupabase();
      const { data: org, error: orgError } = await supabase.from('organizations').select('id').eq('slug', 'lam').single();
      if (orgError) throw orgError;
      const { data, error } = await supabase
        .from('airlines')
        .insert({ ...values, organization_id: org.id })
        .select('slug')
        .single();
      if (error) throw error;
      return data.slug;
    },
    onSuccess: () => refreshAirlines(queryClient),
  });
}

export function useUpdateAirlineSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ airlineId, changes }: { airlineId: string; changes: TablesUpdate<'airline_settings'> }) => {
      const { data, error } = await getSupabase()
        .from('airline_settings')
        .update(changes)
        .eq('airline_id', airlineId)
        .select('airline_id');
      if (error) throw error;
      if (data.length === 0) throw new Error('No tienes permiso para cambiar estas políticas.');
    },
    onSuccess: (_data, { airlineId }) => queryClient.invalidateQueries({ queryKey: ['airline-settings', airlineId] }),
  });
}

export const MAX_LOGO_BYTES = 512 * 1024;
const LOGO_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Sube el logotipo a Storage y guarda su URL pública en la aerolínea. */
export function useUploadAirlineLogo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ airlineId, file }: { airlineId: string; file: File }) => {
      const extension = LOGO_TYPES[file.type];
      if (!extension) throw new Error('Usa una imagen PNG, JPG o WebP.');
      if (file.size > MAX_LOGO_BYTES) throw new Error('El logotipo debe pesar menos de 512 KB.');

      const supabase = getSupabase();
      const path = `${airlineId}/logo-${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from('airline-logos')
        .upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('airline-logos').getPublicUrl(path);
      const { error } = await supabase.from('airlines').update({ logo_path: data.publicUrl }).eq('id', airlineId);
      if (error) throw error;
    },
    onSuccess: () => refreshAirlines(queryClient),
  });
}
