/**
 * Tipos de dominio de LAM Virtual ACARS.
 *
 * El esquema completo se genera en database.generated.ts desde el proyecto
 * Supabase. Aquí solo hay alias legibles y las formas de las respuestas JSON
 * de las funciones RPC.
 */
import type { Database, Enums } from './database.generated';

export type { Database, Json, Tables, TablesInsert, TablesUpdate, Enums } from './database.generated';

export type OrgRole = Enums<'org_role'>;
export type AirlineRole = Enums<'airline_role'>;
export type MembershipStatus = Enums<'membership_status'>;
export type AccountStatus = Enums<'account_status'>;
export type AircraftStatus = Enums<'aircraft_status'>;
export type BookingStatus = Enums<'booking_status'>;
export type FlightStatus = Enums<'flight_status'>;
export type PirepStatus = Enums<'pirep_status'>;

/** Valores permitidos por las restricciones CHECK (la generación los tipa como string). */
export const AIRLINE_NETWORKS = ['IVAO', 'VATSIM', 'OFFLINE'] as const;
export type AirlineNetwork = (typeof AIRLINE_NETWORKS)[number];

export const OPERATION_TYPES = ['passenger', 'cargo', 'mixed'] as const;
export type AirlineOperationType = (typeof OPERATION_TYPES)[number];

export const WAKE_CATEGORIES = ['L', 'M', 'H', 'J'] as const;
export type WakeCategory = (typeof WAKE_CATEGORIES)[number];

export const ENGINE_TYPES = ['jet', 'turboprop', 'piston'] as const;
export type EngineType = (typeof ENGINE_TYPES)[number];

export const AIRPORT_TYPES = ['large_airport', 'medium_airport', 'small_airport', 'heliport', 'seaplane_base', 'other'] as const;
export type AirportType = (typeof AIRPORT_TYPES)[number];

export const AIRCRAFT_STATUSES: readonly AircraftStatus[] = ['available', 'assigned', 'in_flight', 'maintenance', 'out_of_service'];
/** Estados que una persona puede elegir; los demás los pone el sistema. */
export const MANUAL_AIRCRAFT_STATUSES: readonly AircraftStatus[] = ['available', 'maintenance', 'out_of_service'];

/** Respuesta de get_dashboard_summary. */
export interface DashboardSummary {
  scope: 'organization' | 'airline' | 'member';
  airlines_total: number;
  airlines_active: number;
  pilots_active_members: number;
  pending_requests: number;
  profiles_total: number | null;
  bookings_active: number;
  my_bookings_active: number;
  pireps_pending_review: number;
  my_pireps_pending: number;
  my_block_minutes: number;
  my_flights_accepted: number;
  /** Vuelos en curso (Fase 6). */
  live_flights: number;
  airline_block_minutes_30d: number;
  airline_flights_30d: number;
}

// -----------------------------------------------------------------------------
// Fase 6: mapa en vivo, estadísticas y Operations Center (respuestas de RPC)
// -----------------------------------------------------------------------------
export interface LiveAirport {
  icao: string;
  name: string;
  city: string | null;
  latitude: number;
  longitude: number;
}

export interface LivePosition {
  sampled_at: string;
  latitude: number;
  longitude: number;
  altitude_ft: number;
  agl_ft: number | null;
  ias_kt: number | null;
  gs_kt: number | null;
  heading_deg: number | null;
  vs_fpm: number | null;
  on_ground: boolean;
  wind_dir_deg?: number | null;
  wind_kt?: number | null;
}

export type LiveAlertCode =
  | 'connection_lost'
  | 'no_signal'
  | 'paused'
  | 'diversion_risk'
  | 'overdue'
  | 'attitude'
  | 'overspeed'
  | 'stall'
  | 'slew'
  | 'crash';

export interface LiveAlert {
  code: LiveAlertCode;
  level: 'info' | 'warn' | 'danger';
  at?: string;
  value?: number | null;
  axis?: string | null;
}

export interface LiveFlight {
  flight_id: string;
  session_id: string;
  airline: { id: string; icao: string | null; name: string; slug: string; color: string; logo_path: string | null };
  callsign: string;
  flight_number: string;
  network: string;
  pilot: { id: string; name: string; number: number };
  is_mine: boolean;
  aircraft_registration: string;
  aircraft_type: string;
  aircraft_model: string;
  sim_aircraft_title: string | null;
  origin: LiveAirport;
  destination: LiveAirport;
  planned_distance_nm: number;
  planned_minutes: number;
  route_nm: number;
  remaining_nm: number | null;
  started_at: string;
  last_contact_at: string;
  phase: string;
  position: LivePosition | null;
  /** Solo para el staff de la aerolínea; null para los pilotos. */
  alerts: LiveAlert[] | null;
}

/** Punto de la traza en vivo: [lat, lon, altitud ft, fase]. */
export type LiveTrackPoint = [number, number, number, string];

export interface StatsTotals {
  flights: number;
  block_minutes: number;
  flight_minutes?: number;
  distance_nm: number;
  fuel_used_kg?: number;
  average_score: number | null;
  average_landing_vs_fpm?: number | null;
  pilots: number;
  airports?: number;
}

export interface AirlineStatistics {
  airlines: string[];
  months: number;
  totals: StatsTotals;
  last_30_days: StatsTotals;
  monthly: { month: string; flights: number; block_minutes: number; distance_nm: number; average_score: number | null; pilots: number }[];
  top_routes: { origin: string; destination: string; origin_city: string | null; destination_city: string | null; flights: number; block_minutes: number; average_score: number | null }[];
  aircraft_types: { icao: string; model: string; flights: number; block_minutes: number; average_landing_vs_fpm: number | null }[];
  landings: { bucket: string; label: string; flights: number }[];
  ranking: {
    user_id: string;
    name: string;
    number: number;
    country_code: string | null;
    flights: number;
    block_minutes: number;
    distance_nm: number;
    average_score: number | null;
    average_landing_vs_fpm: number | null;
    best_landing_vs_fpm: number | null;
    last_30_days_minutes: number;
    last_flight_at: string;
  }[];
  common_findings: { code: string; label: string; count: number }[];
}

export interface OpsDeparture {
  flight_id: string;
  airline_icao: string;
  callsign: string;
  flight_number: string;
  pilot: { id: string; name: string; number: number };
  origin: string;
  destination: string;
  aircraft_type: string;
  aircraft_registration: string;
  network: string;
  scheduled_departure_at: string | null;
  booked_at: string;
  booking_expires_at: string;
  has_ofp: boolean;
  state: 'late' | 'expiring' | 'on_time';
}

export interface OpsPirepQueueItem {
  id: string;
  callsign: string;
  flight_number: string;
  pilot: { id: string; name: string; number: number };
  origin: string;
  destination: string;
  arrival: string | null;
  diverted: boolean;
  score: number;
  has_critical: boolean;
  critical_labels: string[];
  block_minutes: number;
  landing_vs_fpm: number | null;
  pilot_comment: boolean;
  created_at: string;
}

export interface OpsFleetItem {
  id: string;
  airline_icao: string;
  registration: string;
  fleet_number: string | null;
  aircraft_type: string;
  status: string;
  current_airport: string | null;
  base_airport: string | null;
  away_from_base: boolean;
  total_minutes: number;
  cycles: number;
  last_flight_at: string | null;
  usage: 'flying' | 'booked' | null;
  usage_callsign: string | null;
  usage_pilot: string | null;
}

export interface OperationsOverview {
  airlines: string[];
  departures: OpsDeparture[];
  pirep_queue: OpsPirepQueueItem[];
  fleet: OpsFleetItem[];
  counts: { flights_completed_24h: number; bookings_expired_24h: number; pireps_reviewed_7d: number };
}

export interface PilotPerformance {
  user_id: string;
  name: string;
  number: number;
  airlines: string[];
  member_since: string;
  flights: number;
  accepted: number;
  rejected: number;
  pending: number;
  block_minutes: number;
  average_score: number | null;
  previous_average_score: number | null;
  average_landing_vs_fpm: number | null;
  critical_findings: number;
  top_findings: string[];
  total_block_minutes: number;
  last_flight_at: string | null;
}

/** Fila de entrada de import_routes (CSV convertido). */
export interface RouteImportRow {
  flight_number: string;
  origin: string;
  destination: string;
  aircraft_types: string;
  departure_time_utc?: string;
  days?: string;
  operation_type?: string;
  estimated_minutes?: string;
  active?: string;
}

/** Respuesta de import_routes. */
export interface RouteImportResult {
  total: number;
  valid: number;
  created: number;
  updated: number;
  errors: { row: number; flight_number: string | null; message: string }[];
}

export type PublicFunctions = Database['public']['Functions'];

/** Motivos por los que route_aircraft_options y book_flight bloquean una reserva. */
export const BOOKING_BLOCK_REASONS = [
  'route_inactive',
  'aircraft_other_airline',
  'aircraft_unavailable',
  'type_not_allowed',
  'operation_mismatch',
  'no_rating',
  'not_at_origin',
  'max_bookings',
  'not_member',
  'invalid_callsign',
] as const;
export type BookingBlockReason = (typeof BOOKING_BLOCK_REASONS)[number];

/** Fila de route_aircraft_options. */
export type RouteAircraftOption = Database['public']['Functions']['route_aircraft_options']['Returns'][number];

/** Respuesta de book_flight. */
export interface BookFlightResult {
  booking_id: string;
  flight_id: string;
  expires_at: string;
}

/** Diferencia entre el OFP de SimBrief y el vuelo reservado (calculada por el servidor). */
export interface OfpMismatch {
  field: 'origin' | 'destination' | 'aircraft_type' | 'registration' | 'callsign' | 'generated_at';
  expected: string | null;
  actual: string | null;
  severity: 'high' | 'low';
}

/** Regla que se cumplió en un PIREP (columna pireps.findings). */
export interface PirepFinding {
  code: string;
  label: string;
  penalty: number;
  critical: boolean;
  value: number | null;
  threshold: number | null;
  unit: string | null;
  /** Anulada por el evaluador mientras el PIREP estaba en revisión (no resta puntos). */
  waived?: boolean;
  waived_reason?: string;
  waived_by?: string;
  waived_by_name?: string | null;
  waived_at?: string;
}

/** Datos adicionales del PIREP (columna pireps.metrics). */
export interface PirepMetrics {
  block_estimated?: boolean;
  fuel_block_off_kg?: number;
  fuel_block_on_kg?: number;
  takeoff?: Record<string, number | string | boolean | null>;
  touchdown?: Record<string, number | string | boolean | null>;
  max_taxi_gs_kt?: number;
  max_ias_below_fl100_kt?: number;
  engines_running_at_start?: boolean;
  engine_starts?: number;
  pauses?: number;
  go_arounds?: number;
  sim_aircraft_title?: string;
  sim_aircraft_icao?: string;
  client_version?: string;
  fuel?: PirepFuel;
  /** Excursiones de alabeo y cabeceo (conector 0.1.19+). */
  attitude?: PirepAttitude;
  /** Viento del vuelo (conector 0.1.21+). */
  wind?: PirepWind;
  /** Primer punto de la carrera de despegue en una salida directa (no cuenta como rodaje). */
  takeoff_roll_from_seq?: number;
}

export interface PirepWindAt {
  at: string;
  dir_deg: number;
  kt: number;
  heading_deg?: number | null;
  /** Cabeza (+) o cola (−). */
  headwind_kt?: number | null;
  /** Desde la derecha (+) o la izquierda (−). */
  crosswind_kt?: number | null;
  altitude_ft?: number;
  phase?: string;
}

export interface PirepWind {
  samples: number;
  takeoff?: PirepWindAt;
  touchdown?: PirepWindAt;
  max?: PirepWindAt;
  /** Cizalladura a baja altura: cambio del viento de cabeza de 15 kt o más en 30 s. */
  shear?: { events: number; max_change_kt: number; at: string; phase: string; altitude_ft: number };
}

export interface LandingStatsSummary {
  landings: number;
  average_vs_fpm: number | null;
  median_vs_fpm: number | null;
  best_vs_fpm: number | null;
  worst_vs_fpm: number | null;
  stddev_vs_fpm: number | null;
  average_g: number | null;
  max_g: number | null;
  average_pitch_deg: number | null;
  average_bank_deg: number | null;
  max_bank_deg: number | null;
  average_ias_kt: number | null;
  average_crosswind_kt: number | null;
  max_crosswind_kt: number | null;
  bounce_rate: number | null;
  firm_rate: number | null;
  hard_rate: number | null;
  within_limits_rate: number | null;
  average_score: number | null;
  last_10_average_vs_fpm: number | null;
  previous_10_average_vs_fpm: number | null;
}

export interface LandingRecord {
  id: string;
  at: string;
  callsign: string;
  origin: string;
  arrival: string;
  aircraft_type: string;
  status: string;
  vs_fpm: number;
  g_force: number | null;
  pitch_deg: number | null;
  bank_deg: number | null;
  bounces: number;
  ias_kt: number | null;
  flaps_deg: number | null;
  headwind_kt: number | null;
  crosswind_kt: number | null;
  score: number;
  within_limits: boolean;
  findings: string[];
}

export interface PilotLandingStats {
  user_id: string;
  pilot: { id: string; name: string; number: number } | null;
  summary: LandingStatsSummary;
  buckets: { bucket: string; label: string; flights: number }[];
  recent: LandingRecord[];
}

export interface PirepAttitude {
  excursions: number;
  max_bank_deg?: number;
  max_pitch_up_deg?: number;
  min_pitch_down_deg?: number;
}

export interface PirepFuelStage {
  kg: number;
  minutes: number;
  kg_per_hour?: number;
}

/** Combustible del vuelo (pireps.metrics.fuel), en kg. */
export interface PirepFuel {
  block_off_kg?: number;
  takeoff_kg?: number;
  landing_kg?: number;
  block_on_kg?: number;
  taxi_out_kg?: number;
  trip_kg?: number;
  taxi_in_kg?: number;
  used_kg?: number;
  samples?: number;
  refueled_kg?: number;
  /** Combustible gastado antes del primer arranque de motor (APU, normalmente). */
  before_engines_kg?: number;
  apu?: { minutes: number; starts: number; first_on_at?: string; last_off_at?: string; running_at_start: boolean; running_at_end: boolean };
  stages?: Partial<Record<'taxi_out' | 'climb' | 'cruise' | 'descent' | 'taxi_in', PirepFuelStage>>;
  plan?: { block_kg?: number; trip_kg?: number; reserve_kg?: number; landing_kg?: number; units?: string };
}
