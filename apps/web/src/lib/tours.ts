/**
 * Tours: tipos de lo que devuelven get_tours y get_tour, etiquetas y la regla
 * de qué legs puede reservar el piloto (la misma que valida book_tour_leg).
 */
export type TourStatus = 'draft' | 'submitted' | 'published' | 'closed' | 'rejected';
export type EnrollmentStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'completed';
export type LegState = 'accepted' | 'in_review' | 'booked' | 'repeat' | 'open';

export interface TourAirline {
  id: string;
  name: string;
  icao: string | null;
  slug: string;
  logo_path: string | null;
  color: string;
}

export interface MyEnrollment {
  id: string;
  status: EnrollmentStatus;
  airline_id: string;
  legs_accepted: number;
  legs_flown: number;
}

export interface TourSummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  color: string;
  badge_path: string | null;
  status: TourStatus;
  starts_on: string | null;
  ends_on: string | null;
  ordered_legs: boolean;
  allow_unreviewed_progress: boolean;
  max_unreviewed_legs: number;
  auto_approve_same_airline: boolean;
  aircraft_type_ids: number[];
  aircraft_types: string[];
  review_comment: string | null;
  submitted_at: string | null;
  published_at: string | null;
  airline: TourAirline;
  creator: { id: string; name: string } | null;
  legs_count: number;
  distance_nm: number;
  participants: number;
  finishers: number;
  can_edit: boolean;
  /** Puede modificarlo por completo: superadministrador o administrador de la aerolínea; quien lo propuso, solo en borrador o rechazado. */
  can_modify: boolean;
  can_approve: boolean;
  pending_enrollments: number | null;
  my_enrollment: MyEnrollment | null;
}

export interface TourAirport {
  id: number;
  icao: string;
  name: string;
  city: string | null;
  latitude: number;
  longitude: number;
}

export interface TourLeg {
  id: string;
  leg_number: number;
  distance_nm: number;
  notes: string | null;
  origin: TourAirport;
  destination: TourAirport;
}

export interface MyLeg {
  leg_id: string;
  leg_number: number;
  state: LegState;
  flight_id: string | null;
  pirep_id: string | null;
  pirep_status: string | null;
  attempts: number;
}

export interface TourParticipant {
  enrollment_id: string;
  user_id: string;
  name: string;
  number: number;
  airline_icao: string | null;
  airline_name: string;
  status: EnrollmentStatus;
  auto_approved: boolean;
  created_at: string;
  completed_at: string | null;
  legs_accepted: number;
  legs_flown: number;
}

export interface TourDetail extends TourSummary {
  legs: TourLeg[];
  my_legs: MyLeg[] | null;
  participants_list: TourParticipant[];
}

export interface PilotBadge {
  tour_id: string;
  code: string;
  name: string;
  color: string;
  badge_path: string | null;
  airline_icao: string | null;
  awarded_at: string;
  legs: number;
}

export const tourStatusLabels: Record<TourStatus, string> = {
  draft: 'Borrador',
  submitted: 'Esperando aprobación',
  published: 'Publicado',
  closed: 'Cerrado',
  rejected: 'Rechazado',
};

export const tourStatusTone: Record<TourStatus, 'ok' | 'info' | 'warn' | 'danger' | 'neutral'> = {
  draft: 'neutral',
  submitted: 'warn',
  published: 'ok',
  closed: 'neutral',
  rejected: 'danger',
};

export const enrollmentStatusLabels: Record<EnrollmentStatus, string> = {
  pending: 'Inscripción pendiente',
  approved: 'Inscrito',
  rejected: 'Inscripción rechazada',
  withdrawn: 'Retirado',
  completed: 'Terminado',
};

export const enrollmentStatusTone: Record<EnrollmentStatus, 'ok' | 'info' | 'warn' | 'danger' | 'neutral'> = {
  pending: 'warn',
  approved: 'info',
  rejected: 'danger',
  withdrawn: 'neutral',
  completed: 'ok',
};

export const legStateLabels: Record<LegState, string> = {
  accepted: 'Aceptado',
  in_review: 'En revisión',
  booked: 'Reservado',
  repeat: 'Repetir',
  open: 'Pendiente',
};

export const legStateTone: Record<LegState, 'ok' | 'info' | 'warn' | 'danger' | 'neutral'> = {
  accepted: 'ok',
  in_review: 'info',
  booked: 'info',
  repeat: 'danger',
  open: 'neutral',
};

/** Un leg cuenta como volado con su PIREP aceptado o en revisión. */
export function legFlown(state: LegState): boolean {
  return state === 'accepted' || state === 'in_review';
}

export type LegBlock = 'done' | 'booked' | 'tour_flight_active' | 'out_of_order' | 'previous_unreviewed' | 'too_many_unreviewed' | null;

export const legBlockLabels: Record<Exclude<LegBlock, null>, string> = {
  done: 'Ya volado',
  booked: 'Reservado',
  tour_flight_active: 'Primero termina el vuelo del tour que tienes reservado',
  out_of_order: 'Este tour va en orden: primero el leg anterior',
  previous_unreviewed: 'Espera a que revisen el leg anterior',
  too_many_unreviewed: 'Tienes el máximo de legs en revisión; espera la revisión',
};

type TourRules = Pick<TourSummary, 'ordered_legs' | 'allow_unreviewed_progress' | 'max_unreviewed_legs'>;

/**
 * Por qué no se puede reservar un leg (null si se puede). Es la misma regla que
 * book_tour_leg en la base de datos; la web solo la usa para guiar al piloto.
 */
export function legBlock(rules: TourRules, legs: readonly MyLeg[], legNumber: number): LegBlock {
  const leg = legs.find((l) => l.leg_number === legNumber);
  if (!leg) return null;
  if (legFlown(leg.state)) return 'done';
  if (leg.state === 'booked') return 'booked';
  if (legs.some((l) => l.state === 'booked')) return 'tour_flight_active';
  if (rules.ordered_legs && legs.some((l) => l.leg_number < legNumber && !legFlown(l.state))) return 'out_of_order';
  const unreviewed = legs.filter((l) => l.state === 'in_review').length;
  if (!rules.allow_unreviewed_progress && unreviewed > 0) return 'previous_unreviewed';
  if (rules.allow_unreviewed_progress && unreviewed >= rules.max_unreviewed_legs) return 'too_many_unreviewed';
  return null;
}

/** Avance del piloto: legs aceptados y volados (incluye en revisión) sobre el total. */
export function tourProgress(legs: readonly MyLeg[]): { accepted: number; flown: number; total: number } {
  return {
    accepted: legs.filter((l) => l.state === 'accepted').length,
    flown: legs.filter((l) => legFlown(l.state)).length,
    total: legs.length,
  };
}

/** Código de tour: letras, números y guiones, de 3 a 16. */
export const TOUR_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,15}$/;
export const FLIGHT_NUMBER_PATTERN = /^[0-9]{1,4}[A-Z]?$/;

export function normalizeTourCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '-');
}

/** ¿El tour está vigente hoy? (fechas en formato AAAA-MM-DD, comparadas en UTC). */
export function tourWindow(tour: Pick<TourSummary, 'starts_on' | 'ends_on'>, now: Date = new Date()): 'upcoming' | 'open' | 'ended' {
  const today = now.toISOString().slice(0, 10);
  if (tour.starts_on && tour.starts_on > today) return 'upcoming';
  if (tour.ends_on && tour.ends_on < today) return 'ended';
  return 'open';
}

export const TOUR_COLORS = ['#a855f7', '#ec4899', '#f97316', '#eab308', '#14b8a6', '#3b82f6', '#ef4444', '#22c55e'] as const;
