import type { AirlineRole, MembershipStatus } from '@lam/shared-types';

/** Número de piloto LAM: LAM + 4 dígitos (LAM1001). */
export function formatPilotNumber(pilotNumber: number): string {
  return `LAM${String(pilotNumber).padStart(4, '0')}`;
}

/** Hora UTC en formato aeronáutico: 14:05:09Z. */
export function formatZulu(date: Date): string {
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}Z`;
}

/** Fecha UTC del día operacional: 2026-10-19. */
export function formatZuluDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const dateFormatter = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' });

export function formatLocalDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

export const roleLabels: Record<AirlineRole, string> = {
  airline_admin: 'Administrador',
  ops_chief: 'Jefe de operaciones',
  pilot: 'Piloto',
};

export const statusLabels: Record<MembershipStatus, string> = {
  pending: 'Solicitud pendiente',
  active: 'Activa',
  suspended: 'Suspendida',
  rejected: 'Rechazada',
};

export function formatRoles(roles: readonly AirlineRole[]): string {
  const order: AirlineRole[] = ['airline_admin', 'ops_chief', 'pilot'];
  return order
    .filter((r) => roles.includes(r))
    .map((r) => roleLabels[r])
    .join(', ');
}

const regionNames = new Intl.DisplayNames(['es'], { type: 'region' });

export function countryName(code: string | null): string {
  if (!code) return 'Sin especificar';
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}
