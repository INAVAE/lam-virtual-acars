/**
 * Eventos: tipos de get_events y get_event, etiquetas, escenarios y criterios de
 * premio. Las reglas las valida la base de datos; aquí solo se explican.
 */
import { formatNumber } from '@/lib/format';
import { formatMinutes } from '@/lib/pirep';
import type { EnrollmentStatus, TourAirline, TourAirport } from '@/lib/tours';

export type EventStatus = 'draft' | 'submitted' | 'published' | 'cancelled' | 'rejected';
export type EventScenario = 'same_origin_same_destination' | 'any_origin_same_destination' | 'same_origin_any_destination';
export type PrizeCriterion = 'best_score' | 'softest_landing' | 'first_arrival' | 'longest_distance';

export interface MyRegistration {
  id: string;
  status: EnrollmentStatus;
  airline_id: string;
  proposed_airport_id: number | null;
  review_comment: string | null;
  active_flight_id: string | null;
  flights: number;
}

export interface EventSummary {
  id: string;
  folio: string;
  name: string;
  description: string | null;
  scenario: EventScenario;
  starts_at: string;
  ends_at: string;
  color: string;
  status: EventStatus;
  prize_criterion: PrizeCriterion;
  prize_description: string | null;
  prize_places: number;
  review_comment: string | null;
  published_at: string | null;
  aircraft_type_ids: number[];
  aircraft_types: string[];
  airline_ids: string[];
  airlines: { id: string; icao: string | null; name: string }[];
  origin: TourAirport | null;
  destination: TourAirport | null;
  airline: TourAirline;
  creator: { id: string; name: string } | null;
  participants: number;
  can_edit: boolean;
  can_approve: boolean;
  pending_registrations: number | null;
  my_registration: MyRegistration | null;
}

export interface RankingEntry {
  position: number;
  user_id: string;
  name: string;
  number: number;
  airline_icao: string | null;
  pirep_id: string;
  pirep_status: 'accepted' | 'pending';
  callsign: string;
  aircraft_type: string;
  origin: string;
  destination: string;
  score: number;
  landing_vs_fpm: number | null;
  block_on_at: string;
  distance_nm: number;
  block_minutes: number;
}

export interface EventRegistration {
  registration_id: string;
  user_id: string;
  name: string;
  number: number;
  airline_icao: string | null;
  airline_name: string;
  status: EnrollmentStatus;
  notes: string | null;
  proposed_airport: string | null;
  created_at: string;
  flights: number;
}

export interface EventDetail extends EventSummary {
  ranking: RankingEntry[];
  registrations: EventRegistration[];
}

export const eventStatusLabels: Record<EventStatus, string> = {
  draft: 'Borrador',
  submitted: 'Esperando aprobación',
  published: 'Publicado',
  cancelled: 'Cancelado',
  rejected: 'Rechazado',
};

export const eventStatusTone: Record<EventStatus, 'ok' | 'info' | 'warn' | 'danger' | 'neutral'> = {
  draft: 'neutral',
  submitted: 'warn',
  published: 'ok',
  cancelled: 'danger',
  rejected: 'danger',
};

export const scenarioLabels: Record<EventScenario, string> = {
  same_origin_same_destination: 'Mismo origen y mismo destino',
  any_origin_same_destination: 'Cualquier origen hacia un mismo destino',
  same_origin_any_destination: 'Un mismo origen hacia destinos distintos',
};

export const scenarioHints: Record<EventScenario, string> = {
  same_origin_same_destination: 'Todos salen del mismo aeropuerto y llegan al mismo destino.',
  any_origin_same_destination: 'Cada piloto sale de donde quiera; todos llegan al mismo destino (fly-in).',
  same_origin_any_destination: 'Todos salen del mismo aeropuerto hacia el destino que cada uno elija (fly-out).',
};

export const registrationStatusLabels: Record<EnrollmentStatus, string> = {
  pending: 'Registro pendiente',
  approved: 'Registrado',
  rejected: 'Registro rechazado',
  withdrawn: 'Retirado',
  completed: 'Registrado',
};

export const criterionLabels: Record<PrizeCriterion, string> = {
  best_score: 'Mejor puntaje del PIREP',
  softest_landing: 'Aterrizaje más suave',
  first_arrival: 'Primero en llegar',
  longest_distance: 'Mayor distancia volada',
};

/** El piloto elige origen (escenario 2) o destino (escenario 3); en el 1 los fija el evento. */
export function pilotChooses(scenario: EventScenario): 'origin' | 'destination' | null {
  if (scenario === 'any_origin_same_destination') return 'origin';
  if (scenario === 'same_origin_any_destination') return 'destination';
  return null;
}

export type EventTiming = 'upcoming' | 'live' | 'ended';

export function eventTiming(event: Pick<EventSummary, 'starts_at' | 'ends_at'>, now: number = Date.now()): EventTiming {
  if (now < Date.parse(event.starts_at)) return 'upcoming';
  if (now >= Date.parse(event.ends_at)) return 'ended';
  return 'live';
}

/** Las reservas del evento abren 12 horas antes del inicio y cierran al terminar. */
export const BOOKING_OPENS_HOURS = 12;

export function bookingOpen(event: Pick<EventSummary, 'starts_at' | 'ends_at'>, now: number = Date.now()): boolean {
  return now >= Date.parse(event.starts_at) - BOOKING_OPENS_HOURS * 3_600_000 && now < Date.parse(event.ends_at);
}

/** Valor que decide el lugar en el ranking, legible. */
export function criterionValue(entry: RankingEntry, criterion: PrizeCriterion, timeText: (iso: string) => string): string {
  switch (criterion) {
    case 'best_score':
      return `${entry.score} pts`;
    case 'softest_landing':
      return entry.landing_vs_fpm === null ? '—' : `${entry.landing_vs_fpm} fpm`;
    case 'first_arrival':
      return timeText(entry.block_on_at);
    case 'longest_distance':
      return `${formatNumber(entry.distance_nm)} NM`;
  }
}

/** Duración del evento en minutos. */
export function eventMinutes(event: Pick<EventSummary, 'starts_at' | 'ends_at'>): number {
  return Math.round((Date.parse(event.ends_at) - Date.parse(event.starts_at)) / 60_000);
}

export const EVENT_COLORS = ['#f59e0b', '#ef4444', '#ec4899', '#a855f7', '#3b82f6', '#14b8a6', '#22c55e', '#eab308'] as const;

/** Convierte "AAAA-MM-DDTHH:MM" de un input datetime-local (en UTC) a ISO. */
export function utcInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  return `${value}:00Z`;
}

/** Y al revés: ISO a "AAAA-MM-DDTHH:MM" en UTC. */
export function isoToUtcInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 16);
}

export function routeText(e: Pick<EventSummary, 'origin' | 'destination'>): string {
  return `${e.origin?.icao ?? 'Cualquier origen'} → ${e.destination?.icao ?? 'cualquier destino'}`;
}

/** "En curso · termina en 1:20", "Empieza en 2 d 4 h" o "Terminado". */
export function timingText(e: Pick<EventSummary, 'starts_at' | 'ends_at'>, now: number): string {
  const timing = eventTiming(e, now);
  if (timing === 'ended') return 'Terminado';
  if (timing === 'live') return `En curso · termina en ${formatMinutes(Math.round((Date.parse(e.ends_at) - now) / 60_000))}`;
  const minutes = Math.round((Date.parse(e.starts_at) - now) / 60_000);
  if (minutes >= 48 * 60) return `Empieza en ${Math.floor(minutes / 1440)} d ${Math.floor((minutes % 1440) / 60)} h`;
  return `Empieza en ${formatMinutes(minutes)}`;
}
