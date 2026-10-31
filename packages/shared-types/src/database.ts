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
  /** Excursiones de alabeo y cabeceo (conector 0.1.18+). */
  attitude?: PirepAttitude;
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
