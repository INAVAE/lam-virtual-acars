import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@lam/shared-types';
import { readEnv } from './env';

export type LamClient = SupabaseClient<Database>;

export const envStatus = readEnv();

export const supabase: LamClient | null = envStatus.ok
  ? createClient<Database>(envStatus.env.supabaseUrl, envStatus.env.supabaseKey, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function getSupabase(): LamClient {
  if (!supabase) throw new Error('Supabase no está configurado');
  return supabase;
}
