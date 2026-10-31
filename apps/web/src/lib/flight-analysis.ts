/**
 * Análisis de la traza de un vuelo para el mapa y las gráficas del PIREP:
 * colores por fase y por altitud, tramos continuos, distancia acumulada,
 * búsqueda del punto más cercano y marcadores de eventos.
 */

export interface AnalysisPoint {
  seq: number;
  sampled_at: string;
  latitude: number;
  longitude: number;
  altitude_ft: number;
  gs_kt: number | null;
  ias_kt: number | null;
  vs_fpm: number | null;
  heading_deg: number | null;
  on_ground: boolean;
  phase: string;
  /** Combustible a bordo (kg); nulo en vuelos registrados antes del conector 0.1.16. */
  fuel_kg?: number | null;
}

export interface AnalysisEvent {
  id: string;
  seq: number;
  type: string;
  phase: string;
  occurred_at: string;
  latitude?: number | null;
  longitude?: number | null;
  altitude_ft: number | null;
  data: unknown;
}

// -----------------------------------------------------------------------------
// Colores
// -----------------------------------------------------------------------------
export type PhaseGroup = 'ground' | 'takeoff' | 'initial_climb' | 'climb' | 'cruise' | 'descent' | 'approach' | 'landing';

/** Etapas del vuelo agrupadas para el color. Los tonos se distinguen en fondo claro y oscuro. */
export const PHASE_GROUPS: Record<PhaseGroup, { label: string; color: string }> = {
  ground: { label: 'Tierra y rodaje', color: '#94a3b8' },
  takeoff: { label: 'Despegue', color: '#f97316' },
  initial_climb: { label: 'Ascenso inicial', color: '#facc15' },
  climb: { label: 'Ascenso', color: '#22c55e' },
  cruise: { label: 'Crucero', color: '#38bdf8' },
  descent: { label: 'Descenso', color: '#a78bfa' },
  approach: { label: 'Aproximación', color: '#f472b6' },
  landing: { label: 'Aterrizaje', color: '#ef4444' },
};

export function phaseGroup(phase: string): PhaseGroup {
  switch (phase) {
    case 'takeoff':
    case 'initial_climb':
    case 'climb':
    case 'cruise':
    case 'descent':
    case 'approach':
    case 'landing':
      return phase;
    default:
      return 'ground';
  }
}

export function phaseColor(phase: string): string {
  return PHASE_GROUPS[phaseGroup(phase)].color;
}

/** Bandas de altitud (pies MSL) al estilo de los visores de red: más alto, más frío. */
export const ALTITUDE_BANDS: { upTo: number; label: string; color: string }[] = [
  { upTo: 2000, label: '< 2,000 ft', color: '#ef4444' },
  { upTo: 5000, label: '2,000–5,000', color: '#f97316' },
  { upTo: 10000, label: '5,000–10,000', color: '#facc15' },
  { upTo: 18000, label: '10,000–FL180', color: '#22c55e' },
  { upTo: 28000, label: 'FL180–FL280', color: '#2dd4bf' },
  { upTo: 36000, label: 'FL280–FL360', color: '#38bdf8' },
  { upTo: Infinity, label: '> FL360', color: '#a78bfa' },
];

export function altitudeBand(altitudeFt: number): number {
  const i = ALTITUDE_BANDS.findIndex((b) => altitudeFt < b.upTo);
  return i === -1 ? ALTITUDE_BANDS.length - 1 : i;
}

export type ColorMode = 'phase' | 'altitude';

export function pointColor(point: AnalysisPoint, mode: ColorMode): string {
  return mode === 'phase' ? phaseColor(point.phase) : ALTITUDE_BANDS[altitudeBand(point.altitude_ft)]!.color;
}

// -----------------------------------------------------------------------------
// Tramos
// -----------------------------------------------------------------------------
export interface Segment {
  key: string;
  color: string;
  /** Índices (en la traza completa) del primer y último punto del tramo, incluido el de unión con el siguiente. */
  from: number;
  to: number;
}

/**
 * Divide la traza en tramos consecutivos con el mismo color. Cada tramo incluye
 * el primer punto del siguiente para que la línea no tenga huecos.
 */
export function segmentsBy(points: readonly AnalysisPoint[], mode: ColorMode): Segment[] {
  const out: Segment[] = [];
  const keyOf = (p: AnalysisPoint) => (mode === 'phase' ? phaseGroup(p.phase) : String(altitudeBand(p.altitude_ft)));
  let start = 0;
  for (let i = 1; i <= points.length; i++) {
    if (i === points.length || keyOf(points[i]!) !== keyOf(points[start]!)) {
      out.push({ key: keyOf(points[start]!), color: pointColor(points[start]!, mode), from: start, to: Math.min(i, points.length - 1) });
      start = i;
    }
  }
  return points.length === 0 ? [] : out;
}

export interface PhaseSpan {
  group: PhaseGroup;
  start: number;
  end: number;
}

/** Intervalos de tiempo (ms) de cada grupo de fase, para pintar el fondo de las gráficas. */
export function phaseSpans(points: readonly AnalysisPoint[]): PhaseSpan[] {
  return segmentsBy(points, 'phase').map((s) => ({
    group: s.key as PhaseGroup,
    start: Date.parse(points[s.from]!.sampled_at),
    end: Date.parse(points[s.to]!.sampled_at),
  }));
}

// -----------------------------------------------------------------------------
// Medidas
// -----------------------------------------------------------------------------
export function greatCircleNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Distancia recorrida (NM) hasta cada punto. */
export function cumulativeDistance(points: readonly AnalysisPoint[]): number[] {
  const out: number[] = [];
  let total = 0;
  points.forEach((p, i) => {
    if (i > 0) {
      const q = points[i - 1]!;
      total += greatCircleNm(q.latitude, q.longitude, p.latitude, p.longitude);
    }
    out.push(total);
  });
  return out;
}

/** Índice del punto más cercano en el tiempo (búsqueda binaria; la traza está ordenada). */
export function nearestIndexByTime(times: readonly number[], t: number): number {
  if (times.length === 0) return -1;
  let lo = 0;
  let hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= t) lo = mid;
    else hi = mid;
  }
  return Math.abs(times[lo]! - t) <= Math.abs(times[hi]! - t) ? lo : hi;
}

/** Índice del punto más cercano a una posición, opcionalmente dentro de un rango de índices. */
export function nearestIndexByPosition(points: readonly AnalysisPoint[], lat: number, lon: number, from = 0, to = points.length - 1): number {
  const k = Math.cos((lat * Math.PI) / 180);
  let best = -1;
  let bestD = Infinity;
  for (let i = Math.max(0, from); i <= Math.min(to, points.length - 1); i++) {
    const p = points[i]!;
    const d = (p.latitude - lat) ** 2 + ((p.longitude - lon) * k) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export interface FlightExtremes {
  maxAltitude: { value: number; index: number } | null;
  maxIas: { value: number; index: number } | null;
  maxGs: { value: number; index: number } | null;
  maxClimb: { value: number; index: number } | null;
  maxDescent: { value: number; index: number } | null;
}

export function flightExtremes(points: readonly AnalysisPoint[]): FlightExtremes {
  const pick = (value: (p: AnalysisPoint) => number | null, better: (a: number, b: number) => boolean) => {
    let best: { value: number; index: number } | null = null;
    for (let index = 0; index < points.length; index++) {
      const v = value(points[index]!);
      if (v !== null && Number.isFinite(v) && (best === null || better(v, best.value))) best = { value: v, index };
    }
    return best;
  };
  return {
    maxAltitude: pick((p) => p.altitude_ft, (a, b) => a > b),
    maxIas: pick((p) => p.ias_kt, (a, b) => a > b),
    maxGs: pick((p) => p.gs_kt, (a, b) => a > b),
    maxClimb: pick((p) => (p.on_ground ? null : p.vs_fpm), (a, b) => a > b),
    maxDescent: pick((p) => (p.on_ground ? null : p.vs_fpm), (a, b) => a < b),
  };
}

// -----------------------------------------------------------------------------
// Eventos que se marcan en el mapa y en las gráficas
// -----------------------------------------------------------------------------
export interface EventMarker {
  id: string;
  time: number;
  kind: 'block_off' | 'takeoff' | 'touchdown' | 'block_on' | 'engine' | 'pause' | 'warning' | 'go_around';
  label: string;
  detail: string | null;
  /** Letra o símbolo corto que se dibuja en el marcador. */
  glyph: string;
  color: string;
  latitude: number | null;
  longitude: number | null;
}

function num(data: Record<string, unknown>, key: string): number | null {
  const v = data[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const WARNING_LABELS: Record<string, string> = { overspeed: 'Sobrevelocidad', stall: 'Pérdida', slew: 'Slew', crash: 'Choque' };
const GO_AROUND_LABELS: Record<string, string> = { go_around: 'Motor y al aire', touch_and_go: 'Toque y despegue', rejected_takeoff: 'Despegue abortado' };

export function eventMarkers(events: readonly AnalysisEvent[]): EventMarker[] {
  const out: EventMarker[] = [];
  for (const e of events) {
    const d = (e.data && typeof e.data === 'object' ? e.data : {}) as Record<string, unknown>;
    const base = { id: e.id, time: Date.parse(e.occurred_at), latitude: e.latitude ?? null, longitude: e.longitude ?? null };
    switch (e.type) {
      case 'block_off':
        out.push({ ...base, kind: 'block_off', label: 'Calzos fuera', detail: num(d, 'fuel_kg') !== null ? `${num(d, 'fuel_kg')} kg` : null, glyph: 'B', color: '#94a3b8' });
        break;
      case 'takeoff': {
        const parts = [num(d, 'ias_kt') !== null ? `${num(d, 'ias_kt')} kt` : '', num(d, 'pitch_deg') !== null ? `cabeceo ${num(d, 'pitch_deg')}°` : '', num(d, 'flaps_deg') !== null ? `flaps ${num(d, 'flaps_deg')}°` : ''];
        out.push({ ...base, kind: 'takeoff', label: 'Despegue', detail: parts.filter(Boolean).join(' · ') || null, glyph: '↗', color: '#f97316' });
        break;
      }
      case 'touchdown': {
        const vs = num(d, 'vs_fpm');
        const parts = [vs !== null ? `${Math.round(vs)} fpm` : '', num(d, 'g_force') !== null ? `${num(d, 'g_force')} G` : '', num(d, 'flaps_deg') !== null ? `flaps ${num(d, 'flaps_deg')}°` : ''];
        out.push({ ...base, kind: 'touchdown', label: 'Contacto con pista', detail: parts.filter(Boolean).join(' · ') || null, glyph: '↘', color: '#ef4444' });
        break;
      }
      case 'block_on':
        out.push({ ...base, kind: 'block_on', label: 'Calzos puestos', detail: num(d, 'fuel_kg') !== null ? `${num(d, 'fuel_kg')} kg` : null, glyph: 'B', color: '#94a3b8' });
        break;
      case 'engine_start':
      case 'engine_shutdown':
        out.push({
          ...base,
          kind: 'engine',
          label: e.type === 'engine_start' ? 'Motor encendido' : 'Motor apagado',
          detail: num(d, 'running') !== null ? `${num(d, 'running')} de ${num(d, 'count') ?? '?'} encendidos` : null,
          glyph: 'M',
          color: '#64748b',
        });
        break;
      case 'sim_paused':
        out.push({ ...base, kind: 'pause', label: 'Pausa', detail: null, glyph: 'P', color: '#eab308' });
        break;
      case 'overspeed':
      case 'stall':
      case 'slew':
      case 'crash':
        out.push({
          ...base,
          kind: 'warning',
          label: WARNING_LABELS[e.type] ?? e.type,
          detail: num(d, 'ias_kt') !== null ? `${num(d, 'ias_kt')} kt` : null,
          glyph: '!',
          color: '#dc2626',
        });
        break;
      case 'phase_change':
        if (d.reason === 'go_around' || d.reason === 'touch_and_go' || d.reason === 'rejected_takeoff') {
          const label = GO_AROUND_LABELS[String(d.reason)] ?? 'Motor y al aire';
          out.push({ ...base, kind: 'go_around', label, detail: null, glyph: 'G', color: '#f59e0b' });
        }
        break;
      default:
        break;
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// Combustible
// -----------------------------------------------------------------------------
export interface FuelSeries {
  values: (number | null)[];
  /** true si la curva se interpoló entre los eventos (vuelos sin combustible en la traza). */
  approximate: boolean;
}

/** Niveles de combustible conocidos en los eventos (calzos, despegue, contacto, calzos puestos). */
export function fuelAnchors(events: readonly AnalysisEvent[]): { time: number; kg: number }[] {
  const out: { time: number; kg: number }[] = [];
  for (const e of events) {
    if (!['block_off', 'takeoff', 'touchdown', 'block_on'].includes(e.type)) continue;
    const d = (e.data && typeof e.data === 'object' ? e.data : {}) as Record<string, unknown>;
    const kg = num(d, 'fuel_kg');
    if (kg !== null) out.push({ time: Date.parse(e.occurred_at), kg });
  }
  return out.sort((a, b) => a.time - b.time);
}

/**
 * Combustible en cada punto: el de la traza si existe; si no, interpolado entre
 * los eventos que lo llevan (solo dentro de su intervalo).
 */
export function fuelSeries(points: readonly AnalysisPoint[], times: readonly number[], events: readonly AnalysisEvent[]): FuelSeries {
  if (points.some((p) => p.fuel_kg !== null && p.fuel_kg !== undefined)) {
    return { values: points.map((p) => (p.fuel_kg === undefined ? null : p.fuel_kg)), approximate: false };
  }
  const anchors = fuelAnchors(events);
  if (anchors.length < 2) return { values: points.map(() => null), approximate: true };
  const values = times.map((t) => {
    if (t < anchors[0]!.time || t > anchors[anchors.length - 1]!.time) return null;
    let i = 0;
    while (i < anchors.length - 2 && anchors[i + 1]!.time < t) i++;
    const a = anchors[i]!;
    const b = anchors[i + 1]!;
    const f = b.time === a.time ? 0 : (t - a.time) / (b.time - a.time);
    return Math.round(a.kg + (b.kg - a.kg) * Math.min(1, Math.max(0, f)));
  });
  return { values, approximate: true };
}

/** Consumo (kg/h) alrededor del punto i, promediado en una ventana de tiempo. */
export function fuelFlowAt(values: readonly (number | null)[], times: readonly number[], i: number, windowMs = 120_000): number | null {
  const t = times[i];
  if (t === undefined || values[i] === null || values[i] === undefined) return null;
  let a = i;
  let b = i;
  while (a > 0 && t - times[a - 1]! <= windowMs / 2 && values[a - 1] !== null) a--;
  while (b < times.length - 1 && times[b + 1]! - t <= windowMs / 2 && values[b + 1] !== null) b++;
  if (a === b) {
    if (i > 0 && values[i - 1] !== null) a = i - 1;
    else if (i < times.length - 1 && values[i + 1] !== null) b = i + 1;
    else return null;
  }
  const hours = (times[b]! - times[a]!) / 3_600_000;
  if (hours <= 0) return null;
  const burn = (values[a]! - values[b]!) / hours;
  return burn < 0 ? null : Math.round(burn);
}

// -----------------------------------------------------------------------------
// Ejes y formato
// -----------------------------------------------------------------------------
/** Marcas "redondas" para un eje de 0 a max. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1000) / 1000);
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

/** Tiempo transcurrido: "T+1:05". */
export function formatElapsed(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  return `T+${Math.floor(totalMin / 60)}:${String(totalMin % 60).padStart(2, '0')}`;
}

export function formatZuluTime(time: number | string): string {
  return `${new Date(time).toISOString().slice(11, 19)}Z`;
}

export function formatLatLon(lat: number, lon: number): string {
  const f = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(4)}°${v >= 0 ? pos : neg}`;
  return `${f(lat, 'N', 'S')} ${f(lon, 'E', 'W')}`;
}
