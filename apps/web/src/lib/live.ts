/**
 * Utilidades del mapa en vivo y del Operations Center: progreso del vuelo,
 * tiempo estimado, posición estimada entre lecturas y textos de las alertas.
 */
import type { LiveAlert, LiveFlight, LivePosition } from '@lam/shared-types';

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

/** Minutos estimados al destino con la velocidad sobre el suelo actual (solo en el aire). */
export function eteMinutes(f: Pick<LiveFlight, 'remaining_nm' | 'position'>): number | null {
  const p = f.position;
  if (!p || p.on_ground || f.remaining_nm === null || !p.gs_kt || p.gs_kt < 60) return null;
  return Math.round((f.remaining_nm / p.gs_kt) * 60);
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
