export interface AppEnv {
  supabaseUrl: string;
  supabaseKey: string;
}

export type EnvResult = { ok: true; env: AppEnv } | { ok: false; missing: string[] };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Lee la configuración pública. Nunca debe contener claves de servicio. */
export function readEnv(source: Readonly<Record<string, unknown>> = import.meta.env): EnvResult {
  const supabaseUrl = text(source.VITE_SUPABASE_URL);
  const supabaseKey = text(source.VITE_SUPABASE_PUBLISHABLE_KEY);
  const missing: string[] = [];
  if (!supabaseUrl) missing.push('VITE_SUPABASE_URL');
  if (!supabaseKey) missing.push('VITE_SUPABASE_PUBLISHABLE_KEY');
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, env: { supabaseUrl, supabaseKey } };
}
