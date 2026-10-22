// Importa aeropuertos de OurAirports (dominio público) al catálogo de LAM.
//
// - Solo un superadministrador puede ejecutarla.
// - Usa el token de quien llama: las políticas RLS de airports deciden
//   qué se puede escribir. No usa la clave secreta del proyecto.
// - Modo "insert" (por defecto): agrega aeropuertos nuevos y no toca los
//   existentes. Modo "refresh": actualiza también los que vinieron de
//   OurAirports, sin tocar los capturados a mano.

import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { parse } from 'jsr:@std/csv@1.0.6';

const SOURCE_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const BATCH_SIZE = 500;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type AirportType = 'large_airport' | 'medium_airport' | 'small_airport' | 'heliport' | 'seaplane_base' | 'other';

interface AirportRow {
  icao_code: string;
  iata_code: string | null;
  name: string;
  city: string | null;
  country_code: string | null;
  latitude: number;
  longitude: number;
  elevation_ft: number | null;
  airport_type: AirportType;
  source: 'ourairports';
}

const TYPE_RANK: Record<string, number> = { large_airport: 3, medium_airport: 2, small_airport: 1 };
const ICAO = /^[A-Z][A-Z0-9]{3}$/;
const IATA = /^[A-Z0-9]{3}$/;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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

function clean(value: string | undefined): string {
  return (value ?? '').trim();
}

/**
 * Criterio de selección: aeropuertos grandes y medianos de todo el mundo,
 * pequeños con servicio regular y cualquier aeródromo de México, siempre
 * que tengan un código de cuatro caracteres tipo ICAO.
 */
function toAirport(r: Record<string, string>): AirportRow | null {
  const type = clean(r.type);
  const country = clean(r.iso_country).toUpperCase();
  const eligible =
    type === 'large_airport' ||
    type === 'medium_airport' ||
    (type === 'small_airport' && (clean(r.scheduled_service) === 'yes' || country === 'MX'));
  if (!eligible) return null;

  const code = [clean(r.icao_code), clean(r.gps_code), clean(r.ident)].map((c) => c.toUpperCase()).find((c) => ICAO.test(c));
  if (!code) return null;

  const latitude = Number.parseFloat(r.latitude_deg);
  const longitude = Number.parseFloat(r.longitude_deg);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const name = clean(r.name).slice(0, 160);
  if (name.length < 2) return null;

  const elevation = Number.parseInt(r.elevation_ft, 10);
  const iata = clean(r.iata_code).toUpperCase();
  const city = clean(r.municipality).slice(0, 120);

  return {
    icao_code: code,
    iata_code: IATA.test(iata) ? iata : null,
    name,
    city: city || null,
    country_code: /^[A-Z]{2}$/.test(country) ? country : null,
    latitude,
    longitude,
    elevation_ft: Number.isFinite(elevation) && elevation >= -1500 && elevation <= 30000 ? elevation : null,
    airport_type: type as AirportType,
    source: 'ourairports',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Usa POST' }, 405);

  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Inicia sesión para importar aeropuertos' }, 401);

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', publishableKey(), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(authorization.slice('Bearer '.length));
  if (userError || !userData.user) return json({ error: 'La sesión no es válida' }, 401);

  const { data: superadmin, error: roleError } = await supabase
    .from('organization_members')
    .select('role')
    .eq('user_id', userData.user.id)
    .eq('role', 'superadmin')
    .maybeSingle();
  if (roleError) return json({ error: roleError.message }, 500);
  if (!superadmin) return json({ error: 'Solo un superadministrador puede importar aeropuertos' }, 403);

  let mode: 'insert' | 'refresh' = 'insert';
  try {
    const body = (await req.json()) as { mode?: string };
    if (body?.mode === 'refresh') mode = 'refresh';
  } catch {
    // Sin cuerpo: modo por defecto.
  }

  const response = await fetch(SOURCE_URL);
  if (!response.ok) return json({ error: `OurAirports respondió ${response.status}` }, 502);
  const csv = await response.text();
  const records = parse(csv, { skipFirstRow: true }) as Record<string, string>[];

  // Un registro por código; si se repite, gana el aeropuerto de mayor categoría.
  const byCode = new Map<string, AirportRow>();
  for (const record of records) {
    const airport = toAirport(record);
    if (!airport) continue;
    const current = byCode.get(airport.icao_code);
    if (!current || (TYPE_RANK[airport.airport_type] ?? 0) > (TYPE_RANK[current.airport_type] ?? 0)) {
      byCode.set(airport.icao_code, airport);
    }
  }

  let airports = [...byCode.values()];
  if (mode === 'refresh') {
    // No se pisan los aeropuertos capturados a mano.
    const { data: manual, error } = await supabase.from('airports').select('icao_code').eq('source', 'manual');
    if (error) return json({ error: error.message }, 500);
    const manualCodes = new Set(manual.map((m) => m.icao_code));
    airports = airports.filter((a) => !manualCodes.has(a.icao_code));
  }

  let written = 0;
  for (let i = 0; i < airports.length; i += BATCH_SIZE) {
    const batch = airports.slice(i, i + BATCH_SIZE);
    const { error, count } = await supabase
      .from('airports')
      .upsert(batch, { onConflict: 'icao_code', ignoreDuplicates: mode === 'insert', count: 'exact' });
    if (error) {
      return json({ error: `Lote ${i / BATCH_SIZE + 1}: ${error.message}`, written }, 500);
    }
    written += count ?? 0;
  }

  return json({
    mode,
    source: SOURCE_URL,
    sourceRows: records.length,
    eligible: byCode.size,
    written,
  });
});
