/**
 * Hoja del plan de SimBrief (OFP importado) como la muestra SimBrief: Flight
 * Info, Flight Plan Summary y Load Sheet. La entrega get_live_flight_route.
 */
export interface FlightPlanSheet {
  generated_at: string | null;
  fetched_at: string;
  airline_icao: string | null;
  flight_number: string | null;
  atc_callsign: string | null;
  origin_icao: string;
  destination_icao: string;
  alternate_icao: string | null;
  aircraft_icao: string | null;
  aircraft_name: string | null;
  registration: string | null;
  sched_out_at: string | null;
  sched_in_at: string | null;
  est_enroute_minutes: number | null;
  est_block_minutes: number | null;
  cruise_altitude_ft: number | null;
  cost_index: string | null;
  route_distance_nm: number | null;
  air_distance_nm: number | null;
  avg_wind_dir: number | null;
  avg_wind_kt: number | null;
  avg_wind_comp: number | null;
  avg_isa_dev: number | null;
  airac: string | null;
  release_number: number | null;
  fuel_units: 'kg' | 'lb' | null;
  block_fuel: number | null;
  trip_fuel: number | null;
  reserve_fuel: number | null;
  zfw: number | null;
  tow: number | null;
  ldw: number | null;
  pax_count: number | null;
  cargo: number | null;
  payload: number | null;
  oew: number | null;
  max_zfw: number | null;
  max_tow: number | null;
  max_ldw: number | null;
  pdf_url: string | null;
}

function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

const NUMERIC = [
  'est_enroute_minutes', 'est_block_minutes', 'cruise_altitude_ft', 'route_distance_nm', 'air_distance_nm', 'avg_wind_dir', 'avg_wind_kt',
  'avg_wind_comp', 'avg_isa_dev', 'release_number', 'block_fuel', 'trip_fuel', 'reserve_fuel', 'zfw', 'tow', 'ldw', 'pax_count', 'cargo',
  'payload', 'oew', 'max_zfw', 'max_tow', 'max_ldw',
] as const;

/** Normaliza la hoja que llega de la base (los numeric llegan como texto). */
export function parseFlightPlan(value: unknown): FlightPlanSheet | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.origin_icao !== 'string' || typeof v.destination_icao !== 'string') return null;
  const out = { ...v } as Record<string, unknown>;
  for (const k of NUMERIC) out[k] = numberOrNull(v[k]);
  out.fuel_units = v.fuel_units === 'lb' ? 'lb' : v.fuel_units === 'kg' ? 'kg' : null;
  return out as unknown as FlightPlanSheet;
}

/** Componente de viento como SimBrief: P012 de cola, M009 de cara. */
export function formatWindComponent(kt: number | null): string {
  if (kt === null) return '—';
  return `${kt < 0 ? 'M' : 'P'}${String(Math.abs(Math.round(kt))).padStart(3, '0')}`;
}

/** Desviación ISA como SimBrief: P11, M05. */
export function formatIsaDeviation(c: number | null): string {
  if (c === null) return '—';
  return `${c < 0 ? 'M' : 'P'}${String(Math.abs(Math.round(c))).padStart(2, '0')}`;
}

/** Viento medio 250/43. */
export function formatAvgWind(dir: number | null, kt: number | null): string {
  if (dir === null || kt === null) return '—';
  return `${String(Math.round(dir) % 360).padStart(3, '0')}/${Math.round(kt)}`;
}

/** 01:10 (horas y minutos con dos dígitos). */
export function formatHhMm(minutes: number | null): string {
  if (minutes === null) return '—';
  const m = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 35,000 ft. */
export function formatAltitudeFt(ft: number | null, locale = 'es-MX'): string {
  return ft === null ? '—' : `${new Intl.NumberFormat(locale).format(Math.round(ft))} ft`;
}

/** 7,228 kg. */
export function formatMass(value: number | null, units: 'kg' | 'lb' | null, locale = 'es-MX'): string {
  return value === null ? '—' : `${new Intl.NumberFormat(locale).format(Math.round(value))} ${units ?? 'kg'}`;
}

/** Distancia de la ruta del plan: la de la ruta y, si falta, la distancia aire. */
export function planDistanceNm(plan: Pick<FlightPlanSheet, 'route_distance_nm' | 'air_distance_nm'>): number | null {
  return plan.route_distance_nm ?? plan.air_distance_nm;
}
