// Importa el último OFP de SimBrief del piloto y lo asocia a uno de sus vuelos.
//
// - Usa el token de quien llama: RLS solo deja escribir el OFP del propio
//   vuelo mientras no haya comenzado. No usa la clave secreta del proyecto.
// - El usuario de SimBrief sale del perfil del piloto (Ajustes).
// - Las diferencias contra la reserva las calcula la base de datos al
//   guardar (disparador simbrief_ofps_set), no esta función.

import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const SIMBRIEF_URL = 'https://www.simbrief.com/api/xml.fetcher.php';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AIRPORT = /^[A-Z0-9]{3,4}$/;

type Obj = Record<string, unknown>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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

function obj(value: unknown): Obj {
  // Con varios alternos SimBrief devuelve un arreglo; se toma el primero.
  if (Array.isArray(value)) return obj(value[0]);
  return value && typeof value === 'object' ? (value as Obj) : {};
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

function upper(value: unknown, max: number): string | null {
  return text(value, max)?.toUpperCase() ?? null;
}

function num(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | null {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function int(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | null {
  const n = num(value, min, max);
  return n === null ? null : Math.round(n);
}

function round1(value: unknown): number | null {
  const n = num(value, 0, 1e8);
  return n === null ? null : Math.round(n * 10) / 10;
}

function minutes(seconds: unknown): number | null {
  const n = num(seconds, 0, 7 * 24 * 3600);
  return n === null ? null : Math.round(n / 60);
}

/** Mensaje de error de SimBrief (llega como XML aunque se pida JSON). */
function simbriefError(body: string): string {
  const xml = body.match(/<status>([^<]+)<\/status>/i)?.[1];
  if (xml) return xml.trim();
  try {
    const status = obj(obj(JSON.parse(body)).fetch).status;
    if (typeof status === 'string') return status;
  } catch {
    // Sin formato reconocible.
  }
  return 'SimBrief no devolvió un plan de vuelo';
}

/** Convierte el OFP de SimBrief en una fila de simbrief_ofps. */
function toRow(flightId: string, ofp: Obj) {
  const params = obj(ofp.params);
  const general = obj(ofp.general);
  const aircraft = obj(ofp.aircraft);
  const fuel = obj(ofp.fuel);
  const weights = obj(ofp.weights);
  const times = obj(ofp.times);
  const files = obj(ofp.files);
  const pdf = obj(files.pdf);

  const origin = upper(obj(ofp.origin).icao_code, 4);
  const destination = upper(obj(ofp.destination).icao_code, 4);
  const requestId = text(params.request_id, 64);
  if (!requestId || !origin || !destination || !AIRPORT.test(origin) || !AIRPORT.test(destination)) {
    return null;
  }

  const alternate = upper(obj(ofp.alternate).icao_code, 4);
  const generated = int(params.time_generated, 1);
  const units = String(params.units ?? '').toLowerCase().startsWith('lb') ? 'lb' : 'kg';
  const directory = text(files.directory, 300);
  const pdfName = text(pdf.link, 200);
  const pdfUrl = directory && pdfName ? `${directory}${pdfName}` : null;

  return {
    flight_id: flightId,
    request_id: requestId,
    static_id: text(params.static_id, 64),
    generated_at: generated ? new Date(generated * 1000).toISOString() : null,
    airline_icao: upper(general.icao_airline, 4),
    flight_number: upper(general.flight_number, 10),
    atc_callsign: upper(obj(ofp.atc).callsign, 12),
    origin_icao: origin,
    destination_icao: destination,
    alternate_icao: alternate && AIRPORT.test(alternate) ? alternate : null,
    aircraft_icao: upper(aircraft.icao_code ?? aircraft.icaocode, 4),
    registration: upper(aircraft.reg, 12),
    route: text(general.route, 4000),
    cruise_altitude_ft: int(general.initial_altitude, 0, 70000),
    air_distance_nm: int(general.air_distance ?? general.route_distance, 0),
    est_enroute_minutes: minutes(times.est_time_enroute),
    est_block_minutes: minutes(times.est_block),
    fuel_units: units,
    block_fuel: round1(fuel.plan_ramp),
    trip_fuel: round1(fuel.enroute_burn),
    reserve_fuel: round1(fuel.reserve),
    zfw: round1(weights.est_zfw),
    tow: round1(weights.est_tow),
    ldw: round1(weights.est_ldw),
    pax_count: int(weights.pax_count, 0, 2000),
    cargo: round1(weights.cargo),
    pdf_url: pdfUrl?.startsWith('https://') ? pdfUrl : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail('method', 'Usa POST', 405);

  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return fail('auth', 'Inicia sesión para importar el plan de vuelo', 401);

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', publishableKey(), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(authorization.slice('Bearer '.length));
  if (userError || !userData.user) return fail('auth', 'La sesión no es válida', 401);
  const userId = userData.user.id;

  let flightId = '';
  try {
    const body = (await req.json()) as { flight_id?: unknown };
    flightId = typeof body?.flight_id === 'string' ? body.flight_id : '';
  } catch {
    // Cuerpo inválido.
  }
  if (!UUID.test(flightId)) return fail('bad_request', 'Falta el vuelo', 400);

  const { data: flight, error: flightError } = await supabase
    .from('flights')
    .select('id, user_id, status')
    .eq('id', flightId)
    .maybeSingle();
  if (flightError) return fail('db', flightError.message, 500);
  if (!flight || flight.user_id !== userId) return fail('not_found', 'Vuelo no encontrado', 404);
  if (flight.status !== 'scheduled') {
    return fail('flight_closed', 'Solo se importa el plan de vuelos reservados que no han comenzado', 409);
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('simbrief_username')
    .eq('id', userId)
    .single();
  if (profileError) return fail('db', profileError.message, 500);
  const username = profile.simbrief_username?.trim();
  if (!username) return fail('no_username', 'Configura tu usuario de SimBrief en Ajustes', 400);

  let response: Response;
  try {
    response = await fetch(`${SIMBRIEF_URL}?username=${encodeURIComponent(username)}&json=1`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return fail('simbrief_unreachable', 'No se pudo conectar con SimBrief; intenta de nuevo', 502);
  }
  const body = await response.text();
  if (!response.ok) {
    return fail('simbrief_error', `SimBrief: ${simbriefError(body)}`, 502);
  }

  let ofp: Obj;
  try {
    ofp = obj(JSON.parse(body));
  } catch {
    return fail('simbrief_error', `SimBrief: ${simbriefError(body)}`, 502);
  }

  const row = toRow(flightId, ofp);
  if (!row) return fail('simbrief_incomplete', 'El plan de SimBrief no tiene origen, destino o identificador', 422);

  const { data: saved, error: saveError } = await supabase
    .from('simbrief_ofps')
    .upsert(row, { onConflict: 'flight_id' })
    .select('*')
    .single();
  if (saveError) return fail('db', saveError.message, saveError.code === '42501' ? 403 : 500);

  return json({ ofp: saved });
});
