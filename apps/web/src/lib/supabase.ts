import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@lam/shared-types';
import { readEnv } from './env';

export type LamClient = SupabaseClient<Database>;

export const envStatus = readEnv();

/** Sesión que llega en el fragmento de un enlace de correo de Supabase Auth. */
export interface EmailLinkTokens {
  access_token: string;
  refresh_token: string;
  /** invite (cuenta aprobada), recovery, signup… */
  type: string;
}

/**
 * Las invitaciones (cuenta de piloto aprobada) y los enlaces que manda el
 * servidor no pasan por PKCE: Supabase devuelve la sesión en el fragmento
 * (#access_token=…). El cliente usa PKCE y no la tomaría, así que se lee aquí,
 * se borra de la barra de direcciones (no debe quedar en el historial) y
 * AuthProvider la abre con setSession.
 */
function takeEmailLinkTokens(): EmailLinkTokens | null {
  if (typeof window === 'undefined' || !window.location.hash.includes('access_token=')) return null;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const access = hash.get('access_token');
  const refresh = hash.get('refresh_token');
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
  if (!access || !refresh) return null;
  return { access_token: access, refresh_token: refresh, type: hash.get('type') ?? '' };
}

export const pendingEmailLink: EmailLinkTokens | null = takeEmailLinkTokens();

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
