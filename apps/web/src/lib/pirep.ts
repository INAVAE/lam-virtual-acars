import type { PirepFinding, PirepMetrics, PirepStatus } from '@lam/shared-types';
import { formatNumber } from './format';

export const pirepStatusLabels: Record<PirepStatus, string> = {
  pending: 'En revisión',
  accepted: 'Aceptado',
  rejected: 'Rechazado',
  archived: 'Archivado',
};

export const pirepStatusTone: Record<PirepStatus, 'ok' | 'warn' | 'danger' | 'neutral'> = {
  pending: 'warn',
  accepted: 'ok',
  rejected: 'danger',
  archived: 'neutral',
};

/** Tono del puntaje: 90+ verde, 75+ normal, menos de 75 aviso, menos de 50 peligro. */
export function scoreTone(score: number): 'ok' | 'neutral' | 'warn' | 'danger' {
  if (score >= 90) return 'ok';
  if (score >= 75) return 'neutral';
  if (score >= 50) return 'warn';
  return 'danger';
}

/** Calificación de la toma por velocidad vertical (valor negativo hacia abajo). */
export function landingRating(vsFpm: number | null | undefined): { label: string; tone: 'ok' | 'neutral' | 'warn' | 'danger' } | null {
  if (vsFpm === null || vsFpm === undefined) return null;
  const v = Math.abs(vsFpm);
  if (v < 60) return { label: 'Muy suave (revisar flotación)', tone: 'neutral' };
  if (v <= 250) return { label: 'Suave', tone: 'ok' };
  if (v <= 400) return { label: 'Normal', tone: 'neutral' };
  if (v <= 600) return { label: 'Firme', tone: 'warn' };
  return { label: 'Duro', tone: 'danger' };
}

export function formatVs(vsFpm: number | null | undefined): string {
  if (vsFpm === null || vsFpm === undefined) return '—';
  return `${vsFpm > 0 ? '+' : vsFpm < 0 ? '−' : ''}${formatNumber(Math.abs(Math.round(vsFpm)))} fpm`;
}

export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** Horas totales con un decimal, como en una bitácora: 12.5 h. */
export function formatHours(minutes: number | null | undefined): string {
  if (!minutes) return '0.0 h';
  return `${(minutes / 60).toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} h`;
}

function formatValue(value: number, unit: string | null): string {
  if (unit === 'fpm') return formatVs(value);
  if (unit === 'G') return `${value.toFixed(2)} G`;
  if (unit === '°') return `${value < 0 ? '−' : ''}${Math.abs(value).toFixed(1)}°`;
  if (unit === 'kt') return `${Math.round(value)} kt`;
  if (unit === 'kg') return `${formatNumber(Math.round(value))} kg`;
  return formatNumber(value);
}

/** Texto de una falta: "−700 fpm (umbral 600 fpm)" o "2 veces". */
export function findingDetail(f: PirepFinding): string | null {
  if (f.code === 'attitude_upset') return 'Alabeo de más de 45°, cabeceo de más de +25° o de menos de −10°';
  if (f.value === null || f.value === undefined) return null;
  if (f.threshold !== null && f.threshold !== undefined && f.unit) {
    // El umbral de nariz abajo se guarda positivo; se muestra con su signo.
    const limit = f.code === 'pitch_down_excess' ? -f.threshold : f.threshold;
    const threshold = f.unit === 'fpm' ? `${formatNumber(limit)} fpm` : formatValue(limit, f.unit);
    return `${formatValue(f.value, f.unit)} (umbral ${threshold})`;
  }
  if (f.unit) return formatValue(f.value, f.unit);
  if (f.code === 'landing_bounce') return f.value === 1 ? '1 rebote' : `${f.value} rebotes`;
  return f.value === 1 ? '1 vez' : `${formatNumber(f.value)} veces`;
}

function isFinding(x: unknown): x is PirepFinding {
  return Boolean(x) && typeof x === 'object' && typeof (x as PirepFinding).code === 'string' && typeof (x as PirepFinding).penalty === 'number';
}

export function parseFindings(value: unknown): PirepFinding[] {
  return Array.isArray(value) ? value.filter(isFinding) : [];
}

export function parseMetrics(value: unknown): PirepMetrics {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as PirepMetrics) : {};
}

export function metricNumber(record: Record<string, unknown> | undefined, key: string): number | null {
  const v = record?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// -----------------------------------------------------------------------------
// Dibujo de la traza
// -----------------------------------------------------------------------------
export interface TrackSample {
  latitude: number;
  longitude: number;
  altitude_ft: number;
  sampled_at: string;
}

export interface Projected {
  path: string;
  start: [number, number] | null;
  end: [number, number] | null;
}

/**
 * Proyecta la traza a un lienzo (equirectangular corregida por latitud media),
 * conservando la proporción y con margen. Devuelve el trazo SVG.
 */
export function projectTrack(points: readonly TrackSample[], width: number, height: number, padding = 16): Projected {
  if (points.length === 0) return { path: '', start: null, end: null };
  const midLat = points.reduce((sum, p) => sum + p.latitude, 0) / points.length;
  const k = Math.cos((midLat * Math.PI) / 180) || 1;
  const xs = points.map((p) => p.longitude * k);
  const ys = points.map((p) => p.latitude);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  const coords = points.map((_, i): [number, number] => [
    Math.round((offX + (xs[i]! - minX) * scale) * 10) / 10,
    Math.round((height - offY - (ys[i]! - minY) * scale) * 10) / 10,
  ]);
  return {
    path: coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' '),
    start: coords[0] ?? null,
    end: coords[coords.length - 1] ?? null,
  };
}

/** Perfil de altitud: tiempo en el eje X, altitud en el eje Y (0 abajo). */
export function altitudeProfile(points: readonly TrackSample[], width: number, height: number, padding = 8): { line: string; area: string; maxFt: number } {
  if (points.length < 2) return { line: '', area: '', maxFt: 0 };
  const t0 = Date.parse(points[0]!.sampled_at);
  const t1 = Date.parse(points[points.length - 1]!.sampled_at);
  const span = Math.max(t1 - t0, 1);
  const maxFt = Math.max(...points.map((p) => p.altitude_ft), 1000);
  const top = Math.ceil(maxFt / 5000) * 5000;
  const coords = points.map((p): [number, number] => [
    Math.round((padding + ((Date.parse(p.sampled_at) - t0) / span) * (width - padding * 2)) * 10) / 10,
    Math.round((height - padding - (Math.max(p.altitude_ft, 0) / top) * (height - padding * 2)) * 10) / 10,
  ]);
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
  const base = height - padding;
  const area = `${line} L${coords[coords.length - 1]![0]} ${base} L${coords[0]![0]} ${base} Z`;
  return { line, area, maxFt: top };
}
