/**
 * Contrato ACARS v1 entre LAM ACARS Connector y la Edge Function `acars`.
 *
 * Este archivo se copia tal cual a supabase/functions/acars/contract.ts (la
 * Edge Function lo importa con el mapa de importación de Deno). Una prueba
 * verifica que ambas copias sean idénticas. Documentación:
 * docs/integrations/acars-api.md.
 */
import { z } from 'zod';

export const ACARS_API_VERSION = 'v1';

export const FLIGHT_PHASES = [
  'aircraft_connected',
  'preflight',
  'engines_started',
  'pushback',
  'taxi_out',
  'takeoff',
  'initial_climb',
  'climb',
  'cruise',
  'descent',
  'approach',
  'landing',
  'taxi_in',
  'engines_shutdown',
  'flight_completed',
] as const;
export type FlightPhase = (typeof FLIGHT_PHASES)[number];

export const FLIGHT_EVENT_TYPES = [
  'phase_change',
  'block_off',
  'takeoff',
  'touchdown',
  'block_on',
  'engine_start',
  'engine_shutdown',
  'sim_paused',
  'sim_resumed',
  'slew',
  'crash',
  'overspeed',
  'stall',
  'aircraft_changed',
  'connection_lost',
  'connection_restored',
  'note',
] as const;
export type FlightEventType = (typeof FLIGHT_EVENT_TYPES)[number];

const isoTime = z.string().datetime({ offset: true });
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
const altitudeFt = z.number().min(-2000).max(70000);
const phase = z.enum(FLIGHT_PHASES);

// -----------------------------------------------------------------------------
// Vinculación
// -----------------------------------------------------------------------------
export const linkStartRequest = z.object({
  device_name: z.string().trim().min(1).max(60),
  app_version: z.string().trim().max(40),
});
export type LinkStartRequest = z.infer<typeof linkStartRequest>;

export const linkPollRequest = z.object({
  code: z
    .string()
    .transform((v) => v.replace(/[^A-Za-z0-9]/g, '').toUpperCase())
    .pipe(z.string().regex(/^[A-Z2-9]{8}$/)),
  poll_secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export type LinkPollRequest = z.infer<typeof linkPollRequest>;

// -----------------------------------------------------------------------------
// Sesión
// -----------------------------------------------------------------------------
export const sessionStartRequest = z.object({
  flight_id: z.string().uuid(),
  aircraft: z
    .object({
      title: z.string().max(256).nullish(),
      icao: z.string().max(8).nullish(),
      registration: z.string().max(16).nullish(),
    })
    .default({}),
  client_version: z.string().max(40),
});
export type SessionStartRequest = z.infer<typeof sessionStartRequest>;

export const positionSample = z.object({
  sampled_at: isoTime,
  latitude,
  longitude,
  altitude_ft: altitudeFt,
  agl_ft: z.number().min(-100).max(70000).nullish(),
  ias_kt: z.number().min(0).max(1000).nullish(),
  gs_kt: z.number().min(0).max(2000).nullish(),
  heading_deg: z.number().min(0).max(360).nullish(),
  vs_fpm: z.number().min(-20000).max(20000).nullish(),
  on_ground: z.boolean(),
  phase,
  /** Viento: dirección verdadera de donde sopla (°) y velocidad (kt). Conector 0.1.21+. */
  wind_dir_deg: z.number().min(0).max(360).nullish(),
  wind_kt: z.number().min(0).max(400).nullish(),
});
export type PositionSample = z.infer<typeof positionSample>;

export const positionRequest = z.object({
  session_id: z.string().uuid(),
  position: positionSample,
});
export type PositionRequest = z.infer<typeof positionRequest>;

export const trackPoint = positionSample.omit({ agl_ft: true }).extend({
  seq: z.number().int().min(0),
  /** Combustible total a bordo (kg). Opcional: los conectores anteriores a 0.1.16 no lo envían. */
  fuel_kg: z.number().min(0).max(1_000_000).nullish(),
});
export type TrackPoint = z.infer<typeof trackPoint>;

export const trackBatchRequest = z.object({
  session_id: z.string().uuid(),
  points: z.array(trackPoint).min(1).max(600),
});
export type TrackBatchRequest = z.infer<typeof trackBatchRequest>;

export const flightEvent = z.object({
  id: z.string().uuid(),
  seq: z.number().int().min(0),
  type: z.enum(FLIGHT_EVENT_TYPES),
  phase,
  occurred_at: isoTime,
  latitude: latitude.nullish(),
  longitude: longitude.nullish(),
  altitude_ft: altitudeFt.nullish(),
  data: z.record(z.unknown()).default({}),
});
export type FlightEvent = z.infer<typeof flightEvent>;

export const eventsRequest = z.object({
  session_id: z.string().uuid(),
  events: z.array(flightEvent).min(1).max(50),
});
export type EventsRequest = z.infer<typeof eventsRequest>;

export const sessionEndRequest = z.object({
  session_id: z.string().uuid(),
  reason: z.enum(['completed', 'aborted']),
  latitude: latitude.nullish(),
  longitude: longitude.nullish(),
});
export type SessionEndRequest = z.infer<typeof sessionEndRequest>;

// -----------------------------------------------------------------------------
// Errores: el cuerpo siempre es { error: { code, message } }.
// -----------------------------------------------------------------------------
export const ACARS_ERROR_STATUS: Record<string, number> = {
  bad_request: 400,
  batch_too_large: 400,
  clock_skew: 400,
  invalid_token: 401,
  device_revoked: 401,
  account_suspended: 401,
  not_member: 403,
  link_invalid: 404,
  flight_not_found: 404,
  session_not_found: 404,
  not_found: 404,
  link_used: 409,
  link_expired: 409,
  session_closed: 409,
  flight_not_available: 409,
  booking_inactive: 409,
  ofp_required: 409,
  other_session_active: 409,
  rate_limited: 429,
  server_error: 500,
};
