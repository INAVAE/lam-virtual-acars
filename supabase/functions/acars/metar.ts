// METAR de salida y de llegada que se guarda con el vuelo (tabla flight_weather).
//
// - Fuente: Aviation Weather Center de NOAA, la misma de la función weather.
//   Se toma la observación más cercana al momento del evento (de las últimas 3 h).
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

async function fromNoaa(icao: string, at: Date): Promise<Obj | null> {
  const res = await fetch(`${AWC}/metar?ids=${icao}&format=json&hours=3`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
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

/** Datos del vuelo de una sesión: id y códigos OACI de salida, destino y llegada final. */
export async function sessionAirports(db: SupabaseClient, sessionId: string) {
  const { data: session } = await db.from('flight_sessions').select('flight_id, final_airport_id').eq('id', sessionId).maybeSingle();
  if (!session) return null;
  const { data: flight } = await db.from('flights').select('id, origin_airport_id, destination_airport_id').eq('id', session.flight_id).maybeSingle();
  if (!flight) return null;
  const ids = [flight.origin_airport_id, flight.destination_airport_id, session.final_airport_id].filter((x): x is number => typeof x === 'number');
  const { data: airports } = await db.from('airports').select('id, icao_code').in('id', ids);
  const icao = (id: unknown) => airports?.find((a) => a.id === id)?.icao_code ?? null;
  return {
    flightId: flight.id as string,
    origin: icao(flight.origin_airport_id),
    destination: icao(flight.destination_airport_id),
    final: icao(session.final_airport_id),
  };
}
