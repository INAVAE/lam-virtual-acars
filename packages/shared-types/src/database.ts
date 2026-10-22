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
