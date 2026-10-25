import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';

export interface AcarsDevice {
  id: string;
  name: string;
  token_prefix: string;
  app_version: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** Dispositivos ACARS propios (el hash del token nunca sale de la base). */
export function useMyAcarsDevices() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['acars-devices', user?.id],
    enabled: Boolean(user),
    queryFn: async (): Promise<AcarsDevice[]> => {
      const { data, error } = await getSupabase()
        .from('acars_devices')
        .select('id, name, token_prefix, app_version, created_at, last_used_at, revoked_at')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useApproveAcarsLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => {
      const { data, error } = await getSupabase().rpc('approve_acars_link', { p_code: code });
      if (error) throw error;
      return (data as { device_name?: string } | null)?.device_name ?? 'el equipo';
    },
    // El conector recibe su token unos segundos después; refrescar la lista entonces.
    onSuccess: () => {
      window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['acars-devices'] }), 5000);
    },
  });
}

export function useRevokeAcarsDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (deviceId: string) => {
      const { error } = await getSupabase().rpc('revoke_acars_device', { p_device_id: deviceId });
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['acars-devices'] }),
  });
}
