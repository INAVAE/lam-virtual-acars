// METAR de salida y de llegada que se guarda con el vuelo (tabla flight_weather).
//
// - Fuente: Aviation Weather Center de NOAA, la misma de la función weather.
//   Se toma la observación más cercana al momento del evento (de las 3 h
//   anteriores). Si el evento ya pasó, se pide con fecha de fin (`date`) para
//   poder recuperar vuelos de días anteriores.
// - Si NOAA no responde, se usa la caché de public.weather_reports si la
//   observación es de menos de 90 minutos antes del evento.
// - Corre en segundo plano: el conector no espera por esto.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';

type Obj = Record<string, unknown>;

const AWC = 'https://aviationweather.gov/api/data';
const USER_AGENT = 'LAM-Virtual-ACARS/1.0 (+https://inavae.github.io/lam-virtual-acars/)';
const ICAO = /^[A-Z0-9]{3,4}$/;

function obj(value: unknown): Obj {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : {};
}
function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}
function str(value: unknown, max = 600): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}
function epochIso(value: unknown): string | null {
  const n = num(value);
  return n === null ? null : new Date(n * 1000).toISOString();
}

/** Misma forma que guarda la función weather (lib/weather.ts en la web). */
export function pickMetar(m: Obj): Obj {
  const wdir = typeof m.wdir === 'string' && m.wdir.trim().toUpperCase() === 'VRB' ? 'VRB' : num(m.wdir);
  const visib = typeof m.visib === 'string' && /^\d+(\.\d+)?\+$/.test(m.visib.trim()) ? m.visib.trim() : num(m.visib);
  const clouds = Array.isArray(m.clouds)
    ? m.clouds.slice(0, 8).map((c) => {
        const o = obj(c);
        return { cover: str(o.cover, 8), base: num(o.base) };
      })
    : [];
  return {
    raw: str(m.rawOb, 600),
    type: str(m.metarType, 10),
    observed_at: epochIso(m.obsTime) ?? (str(m.reportTime) ? new Date(String(m.reportTime).replace(' ', 'T') + 'Z').toISOString() : null),
    temp_c: num(m.temp),
    dewpoint_c: num(m.dewp),
    wind_dir: wdir,
    wind_kt: num(m.wspd),
    gust_kt: num(m.wgst),
    visibility_sm: visib,
    altimeter_hpa: num(m.altim),
    weather: str(m.wxString, 80),
    vertical_visibility_ft: num(m.vertVis),
    clouds,
    flight_category: str(m.fltCat, 5),
  };
}

/** La observación más cercana al momento (preferentemente anterior o hasta 15 min después). */
export function closestMetar(list: unknown, at: Date): Obj | null {
  if (!Array.isArray(list)) return null;
  let best: { m: Obj; score: number } | null = null;
  for (const item of list) {
    const m = obj(item);
    const t = num(m.obsTime);
    if (t === null) continue;
    const diff = t * 1000 - at.getTime();
    // Las posteriores al evento cuentan solo si son de hasta 15 min después, y pesan el doble.
    if (diff > 15 * 60_000) continue;
    const score = diff > 0 ? diff * 2 : -diff;
    if (!best || score < best.score) best = { m, score };
  }
  return best?.m ?? null;
}

/** Fecha de fin de la búsqueda en NOAA (yyyymmdd_hhnn, UTC). */
export function awcDate(at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${at.getUTCFullYear()}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}_${p(at.getUTCHours())}${p(at.getUTCMinutes())}`;
}

/** URL de NOAA: sin fecha si el evento es de ahora; con fecha de fin si ya pasó. */
export function noaaMetarUrl(icao: string, at: Date, now = new Date()): string {
  const end = new Date(at.getTime() + 15 * 60_000);
  const base = `${AWC}/metar?ids=${icao}&format=json&hours=4`;
  return end.getTime() < now.getTime() - 5 * 60_000 ? `${base}&date=${awcDate(end)}` : base;
}

async function fromNoaa(icao: string, at: Date): Promise<Obj | null> {
  const res = await fetch(noaaMetarUrl(icao, at), {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`NOAA respondió ${res.status}`);
  const text = await res.text();
  if (!text.trim()) return null;
  const m = closestMetar(JSON.parse(text), at);
  return m ? pickMetar(m) : null;
}

async function fromCache(db: SupabaseClient, icao: string, at: Date): Promise<Obj | null> {
  const { data } = await db.from('weather_reports').select('metar, metar_observed_at').eq('icao', icao).maybeSingle();
  const observed = data?.metar_observed_at ? Date.parse(data.metar_observed_at) : Number.NaN;
  if (!data?.metar || !Number.isFinite(observed)) return null;
  const diff = at.getTime() - observed;
  return diff >= -15 * 60_000 && diff <= 90 * 60_000 ? (data.metar as Obj) : null;
}

/** Guarda el METAR de salida o de llegada del vuelo. No lanza errores: solo los anota. */
export async function captureFlightMetar(db: SupabaseClient, flightId: string, role: 'departure' | 'arrival', icao: string | null | undefined, at: Date) {
  try {
    const code = (icao ?? '').toUpperCase();
    if (!ICAO.test(code)) return;
    let metar: Obj | null = null;
    let source: 'noaa' | 'cache' | 'none' = 'none';
    try {
      metar = await fromNoaa(code, at);
      if (metar) source = 'noaa';
    } catch (error) {
      console.error(`METAR ${code}: NOAA falló`, error);
    }
    if (!metar) {
      metar = await fromCache(db, code, at);
      if (metar) source = 'cache';
    }
    const observed = metar && typeof metar.observed_at === 'string' ? metar.observed_at : null;
    const { error } = await db.from('flight_weather').upsert(
      { flight_id: flightId, role, icao: code, event_at: at.toISOString(), observed_at: observed, metar, source, captured_at: new Date().toISOString() },
      { onConflict: 'flight_id,role' },
    );
    if (error) console.error('No se pudo guardar el METAR del vuelo', error);
  } catch (error) {
    console.error('Error al guardar el METAR del vuelo', error);
  }
}

/** Datos del vuelo: id, códigos OACI de salida, destino y llegada final, y horas de calzos. */
export interface FlightAirports {
  flightId: string;
  origin: string | null;
  destination: string | null;
  final: string | null;
  sessionId: string | null;
  blockOffAt: string | null;
  blockOnAt: string | null;
  endedAt: string | null;
}

async function check<T>(label: string, query: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T | null> {
  const { data, error } = await query;
  // Antes un error aquí (por ejemplo, de permisos) se perdía y no se guardaba nada.
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

export async function flightAirports(db: SupabaseClient, flightId: string): Promise<FlightAirports | null> {
  const flight = await check<{ id: string; origin_airport_id: number; destination_airport_id: number }>(
    'vuelo',
    db.from('flights').select('id, origin_airport_id, destination_airport_id').eq('id', flightId).maybeSingle(),
  );
  if (!flight) return null;
  const session = await check<{ id: string; final_airport_id: number | null; ended_at: string | null }>(
    'sesión',
    db.from('flight_sessions').select('id, final_airport_id, ended_at').eq('flight_id', flightId).maybeSingle(),
  );
  const ids = [flight.origin_airport_id, flight.destination_airport_id, session?.final_airport_id].filter((x): x is number => x !== null && x !== undefined);
  const airports = await check<{ id: number; icao_code: string }[]>('aeropuertos', db.from('airports').select('id, icao_code').in('id', ids));
  // bigint puede llegar como número o texto: se compara como texto.
  const icao = (id: unknown) => (id === null || id === undefined ? null : (airports?.find((a) => String(a.id) === String(id))?.icao_code ?? null));
  let blockOffAt: string | null = null;
  let blockOnAt: string | null = null;
  if (session) {
    const events = await check<{ type: string; occurred_at: string }[]>(
      'eventos',
      db.from('flight_events').select('type, occurred_at').eq('session_id', session.id).in('type', ['block_off', 'block_on']).order('seq'),
    );
    blockOffAt = events?.find((e) => e.type === 'block_off')?.occurred_at ?? null;
    blockOnAt = [...(events ?? [])].reverse().find((e) => e.type === 'block_on')?.occurred_at ?? null;
  }
  return {
    flightId: flight.id,
    origin: icao(flight.origin_airport_id),
    destination: icao(flight.destination_airport_id),
    final: icao(session?.final_airport_id),
    sessionId: session?.id ?? null,
    blockOffAt,
    blockOnAt,
    endedAt: session?.ended_at ?? null,
  };
}

/** Lo mismo a partir de la sesión del conector. */
export async function sessionAirports(db: SupabaseClient, sessionId: string): Promise<FlightAirports | null> {
  const session = await check<{ flight_id: string }>('sesión', db.from('flight_sessions').select('flight_id').eq('id', sessionId).maybeSingle());
  return session ? flightAirports(db, session.flight_id) : null;
}

/** Días hacia atrás que se intentan recuperar de NOAA. */
export const BACKFILL_DAYS = 14;

/**
 * Guarda los METAR que le falten al vuelo (salida y llegada). Para vuelos
 * terminados antes de que esto funcionara. Devuelve los roles que intentó.
 */
export async function fillMissingFlightMetar(db: SupabaseClient, info: FlightAirports, now = new Date()): Promise<string[]> {
  const saved = await check<{ role: string }[]>('clima guardado', db.from('flight_weather').select('role').eq('flight_id', info.flightId));
  const have = new Set((saved ?? []).map((r) => r.role));
  const oldest = now.getTime() - BACKFILL_DAYS * 86_400_000;
  const done: string[] = [];
  const departureAt = info.blockOffAt;
  if (!have.has('departure') && departureAt && Date.parse(departureAt) > oldest) {
    await captureFlightMetar(db, info.flightId, 'departure', info.origin, new Date(departureAt));
    done.push('departure');
  }
  const arrivalAt = info.blockOnAt ?? info.endedAt;
  if (!have.has('arrival') && arrivalAt && Date.parse(arrivalAt) > oldest) {
    await captureFlightMetar(db, info.flightId, 'arrival', info.final ?? info.destination, new Date(arrivalAt));
    done.push('arrival');
  }
  return done;
}
