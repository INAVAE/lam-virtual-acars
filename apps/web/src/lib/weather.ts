/**
 * METAR y TAF que entrega la Edge Function `weather` (datos del Aviation Weather
 * Center de NOAA) y su lectura en español.
 */

export interface CloudLayer {
  cover: string | null;
  base: number | null;
  type?: string | null;
}

export interface Metar {
  raw: string | null;
  type: string | null;
  observed_at: string | null;
  temp_c: number | null;
  dewpoint_c: number | null;
  /** Grados o "VRB". */
  wind_dir: number | string | null;
  wind_kt: number | null;
  gust_kt: number | null;
  /** Millas terrestres; "10+" o "6+" = más de esa distancia. */
  visibility_sm: number | string | null;
  altimeter_hpa: number | null;
  weather: string | null;
  vertical_visibility_ft: number | null;
  clouds: CloudLayer[];
  flight_category: string | null;
}

export interface TafPeriod {
  from: string | null;
  to: string | null;
  change: string | null;
  probability: number | null;
  wind_dir: number | string | null;
  wind_kt: number | null;
  gust_kt: number | null;
  visibility_sm: number | string | null;
  weather: string | null;
  vertical_visibility_ft: number | null;
  clouds: CloudLayer[];
}

export interface Taf {
  raw: string | null;
  issued_at: string | null;
  valid_from: string | null;
  valid_to: string | null;
  periods: TafPeriod[];
}

export interface WeatherReport {
  icao: string;
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  elevation_m: number | null;
  metar: Metar | null;
  metar_fetched_at: string | null;
  taf: Taf | null;
  taf_fetched_at: string | null;
}

export interface WeatherResponse {
  source: string;
  upstream_error: string | null;
  reports: WeatherReport[];
}

export const ICAO_PATTERN = /^[A-Z0-9]{3,4}$/;
/** Lo que la función acepta por consulta. */
export const MAX_WEATHER_AIRPORTS = 10;

export function normalizeIcao(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 4);
}

// -----------------------------------------------------------------------------
// Categoría de vuelo
// -----------------------------------------------------------------------------
export type FlightCategory = 'VFR' | 'MVFR' | 'IFR' | 'LIFR';

export const flightCategoryLabels: Record<FlightCategory, string> = {
  VFR: 'VFR',
  MVFR: 'VFR marginal',
  IFR: 'IFR',
  LIFR: 'IFR bajo',
};

/** Tono del Badge por categoría (convención de colores de aviación: verde, azul, rojo, magenta). */
export const flightCategoryTone: Record<FlightCategory, 'ok' | 'info' | 'danger' | 'warn'> = {
  VFR: 'ok',
  MVFR: 'info',
  IFR: 'danger',
  LIFR: 'warn',
};

/** Visibilidad en millas terrestres como número ("10+" → 10). */
export function visibilitySm(value: number | string | null): number | null {
  if (value === null) return null;
  if (typeof value === 'number') return value;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/** Techo: la capa BKN, OVC u OVX más baja, o la visibilidad vertical. */
export function ceilingFt(clouds: readonly CloudLayer[], verticalVisibilityFt: number | null = null): number | null {
  const bases = clouds
    .filter((c) => (c.cover === 'BKN' || c.cover === 'OVC' || c.cover === 'OVX') && c.base !== null)
    .map((c) => c.base as number);
  if (verticalVisibilityFt !== null) bases.push(verticalVisibilityFt);
  return bases.length > 0 ? Math.min(...bases) : null;
}

/**
 * Categoría de la FAA: VFR (techo > 3,000 ft y visibilidad > 5 SM), MVFR (1,000–3,000 ft
 * o 3–5 SM), IFR (500–999 ft o 1–<3 SM), LIFR (< 500 ft o < 1 SM). Usa la de NOAA si viene.
 */
export function flightCategory(metar: Pick<Metar, 'flight_category' | 'clouds' | 'vertical_visibility_ft' | 'visibility_sm'>): FlightCategory | null {
  const given = metar.flight_category?.toUpperCase();
  if (given === 'VFR' || given === 'MVFR' || given === 'IFR' || given === 'LIFR') return given;
  const ceiling = ceilingFt(metar.clouds, metar.vertical_visibility_ft);
  const vis = visibilitySm(metar.visibility_sm);
  if (ceiling === null && vis === null) return null;
  const c = ceiling ?? Number.POSITIVE_INFINITY;
  const v = vis ?? Number.POSITIVE_INFINITY;
  if (c < 500 || v < 1) return 'LIFR';
  if (c < 1000 || v < 3) return 'IFR';
  if (c <= 3000 || v <= 5) return 'MVFR';
  return 'VFR';
}

// -----------------------------------------------------------------------------
// Lectura en español
// -----------------------------------------------------------------------------
export function formatWind(dir: number | string | null, speed: number | null, gust: number | null): string {
  if (speed === null) return 'Sin dato';
  if (speed === 0) return 'Calma';
  const from = dir === 'VRB' ? 'Variable' : typeof dir === 'number' ? `${String(Math.round(dir)).padStart(3, '0')}°` : '';
  const base = [from, `${speed} kt`].filter(Boolean).join(' ');
  return gust ? `${base}, ráfagas ${gust} kt` : base;
}

/** Visibilidad en km o metros. "10+" SM = 16 km o más; METAR fuera de EE. UU. reporta 9999 = 10 km o más. */
export function formatVisibility(value: number | string | null): string {
  const sm = visibilitySm(value);
  if (sm === null) return 'Sin dato';
  const plus = typeof value === 'string' && value.endsWith('+');
  if (plus && sm >= 6) return '10 km o más';
  const meters = sm * 1609.344;
  if (meters >= 9900) return '10 km o más';
  if (meters >= 5000) return `${Math.round(meters / 1000)} km`;
  return `${Math.round(meters / 100) * 100} m`;
}

const COVER_LABELS: Record<string, string> = {
  SKC: 'Despejado',
  CLR: 'Despejado',
  NSC: 'Sin nubes significativas',
  NCD: 'Sin nubes detectadas',
  CAVOK: 'CAVOK',
  FEW: 'Pocas',
  SCT: 'Dispersas',
  BKN: 'Fragmentadas',
  OVC: 'Cubierto',
  OVX: 'Cielo oscurecido',
};

export function formatClouds(clouds: readonly CloudLayer[], verticalVisibilityFt: number | null = null): string {
  const layers = clouds
    .filter((c) => c.cover)
    .map((c) => {
      const label = COVER_LABELS[c.cover as string] ?? c.cover;
      if (c.base === null || c.base === undefined || c.cover === 'CLR' || c.cover === 'SKC' || c.cover === 'CAVOK') return label;
      const type = c.type === 'CB' ? ' (cumulonimbos)' : c.type === 'TCU' ? ' (cúmulos de gran desarrollo)' : '';
      return `${label} a ${c.base.toLocaleString('en-US')} ft${type}`;
    });
  if (verticalVisibilityFt !== null) layers.push(`Visibilidad vertical ${verticalVisibilityFt.toLocaleString('en-US')} ft`);
  return layers.length > 0 ? layers.join(' · ') : 'Sin nubes reportadas';
}

const WX_DESCRIPTORS: Record<string, string> = {
  MI: 'baja',
  PR: 'parcial',
  BC: 'en bancos',
  DR: 'ventisca baja de',
  BL: 'ventisca alta de',
  SH: 'chubascos de',
  TS: 'tormenta',
  FZ: 'engelante',
};

const WX_PHENOMENA: Record<string, string> = {
  DZ: 'llovizna',
  RA: 'lluvia',
  SN: 'nieve',
  SG: 'cinarra',
  IC: 'cristales de hielo',
  PL: 'hielo granulado',
  GR: 'granizo',
  GS: 'granizo pequeño',
  UP: 'precipitación desconocida',
  BR: 'neblina',
  FG: 'niebla',
  FU: 'humo',
  VA: 'ceniza volcánica',
  DU: 'polvo',
  SA: 'arena',
  HZ: 'calima',
  PY: 'rocío',
  PO: 'remolinos de polvo',
  SQ: 'turbonada',
  FC: 'nube embudo',
  SS: 'tormenta de arena',
  DS: 'tormenta de polvo',
};

/** "-SHRA" → "Chubascos de lluvia ligeros". Lo que no reconoce se deja como viene. */
function describeToken(token: string): string {
  let t = token;
  let intensity = '';
  let vicinity = false;
  if (t.startsWith('+')) {
    intensity = 'fuerte';
    t = t.slice(1);
  } else if (t.startsWith('-')) {
    intensity = 'ligera';
    t = t.slice(1);
  }
  if (t.startsWith('VC')) {
    vicinity = true;
    t = t.slice(2);
  }
  const parts: string[] = [];
  let descriptor: string | null = null;
  const d = t.slice(0, 2);
  if (WX_DESCRIPTORS[d]) {
    descriptor = d;
    t = t.slice(2);
  }
  for (let i = 0; i < t.length; i += 2) {
    const p = WX_PHENOMENA[t.slice(i, i + 2)];
    if (!p) return token;
    parts.push(p);
  }
  if (parts.length === 0 && descriptor !== 'TS') {
    if (descriptor !== 'SH') return token;
    parts.push('');
  }
  let text: string;
  if (descriptor === 'SH' && parts[0] === '') text = 'chubascos';
  else if (descriptor === 'TS') text = parts.length > 0 ? `tormenta con ${parts.join(' y ')}` : 'tormenta';
  else if (descriptor === 'FZ') text = `${parts.join(' y ')} engelante`;
  else if (descriptor && ['MI', 'PR', 'BC'].includes(descriptor)) text = `${parts.join(' y ')} ${WX_DESCRIPTORS[descriptor]}`;
  else if (descriptor) text = `${WX_DESCRIPTORS[descriptor]} ${parts.join(' y ')}`;
  else text = parts.join(' y ');
  if (!text) return token;
  if (intensity) text = `${text} ${intensity}`;
  if (vicinity) text = `${text} en las cercanías`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function describeWeather(wx: string | null): string | null {
  if (!wx?.trim()) return null;
  return wx.trim().split(/\s+/).map(describeToken).join(' · ');
}

export function formatTemperature(temp: number | null, dew: number | null): string {
  if (temp === null) return 'Sin dato';
  return dew === null ? `${temp} °C` : `${temp} °C / rocío ${dew} °C`;
}

/** QNH en hPa e inHg. */
export function formatAltimeter(hpa: number | null): string {
  if (hpa === null) return 'Sin dato';
  return `${Math.round(hpa)} hPa · ${(hpa * 0.0295299830714).toFixed(2)} inHg`;
}

/** Minutos desde la observación. */
export function ageMinutes(iso: string | null, now: number = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 60_000)) : null;
}

export function formatAge(minutes: number | null): string {
  if (minutes === null) return '';
  if (minutes < 1) return 'hace menos de un minuto';
  if (minutes < 60) return `hace ${minutes} min`;
  const h = Math.floor(minutes / 60);
  return `hace ${h} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** Un METAR de más de 90 minutos ya no es vigente. */
export function isOldMetar(minutes: number | null): boolean {
  return minutes !== null && minutes > 90;
}

export function tafChangeLabel(period: Pick<TafPeriod, 'change' | 'probability'>): string {
  switch (period.change) {
    case 'FM':
      return 'Desde';
    case 'BECMG':
      return 'Cambiando';
    case 'TEMPO':
      return period.probability ? `Temporal (${period.probability} %)` : 'Temporal';
    case 'PROB':
      return period.probability ? `Probabilidad ${period.probability} %` : 'Probable';
    default:
      return 'Inicial';
  }
}

/** Hora UTC compacta: "05 01:44Z". */
export function formatZulu(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dd} ${hh}:${mm}Z`;
}
