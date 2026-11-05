// METAR y TAF de cualquier aeropuerto del mundo para la web.
//
// - Fuente: Aviation Weather Center de NOAA (https://aviationweather.gov/data/api/).
//   Es gratuita y sin llave, pero no permite CORS y limita a 100 consultas por
//   minuto; por eso la web no la llama directo.
// - Solo para usuarios con sesión: valida el token de quien llama.
// - Caché en public.weather_reports (METAR 5 min, TAF 15 min). La tabla solo la
//   toca esta función con la clave secreta, así nadie guarda un METAR falso.
// - Si NOAA falla, responde con lo último guardado y lo indica en upstream_error.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
import { isStale, latestBy, num, obj, pickMetar, pickTaf, str, type Obj } from './awc.ts';

const AWC = 'https://aviationweather.gov/api/data';
const USER_AGENT = 'LAM-Virtual-ACARS/1.0 (+https://inavae.github.io/lam-virtual-acars/)';
const METAR_TTL_MS = 5 * 60_000;
const TAF_TTL_MS = 15 * 60_000;
const MAX_AIRPORTS = 10;
const ICAO = /^[A-Z0-9]{3,4}$/;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface CacheRow {
  icao: string;
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  elevation_m: number | null;
  metar: Obj | null;
  metar_observed_at: string | null;
  metar_fetched_at: string | null;
  taf: Obj | null;
  taf_issued_at: string | null;
  taf_fetched_at: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function fail(code: string, error: string, status: number): Response {
  return json({ code, error }, status);
}

function publishableKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}') as Record<string, string>;
    if (keys.default) return keys.default;
  } catch {
    // Formato anterior de claves.
  }
  return Deno.env.get('SUPABASE_ANON_KEY') ?? '';
}

function secretKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
    if (keys.default) return keys.default;
  } catch {
    // Formato anterior de claves.
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

/** Consulta NOAA. 204 = sin datos (lista vacía). Lanza si no responde bien. */
async function awc(product: 'metar' | 'taf', icaos: string[]): Promise<Obj[]> {
  const url = `${AWC}/${product}?ids=${icaos.join(',')}&format=json`;
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  if (response.status === 204) return [];
  if (!response.ok) throw new Error(`${product.toUpperCase()}: NOAA respondió ${response.status}`);
  const text = await response.text();
  if (!text.trim()) return [];
  const data = JSON.parse(text);
  return Array.isArray(data) ? data.map(obj) : [];
}

function emptyRow(icao: string): CacheRow {
  return {
    icao,
    name: null,
    latitude: null,
    longitude: null,
    elevation_m: null,
    metar: null,
    metar_observed_at: null,
    metar_fetched_at: null,
    taf: null,
    taf_issued_at: null,
    taf_fetched_at: null,
  };
}

function station(row: CacheRow, src: Obj) {
  row.name = str(src.name, 200) ?? row.name;
  row.latitude = num(src.lat) ?? row.latitude;
  row.longitude = num(src.lon) ?? row.longitude;
  const elev = num(src.elev);
  row.elevation_m = elev === null ? row.elevation_m : Math.round(elev);
}

async function refresh(admin: SupabaseClient, icaos: string[]) {
  const now = Date.now();
  const { data: cached, error } = await admin.from('weather_reports').select('*').in('icao', icaos);
  if (error) throw new Error(error.message);
  const rows = new Map<string, CacheRow>((cached ?? []).map((r) => [r.icao as string, r as CacheRow]));
  for (const icao of icaos) if (!rows.has(icao)) rows.set(icao, emptyRow(icao));

  const needMetar = icaos.filter((i) => isStale(rows.get(i)!.metar_fetched_at, METAR_TTL_MS, now));
  const needTaf = icaos.filter((i) => isStale(rows.get(i)!.taf_fetched_at, TAF_TTL_MS, now));
  const errors: string[] = [];
  const changed = new Set<string>();
  const fetchedAt = new Date(now).toISOString();

  const [metars, tafs] = await Promise.all([
    needMetar.length ? awc('metar', needMetar).catch((e) => (errors.push(String(e.message ?? e)), null)) : Promise.resolve([]),
    needTaf.length ? awc('taf', needTaf).catch((e) => (errors.push(String(e.message ?? e)), null)) : Promise.resolve([]),
  ]);

  if (metars) {
    const latest = latestBy(metars, (r) => num(r.obsTime) ?? 0);
    for (const icao of needMetar) {
      const row = rows.get(icao)!;
      const m = latest.get(icao);
      if (m) station(row, m);
      const picked = m ? pickMetar(m) : null;
      row.metar = picked;
      row.metar_observed_at = (picked?.observed_at as string | null | undefined) ?? null;
      row.metar_fetched_at = fetchedAt;
      changed.add(icao);
    }
  }
  if (tafs) {
    const latest = latestBy(tafs, (r) => num(r.validTimeFrom) ?? 0);
    for (const icao of needTaf) {
      const row = rows.get(icao)!;
      const t = latest.get(icao);
      if (t) station(row, t);
      const picked = t ? pickTaf(t) : null;
      row.taf = picked;
      row.taf_issued_at = (picked?.issued_at as string | null | undefined) ?? null;
      row.taf_fetched_at = fetchedAt;
      changed.add(icao);
    }
  }

  if (changed.size > 0) {
    const upserts = [...changed].map((icao) => ({ ...rows.get(icao)!, updated_at: fetchedAt }));
    const { error: saveError } = await admin.from('weather_reports').upsert(upserts, { onConflict: 'icao' });
    if (saveError) errors.push(`caché: ${saveError.message}`);
  }

  return { rows: icaos.map((i) => rows.get(i)!), errors };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('method', 'Usa POST', 405);

  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return fail('auth', 'Inicia sesión para consultar el clima', 401);
  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', publishableKey(), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(authorization.slice('Bearer '.length));
  if (userError || !userData.user) return fail('auth', 'La sesión no es válida', 401);

  let icaos: string[] = [];
  try {
    const body = (await req.json()) as { icaos?: unknown };
    if (Array.isArray(body?.icaos)) {
      icaos = [...new Set(body.icaos.map((v) => String(v ?? '').trim().toUpperCase()))];
    }
  } catch {
    // Cuerpo inválido.
  }
  if (icaos.length === 0) return fail('bad_request', 'Indica al menos un aeropuerto', 400);
  if (icaos.length > MAX_AIRPORTS) return fail('bad_request', `Consulta como máximo ${MAX_AIRPORTS} aeropuertos a la vez`, 400);
  const invalid = icaos.filter((i) => !ICAO.test(i));
  if (invalid.length > 0) return fail('bad_request', `Código ICAO inválido: ${invalid.join(', ')}`, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const { rows, errors } = await refresh(admin, icaos);
    return json({
      source: 'NOAA Aviation Weather Center',
      upstream_error: errors.length ? errors.join('; ') : null,
      reports: rows.map((r) => ({
        icao: r.icao,
        name: r.name,
        latitude: r.latitude,
        longitude: r.longitude,
        elevation_m: r.elevation_m,
        metar: r.metar,
        metar_fetched_at: r.metar_fetched_at,
        taf: r.taf,
        taf_fetched_at: r.taf_fetched_at,
      })),
    });
  } catch (e) {
    return fail('weather_error', `No se pudo consultar el clima: ${String((e as Error).message ?? e)}`, 502);
  }
});
