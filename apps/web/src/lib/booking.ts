import type { BookingBlockReason, BookingStatus, FlightStatus, OfpMismatch } from '@lam/shared-types';

/** Motivo (código de la base de datos) por el que una aeronave no se puede reservar. */
export const blockReasonLabels: Record<BookingBlockReason, string> = {
  route_inactive: 'Ruta inactiva',
  aircraft_other_airline: 'De otra aerolínea',
  aircraft_unavailable: 'No disponible',
  type_not_allowed: 'Tipo no permitido en la ruta',
  operation_mismatch: 'No apta para esta operación',
  no_rating: 'Sin habilitación de tipo',
  not_at_origin: 'No está en el origen',
  max_bookings: 'Máximo de reservas alcanzado',
  not_member: 'No eres miembro activo',
  invalid_callsign: 'Callsign inválido',
};

export function blockReasonLabel(reason: string | null): string | null {
  if (!reason) return null;
  return blockReasonLabels[reason as BookingBlockReason] ?? 'No disponible';
}

export const flightStatusLabels: Record<FlightStatus, string> = {
  scheduled: 'Reservado',
  in_progress: 'En vuelo',
  completed: 'Completado',
  cancelled: 'Cancelado',
};

export const flightStatusTone: Record<FlightStatus, 'ok' | 'info' | 'warn' | 'danger' | 'neutral'> = {
  scheduled: 'info',
  in_progress: 'ok',
  completed: 'ok',
  cancelled: 'neutral',
};

export const bookingStatusLabels: Record<BookingStatus, string> = {
  active: 'Activa',
  completed: 'Volada',
  cancelled: 'Cancelada',
  expired: 'Vencida',
};

export const mismatchLabels: Record<OfpMismatch['field'], string> = {
  origin: 'Origen',
  destination: 'Destino',
  aircraft_type: 'Tipo de aeronave',
  registration: 'Matrícula',
  callsign: 'Callsign',
  generated_at: 'Antigüedad del plan',
};

/** Lee mismatches (jsonb) de forma segura. */
export function parseMismatches(value: unknown): OfpMismatch[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (m): m is OfpMismatch =>
      Boolean(m) && typeof m === 'object' && typeof (m as OfpMismatch).field === 'string' && (m as OfpMismatch).field in mismatchLabels,
  );
}

/** Callsign como lo acepta la base: 3 a 10 letras o números, sin espacios. */
export function normalizeCallsign(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

export const CALLSIGN_PATTERN = /^[A-Z0-9]{3,10}$/;

/** Tiempo restante legible: "5 h 20 min", "12 min" o "vencida". */
export function formatTimeLeft(expiresAt: string, now: Date = new Date()): string {
  const ms = new Date(expiresAt).getTime() - now.getTime();
  if (ms <= 0) return 'vencida';
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, '0')} min`;
  return `${Math.max(1, minutes)} min`;
}

/** Fecha y hora UTC compacta: "25 OCT 14:30Z". */
export function formatZuluDateTime(iso: string): string {
  const d = new Date(iso);
  const months = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${day} ${months[d.getUTCMonth()]} ${hh}:${mm}Z`;
}

export interface DispatchParams {
  airlineIcao: string;
  flightNumber: string;
  callsign: string;
  aircraftIcao: string;
  registration: string;
  origin: string;
  destination: string;
  remarks?: string | null;
  departure?: string | null;
}

/** Enlace a SimBrief Dispatch con los datos del vuelo ya llenos. */
export function simbriefDispatchUrl(p: DispatchParams): string {
  const params = new URLSearchParams({
    airline: p.airlineIcao,
    fltnum: p.flightNumber,
    callsign: p.callsign,
    type: p.aircraftIcao,
    reg: p.registration,
    orig: p.origin,
    dest: p.destination,
  });
  if (p.remarks) params.set('manualrmk', p.remarks);
  if (p.departure) {
    const d = new Date(p.departure);
    params.set('deph', String(d.getUTCHours()));
    params.set('depm', String(d.getUTCMinutes()));
  }
  return `https://dispatch.simbrief.com/options/custom?${params.toString()}`;
}
