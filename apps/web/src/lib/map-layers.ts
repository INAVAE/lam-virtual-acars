/**
 * Capas del mapa en vivo: ruta del plan de SimBrief, control activo de IVAO y
 * radar de precipitación. Funciones puras (sin Leaflet) para poder probarlas.
 */

// -----------------------------------------------------------------------------
// Ruta del plan (navlog de SimBrief)
// -----------------------------------------------------------------------------
export interface RouteFix {
  ident: string;
  type: string | null;
  lat: number;
  lon: number;
  via?: string | null;
  sid_star?: boolean;
}

export interface FlightRoute {
  fixes: RouteFix[];
  route: string | null;
}

/** Puntos válidos, sin repetir el mismo punto seguido (SimBrief repite el aeropuerto en SID/STAR). */
export function cleanFixes(value: unknown): RouteFix[] {
  if (!Array.isArray(value)) return [];
  const out: RouteFix[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as Partial<RouteFix>;
    if (typeof f.ident !== 'string' || typeof f.lat !== 'number' || typeof f.lon !== 'number') continue;
    if (Math.abs(f.lat) > 90 || Math.abs(f.lon) > 180) continue;
    const prev = out[out.length - 1];
    if (prev && prev.ident === f.ident && prev.lat === f.lat && prev.lon === f.lon) continue;
    out.push({ ident: f.ident, type: f.type ?? null, lat: f.lat, lon: f.lon, via: f.via ?? null, sid_star: Boolean(f.sid_star) });
  }
  return out;
}

/** Puntos que llevan nombre en el mapa: no los de cima de ascenso o descenso ni coordenadas sueltas. */
export function isLabeledFix(f: RouteFix): boolean {
  return f.type !== 'ltlg' && f.ident !== 'TOC' && f.ident !== 'TOD';
}

// -----------------------------------------------------------------------------
// Etiquetas de los aviones
// -----------------------------------------------------------------------------
export type LabelMode = 'full' | 'compact';

/** Con el mapa alejado la etiqueta lleva solo el callsign, para que no se encimen. */
export function labelMode(zoom: number): LabelMode {
  return zoom >= 5 ? 'full' : 'compact';
}

// -----------------------------------------------------------------------------
// Control de IVAO
// -----------------------------------------------------------------------------
export interface IvaoAtc {
  callsign: string;
  position: string | null;
  frequency?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  online_since?: string | null;
  atis?: string[] | null;
  atis_revision?: string | null;
}

export interface IvaoAtcResponse {
  fetched_at: string | null;
  ivao_updated_at: string | null;
  stale: boolean;
  error: string | null;
  atcs: IvaoAtc[];
}

export type AtcFacility = 'DEL' | 'GND' | 'TWR' | 'APP' | 'DEP' | 'CTR' | 'FSS' | 'OTHER';

export const ATC_FACILITIES: readonly AtcFacility[] = ['DEL', 'GND', 'TWR', 'APP', 'DEP', 'CTR', 'FSS'];

export const facilityLabels: Record<AtcFacility, string> = {
  DEL: 'Autorizaciones',
  GND: 'Superficie',
  TWR: 'Torre',
  APP: 'Aproximación',
  DEP: 'Salidas',
  CTR: 'Centro de control',
  FSS: 'Servicio de información de vuelo',
  OTHER: 'Otra posición',
};

/** Colores por tipo de control (inspirados en la convención de los visores de IVAO). */
export const facilityColors: Record<AtcFacility, string> = {
  DEL: '#64748b',
  GND: '#22c55e',
  TWR: '#ef4444',
  APP: '#3b82f6',
  DEP: '#0ea5e9',
  CTR: '#a855f7',
  FSS: '#f59e0b',
  OTHER: '#94a3b8',
};

export function atcFacility(atc: Pick<IvaoAtc, 'callsign' | 'position'>): AtcFacility {
  const p = (atc.position ?? atc.callsign.split('_').pop() ?? '').toUpperCase();
  return (ATC_FACILITIES as readonly string[]).includes(p) ? (p as AtcFacility) : 'OTHER';
}

/** Aeropuerto o FIR del callsign: lo que va antes del primer guion bajo (MMMX_TWR → MMMX). */
export function atcStation(callsign: string): string {
  return callsign.split('_')[0]!.toUpperCase();
}

export interface AtcStation {
  code: string;
  kind: 'airport' | 'center';
  latitude: number | null;
  longitude: number | null;
  facilities: AtcFacility[];
  atcs: IvaoAtc[];
}

const FACILITY_ORDER: Record<AtcFacility, number> = { DEL: 0, GND: 1, TWR: 2, APP: 3, DEP: 4, CTR: 5, FSS: 6, OTHER: 7 };

/**
 * Agrupa los controladores por estación. DEL, GND, TWR, APP y DEP van al aeropuerto
 * de su callsign; CTR y FSS a su FIR. La posición del grupo es la del primer
 * controlador con coordenadas.
 */
export function groupAtcs(atcs: readonly IvaoAtc[]): AtcStation[] {
  const map = new Map<string, AtcStation>();
  for (const atc of atcs) {
    const facility = atcFacility(atc);
    const kind = facility === 'CTR' || facility === 'FSS' ? 'center' : 'airport';
    const code = atcStation(atc.callsign);
    const key = `${kind}:${code}`;
    let s = map.get(key);
    if (!s) {
      s = { code, kind, latitude: null, longitude: null, facilities: [], atcs: [] };
      map.set(key, s);
    }
    s.atcs.push(atc);
    if (!s.facilities.includes(facility)) s.facilities.push(facility);
    if (s.latitude === null && typeof atc.latitude === 'number' && typeof atc.longitude === 'number') {
      s.latitude = atc.latitude;
      s.longitude = atc.longitude;
    }
  }
  return [...map.values()]
    .map((s) => ({
      ...s,
      facilities: [...s.facilities].sort((a, b) => FACILITY_ORDER[a] - FACILITY_ORDER[b]),
      atcs: [...s.atcs].sort((a, b) => FACILITY_ORDER[atcFacility(a)] - FACILITY_ORDER[atcFacility(b)] || a.callsign.localeCompare(b.callsign)),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export interface FirIndex {
  firs: Record<string, [name: string, boundary: string]>;
}

/** FIR del VATSpy Data Project para un código de estación (MMFR → límite MMFR, MMFO → MMZT). */
export function firFor(code: string, index: FirIndex | null | undefined): { name: string; boundary: string } | null {
  const hit = index?.firs[code.toUpperCase()];
  return hit ? { name: hit[0], boundary: hit[1] } : null;
}

/** "128.300" */
export function formatFrequency(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : '—';
}

/** Tiempo en línea: "1 h 12 min". */
export function onlineFor(since: string | null | undefined, now: number): string {
  if (!since) return '—';
  const t = Date.parse(since);
  if (!Number.isFinite(t)) return '—';
  const minutes = Math.max(0, Math.floor((now - t) / 60_000));
  const h = Math.floor(minutes / 60);
  return h > 0 ? `${h} h ${String(minutes % 60).padStart(2, '0')} min` : `${minutes} min`;
}

/**
 * Líneas del ATIS para mostrar: la primera suele ser la dirección del servidor de
 * voz (ts-1.….ivao.aero/…), que no aporta al piloto en el mapa.
 */
export function atisText(lines: readonly string[] | null | undefined): string[] {
  if (!lines) return [];
  return lines.filter((l, i) => !(i === 0 && /^[a-z0-9.-]+\.ivao\.aero\//i.test(l.trim()))).map((l) => l.trim()).filter(Boolean);
}

// -----------------------------------------------------------------------------
// Radar (RainViewer)
// -----------------------------------------------------------------------------
export interface RadarFrame {
  host: string;
  path: string;
  time: number;
}

/** Último cuadro de radar de weather-maps.json de RainViewer. */
export function latestRadarFrame(value: unknown): RadarFrame | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { host?: unknown; radar?: { past?: unknown } };
  if (typeof v.host !== 'string' || !/^https:\/\/[a-z0-9.-]+$/i.test(v.host)) return null;
  const past = Array.isArray(v.radar?.past) ? v.radar.past : [];
  const last = past[past.length - 1] as { path?: unknown; time?: unknown } | undefined;
  if (!last || typeof last.path !== 'string' || !/^\/[A-Za-z0-9/_-]+$/.test(last.path)) return null;
  return { host: v.host, path: last.path, time: typeof last.time === 'number' ? last.time : 0 };
}

/** Teselas de 256 px, esquema de color 2 (Universal Blue, el único gratuito desde 2026), suavizado y nieve aparte. */
export function radarTileUrl(frame: RadarFrame): string {
  return `${frame.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
}

/** RainViewer sirve el radar hasta el zoom 7; más cerca, Leaflet amplía esas teselas. */
export const RADAR_MAX_NATIVE_ZOOM = 7;
