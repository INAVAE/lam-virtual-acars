/**
 * Utilidades del mapa en vivo y del Operations Center: progreso del vuelo,
 * tiempo estimado, posición estimada entre lecturas y textos de las alertas.
 */
import type { LiveAlert, LiveFlight, LivePosition } from '@lam/shared-types';
import type { AnalysisEvent, AnalysisPoint } from './flight-analysis';

/** Segundos desde una fecha ISO hasta `now` (ms). */
export function ageSeconds(iso: string, now: number): number {
  return Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
}

/** "ahora", "hace 25 s", "hace 3 min", "hace 2 h". */
export function formatAge(seconds: number): string {
  if (seconds < 5) return 'ahora';
  if (seconds < 60) return `hace ${seconds} s`;
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)} min`;
  return `hace ${Math.floor(seconds / 3600)} h`;
}

/** Avance (0–1) por distancia directa: 1 − restante / ruta. */
export function flightProgress(f: Pick<LiveFlight, 'route_nm' | 'remaining_nm' | 'phase'>): number {
  if (['taxi_in', 'engines_shutdown', 'flight_completed'].includes(f.phase)) return 1;
  if (f.remaining_nm === null || f.route_nm <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - f.remaining_nm / f.route_nm));
}

/**
 * Minutos estimados al destino (solo en el aire). Con la velocidad sobre el suelo
 * actual hasta 100 NM del destino; después el avión desacelera para el descenso
 * y la aproximación, así que esos tramos se calculan como máximo a 300 kt
 * (100–30 NM) y 220 kt (últimas 30 NM; ajustado con el QTR783 a SVMI). Sin eso, a pocas millas el tiempo salía
 * corto porque usaba la velocidad de crucero hasta la pista.
 */
export function eteMinutes(f: Pick<LiveFlight, 'remaining_nm' | 'position'>): number | null {
  const p = f.position;
  if (!p || p.on_ground || f.remaining_nm === null || !p.gs_kt || p.gs_kt < 60) return null;
  const gs = p.gs_kt;
  const d = Math.max(0, f.remaining_nm);
  const final = Math.min(d, 30);
  const middle = Math.min(Math.max(d - 30, 0), 70);
  const cruise = Math.max(d - 100, 0);
  const hours = cruise / gs + middle / Math.min(gs, 300) + final / Math.min(gs, 220);
  return Math.round(hours * 60);
}

// -----------------------------------------------------------------------------
// Distancia por la ruta del plan de SimBrief
// -----------------------------------------------------------------------------
const EARTH_NM = 3440.065;
const RAD = Math.PI / 180;

function angularDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const dp = p2 - p1;
  const dl = (lon2 - lon1) * RAD;
  return 2 * Math.asin(Math.min(1, Math.sqrt(Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2)));
}

function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const dl = (lon2 - lon1) * RAD;
  return Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl));
}

export interface RoutePoint {
  lat: number;
  lon: number;
}

export interface RouteProgress {
  /** NM que faltan siguiendo la ruta del plan. */
  remainingNm: number;
  /** Largo total de la ruta del plan. */
  totalNm: number;
  /** Distancia del avión a la ruta. */
  offRouteNm: number;
}

/**
 * Lo que falta volar siguiendo la ruta del plan (SID, aerovías, STAR y
 * aproximación), no en línea recta: el avión se proyecta sobre el tramo más
 * cercano y se suman los tramos que siguen. Así no se acorta el número cuando la
 * ruta pasa junto al destino y luego se aleja para la aproximación.
 *
 * Si dos tramos quedan a la misma distancia (la ruta de ida y la de vuelta de una
 * aproximación), gana el que va en el sentido del rumbo del avión. Sin ruta o con
 * el avión a más de 100 NM de ella (desvío), devuelve null y se usa la línea recta.
 */
export function routeProgress(
  fixes: readonly RoutePoint[] | null | undefined,
  lat: number,
  lon: number,
  headingDeg: number | null,
): RouteProgress | null {
  if (!fixes || fixes.length < 2) return null;
  const cumulative: number[] = [0];
  for (let i = 1; i < fixes.length; i++) {
    const a = fixes[i - 1]!;
    const b = fixes[i]!;
    cumulative.push(cumulative[i - 1]! + angularDistance(a.lat, a.lon, b.lat, b.lon) * EARTH_NM);
  }
  const total = cumulative[cumulative.length - 1]!;
  const heading = headingDeg === null ? null : headingDeg * RAD;

  let best: { score: number; along: number; distance: number } | null = null;
  for (let i = 0; i < fixes.length - 1; i++) {
    const a = fixes[i]!;
    const b = fixes[i + 1]!;
    const segment = cumulative[i + 1]! - cumulative[i]!;
    const d13 = angularDistance(a.lat, a.lon, lat, lon);
    const t13 = bearing(a.lat, a.lon, lat, lon);
    const t12 = bearing(a.lat, a.lon, b.lat, b.lon);
    let along: number;
    let distance: number;
    if (segment < 0.01) {
      along = 0;
      distance = d13 * EARTH_NM;
    } else {
      const xt = Math.asin(Math.max(-1, Math.min(1, Math.sin(d13) * Math.sin(t13 - t12))));
      const at = Math.cos(t13 - t12) < 0 ? 0 : Math.acos(Math.max(-1, Math.min(1, Math.cos(d13) / Math.max(Math.cos(xt), 1e-9)))) * EARTH_NM;
      if (at <= 0) {
        along = 0;
        distance = d13 * EARTH_NM;
      } else if (at >= segment) {
        along = segment;
        distance = angularDistance(b.lat, b.lon, lat, lon) * EARTH_NM;
      } else {
        along = at;
        distance = Math.abs(xt) * EARTH_NM;
      }
    }
    // Tramo en sentido contrario al rumbo: solo gana si está claramente más cerca.
    let score = distance;
    if (heading !== null && segment >= 0.5) {
      const diff = Math.abs(Math.atan2(Math.sin(heading - t12), Math.cos(heading - t12)));
      if (diff > Math.PI / 2) score += 15;
    }
    if (!best || score < best.score - 1e-6) best = { score, along: cumulative[i]! + along, distance };
  }
  if (!best || best.distance > 100) return null;
  return { remainingNm: Math.max(0, total - best.along), totalNm: total, offRouteNm: best.distance };
}

/**
 * El vuelo con distancia restante y total por la ruta del plan, si la hay; así el
 * avance, el tiempo al destino y la llegada estimada salen de la ruta real.
 */
/** Fases en tierra antes de despegar: aún falta toda la ruta. */
export const BEFORE_TAKEOFF_PHASES: ReadonlySet<string> = new Set(['aircraft_connected', 'preflight', 'engines_started', 'pushback', 'taxi_out']);

/** Largo total de la ruta del plan, o null sin ruta. */
export function routeLengthNm(fixes: readonly RoutePoint[] | null | undefined): number | null {
  if (!fixes || fixes.length < 2) return null;
  let total = 0;
  for (let i = 1; i < fixes.length; i++) total += angularDistance(fixes[i - 1]!.lat, fixes[i - 1]!.lon, fixes[i]!.lat, fixes[i]!.lon) * EARTH_NM;
  return total;
}

export function withRouteProgress(f: LiveFlight, fixes: readonly RoutePoint[] | null | undefined): LiveFlight & { route_based?: boolean } {
  const p = f.position;
  if (p?.on_ground && BEFORE_TAKEOFF_PHASES.has(f.phase)) {
    // En tierra antes de despegar: falta toda la ruta del plan.
    const total = routeLengthNm(fixes);
    return total === null ? f : { ...f, remaining_nm: Math.round(total), route_nm: Math.round(total), route_based: true };
  }
  if (!p || p.on_ground) return f;
  const progress = routeProgress(fixes, p.latitude, p.longitude, p.heading_deg);
  if (!progress) return f;
  return { ...f, remaining_nm: Math.round(progress.remainingNm), route_nm: Math.round(progress.totalNm), route_based: true };
}

/** Lectura de 2 minutos o más: el conector dejó de enviar. */
export const STALE_SECONDS = 120;

/**
 * Posición estimada `now` a partir de la última lectura (rumbo y velocidad
 * sobre el suelo). Solo se estima en el aire y hasta 30 s después de la
 * lectura; después se queda en el último punto conocido.
 */
export function extrapolate(p: LivePosition, now: number): { latitude: number; longitude: number; estimated: boolean } {
  const dt = (now - Date.parse(p.sampled_at)) / 1000;
  if (p.on_ground || !p.gs_kt || p.gs_kt < 40 || p.heading_deg === null || dt <= 0 || dt > 30) {
    return { latitude: p.latitude, longitude: p.longitude, estimated: false };
  }
  const nm = (p.gs_kt * dt) / 3600;
  const hdg = (p.heading_deg * Math.PI) / 180;
  const latitude = p.latitude + (nm * Math.cos(hdg)) / 60;
  const cosLat = Math.max(0.01, Math.cos((p.latitude * Math.PI) / 180));
  const longitude = p.longitude + (nm * Math.sin(hdg)) / (60 * cosLat);
  return { latitude, longitude, estimated: true };
}

/**
 * Puntos intermedios del arco de círculo máximo entre dos aeropuertos, para
 * dibujar la ruta directa en el mapa.
 */
export function greatCirclePoints(lat1: number, lon1: number, lat2: number, lon2: number, segments = 48): [number, number][] {
  const r = Math.PI / 180;
  const p1 = lat1 * r;
  const l1 = lon1 * r;
  const p2 = lat2 * r;
  const l2 = lon2 * r;
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (d === 0) return [[lat1, lon1]];
  const out: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const a = Math.sin((1 - f) * d) / Math.sin(d);
    const b = Math.sin(f * d) / Math.sin(d);
    const x = a * Math.cos(p1) * Math.cos(l1) + b * Math.cos(p2) * Math.cos(l2);
    const y = a * Math.cos(p1) * Math.sin(l1) + b * Math.cos(p2) * Math.sin(l2);
    const z = a * Math.sin(p1) + b * Math.sin(p2);
    out.push([Math.atan2(z, Math.sqrt(x * x + y * y)) / r, Math.atan2(y, x) / r]);
  }
  return out;
}

const ALERT_TEXT: Record<LiveAlert['code'], (a: LiveAlert) => string> = {
  connection_lost: (a) => `Conexión perdida (${a.value ?? '?'} min)`,
  no_signal: (a) => `Sin señal hace ${a.value ?? '?'} min`,
  paused: (a) => `En pausa${a.value ? ` ${a.value} min` : ''}`,
  diversion_risk: (a) => `Aproximación a ${a.value ?? '?'} NM del destino`,
  overdue: (a) => `${a.value ?? '?'} min en curso: más de lo previsto`,
  attitude: (a) =>
    a.axis === 'bank'
      ? `Alabeo ${Math.abs(Number(a.value ?? 0)).toFixed(0)}°`
      : `Cabeceo ${Number(a.value ?? 0) > 0 ? '+' : '−'}${Math.abs(Number(a.value ?? 0)).toFixed(0)}°`,
  overspeed: (a) => `Sobrevelocidad${a.value ? ` (${a.value} kt)` : ''}`,
  stall: () => 'Pérdida',
  slew: () => 'Slew',
  crash: () => 'Choque',
};

export function alertText(a: LiveAlert): string {
  return (ALERT_TEXT[a.code] ?? (() => a.code))(a);
}

export function alertTone(a: LiveAlert): 'info' | 'warn' | 'danger' {
  return a.level;
}

/** Alerta más grave de un vuelo (para ordenar y colorear). */
export function worstAlert(alerts: readonly LiveAlert[] | null | undefined): LiveAlert | null {
  if (!alerts || alerts.length === 0) return null;
  const rank = { danger: 3, warn: 2, info: 1 } as const;
  return [...alerts].sort((a, b) => rank[b.level] - rank[a.level])[0] ?? null;
}

// -----------------------------------------------------------------------------
// Traza de los vuelos elegidos (get_live_flight_trace, por partes)
// -----------------------------------------------------------------------------
export interface LiveTrace {
  points: AnalysisPoint[];
  events: AnalysisEvent[];
  lastSeq: number;
  lastEventSeq: number;
  /** false cuando el vuelo ya no está en curso. */
  active: boolean;
}

/** Punto compacto: [seq, ms, lat, lon, alt, gs, ias, vs, rumbo, en tierra, fase, viento dir, viento kt, combustible]. */
export type CompactTracePoint = [number, number, number, number, number, number | null, number | null, number | null, number | null, number, string, number | null, number | null, number | null];

export interface TraceResponse {
  active: boolean;
  points: CompactTracePoint[];
  events: AnalysisEvent[];
}

export function tracePoint(p: CompactTracePoint): AnalysisPoint {
  return {
    seq: p[0],
    sampled_at: new Date(p[1]).toISOString(),
    latitude: p[2],
    longitude: p[3],
    altitude_ft: p[4],
    gs_kt: p[5],
    ias_kt: p[6],
    vs_fpm: p[7],
    heading_deg: p[8],
    on_ground: p[9] === 1,
    phase: p[10],
    wind_dir_deg: p[11],
    wind_kt: p[12],
    fuel_kg: p[13],
  };
}

/** Agrega a la traza guardada los puntos y eventos nuevos (sin duplicados, en orden). */
export function mergeTrace(prev: LiveTrace | undefined, res: TraceResponse | null | undefined): LiveTrace {
  const base: LiveTrace = prev ?? { points: [], events: [], lastSeq: -1, lastEventSeq: -1, active: true };
  if (!res) return base;
  if (!res.active) return { ...base, active: false };
  const fresh = (res.points ?? []).map(tracePoint).filter((p) => p.seq > base.lastSeq);
  const events = (res.events ?? []).filter((e) => e.seq > base.lastEventSeq);
  if (fresh.length === 0 && events.length === 0) return base.active ? base : { ...base, active: true };
  const points = [...base.points, ...fresh].sort((a, b) => a.seq - b.seq);
  const allEvents = [...base.events, ...events].sort((a, b) => a.seq - b.seq);
  return {
    points,
    events: allEvents,
    lastSeq: points.length ? points[points.length - 1]!.seq : base.lastSeq,
    lastEventSeq: allEvents.length ? allEvents[allEvents.length - 1]!.seq : base.lastEventSeq,
    active: true,
  };
}

/** Fases en las que el vuelo ya llegó: no se dibuja la ruta faltante. */
export const ARRIVED_PHASES = new Set(['landing', 'taxi_in', 'engines_shutdown', 'flight_completed']);

/** Máximo de vuelos elegidos a la vez en el mapa. */
export const MAX_SELECTED = 10;

/** Agrega o quita un vuelo de la selección (el más reciente al final; respeta el máximo). */
export function toggleSelection(ids: readonly string[], id: string, max = MAX_SELECTED): string[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  const next = [...ids, id];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** "a,b,c" → ids válidos y sin repetir. */
export function parseSelection(value: string | null | undefined, max = MAX_SELECTED): string[] {
  if (!value) return [];
  const out: string[] = [];
  for (const raw of value.split(',')) {
    const id = raw.trim();
    if (/^[0-9a-f-]{36}$/i.test(id) && !out.includes(id)) out.push(id);
  }
  return out.slice(-max);
}
