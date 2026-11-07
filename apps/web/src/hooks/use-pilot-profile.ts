import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { queryKeys } from '@/hooks/use-lam-data';
import { getSupabase } from '@/lib/supabase';

export interface PilotProfileMembership {
  airline_id: string;
  name: string;
  icao_code: string | null;
  slug: string;
  logo_path: string | null;
  brand_primary_color: string | null;
  status: 'pending' | 'active' | 'suspended' | 'rejected';
  roles: ('pilot' | 'ops_chief' | 'airline_admin')[];
  requested_at: string;
  decided_at: string | null;
}

export interface PilotProfileData {
  viewer: { self: boolean; staff: boolean; admin: boolean };
  profile: {
    user_id: string;
    pilot_number: number;
    display_name: string;
    email: string | null;
    country_code: string | null;
    avatar_url: string | null;
    bio: string | null;
    ivao_vid: string | null;
    discord_username: string | null;
    simbrief_username: string | null;
    time_zone: string | null;
    joined_at: string;
    account_status: 'active' | 'suspended';
    last_sign_in_at: string | null;
    is_superadmin: boolean;
    primary_airline_id: string | null;
  };
  memberships: PilotProfileMembership[];
  totals: {
    flights: number;
    block_minutes: number;
    flight_minutes: number;
    distance_nm: number;
    fuel_used_kg: number;
    average_score: number | null;
    average_landing_vs_fpm: number | null;
    best_landing_vs_fpm: number | null;
    airports: number;
    first_flight_at: string | null;
    last_flight_at: string | null;
    pending: number;
    rejected: number;
  };
  by_airline: { icao_code: string | null; name: string; flights: number; block_minutes: number; distance_nm: number }[];
  aircraft_types: { icao_code: string; model: string; manufacturer: string; flights: number; block_minutes: number; distance_nm: number; last_at: string }[];
  routes: { origin: string; destination: string; origin_city: string | null; destination_city: string | null; flights: number; distance_nm: number | null; last_at: string }[];
  monthly: { month: string; flights: number; block_minutes: number }[];
  recent_pireps: {
    id: string;
    folio: string;
    callsign: string;
    status: 'pending' | 'accepted' | 'rejected';
    airline_icao: string | null;
    origin: string | null;
    destination: string | null;
    aircraft_icao: string | null;
    registration: string | null;
    block_minutes: number | null;
    flight_minutes: number | null;
    distance_nm: number | null;
    landing_vs_fpm: number | null;
    score: number;
    date: string;
    can_open: boolean;
  }[];
  type_ratings: { airline_icao: string | null; icao_code: string; model: string; granted_at: string }[];
  tour_badges: { tour_id: string; code: string; name: string; color: string; badge_path: string | null; airline_icao: string | null; awarded_at: string }[];
  events: { event_id: string; folio: string; name: string; starts_at: string }[];
  trainings?: { training_id: string; folio: string; title: string; category: string; completed_at: string; starts_at: string }[];
}

/** Perfil completo de un piloto por su número LAM. */
export function usePilotProfile(pilotNumber: number | null) {
  return useQuery({
    queryKey: ['pilot-profile', pilotNumber],
    enabled: pilotNumber !== null && Number.isFinite(pilotNumber),
    queryFn: async (): Promise<PilotProfileData> => {
      const { data, error } = await getSupabase().rpc('get_pilot_profile', { p_pilot_number: pilotNumber! });
      if (error) throw error;
      return data as unknown as PilotProfileData;
    },
  });
}

/** Reduce la foto a 256 px (WebP) antes de subirla, para que pese poco. */
async function shrinkImage(file: File, size = 256): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('El navegador no pudo procesar la imagen.');
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86));
  if (!blob) throw new Error('El navegador no pudo procesar la imagen.');
  return blob;
}

/** Sube o quita la foto de perfil (bucket avatars, carpeta del propio usuario). */
export function useAvatar() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File | null) => {
      const supabase = getSupabase();
      const folder = user!.id;
      const { data: existing } = await supabase.storage.from('avatars').list(folder);
      let url: string | null = null;
      if (file) {
        if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Usa una imagen PNG, JPG o WebP.');
        if (file.size > 8 * 1024 * 1024) throw new Error('La imagen pesa más de 8 MB.');
        const blob = await shrinkImage(file);
        const path = `${folder}/${Date.now().toString(36)}.webp`;
        const { error } = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
        if (error) throw error;
        url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      }
      const { data, error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', folder).select('*').single();
      if (error) throw error;
      // Las fotos anteriores ya no se usan.
      const old = (existing ?? []).map((o) => `${folder}/${o.name}`).filter((p) => !url || !url.endsWith(p));
      if (old.length) await supabase.storage.from('avatars').remove(old);
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.profile(data.id), data);
      void queryClient.invalidateQueries({ queryKey: ['pilot-profile'] });
    },
  });
}
