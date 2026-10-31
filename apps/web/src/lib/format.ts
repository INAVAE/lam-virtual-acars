import type { AircraftStatus, AirlineOperationType, AirlineRole, MembershipStatus } from '@lam/shared-types';

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

// Zona en la que se muestran las fechas locales: la elige el piloto en Settings
// (TimeProvider la fija al montar la vista). Por omisión, la del navegador.
let displayTimeZone: string | undefined;
const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

export function setDisplayTimeZone(timeZone: string | undefined): void {
  displayTimeZone = timeZone;
}

function zoned(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${displayTimeZone ?? ''}|${JSON.stringify(options)}`;
  let f = zoneFormatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('es-MX', { ...options, timeZone: displayTimeZone });
    zoneFormatters.set(key, f);
  }
  return f;
}

export function formatLocalDate(iso: string): string {
  return zoned({ dateStyle: 'medium' }).format(new Date(iso));
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

export const operationTypeLabels: Record<AirlineOperationType, string> = {
  passenger: 'Pasajeros',
  cargo: 'Carga',
  mixed: 'Pasajeros y carga',
};

/** Etiqueta de un tipo de operación guardado como texto en la base de datos. */
export function operationTypeLabel(value: string): string {
  return operationTypeLabels[value as AirlineOperationType] ?? value;
}

/** Dominio legible de una URL: https://www.taesava.com/ -> taesava.com */
export function displayDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export const aircraftStatusLabels: Record<AircraftStatus, string> = {
  available: 'Disponible',
  assigned: 'Asignada',
  in_flight: 'En vuelo',
  maintenance: 'Mantenimiento virtual',
  out_of_service: 'Fuera de servicio',
};

export const aircraftStatusTone: Record<AircraftStatus, 'ok' | 'info' | 'warn' | 'danger' | 'neutral'> = {
  available: 'ok',
  assigned: 'info',
  in_flight: 'info',
  maintenance: 'warn',
  out_of_service: 'danger',
};

const airportTypeLabels: Record<string, string> = {
  large_airport: 'Grande',
  medium_airport: 'Mediano',
  small_airport: 'Pequeño',
  heliport: 'Helipuerto',
  seaplane_base: 'Hidropuerto',
  other: 'Otro',
};

export function airportTypeLabel(value: string): string {
  return airportTypeLabels[value] ?? value;
}

const engineLabels: Record<string, string> = { jet: 'Reactor', turboprop: 'Turbohélice', piston: 'Pistón' };

export function engineTypeLabel(value: string): string {
  return engineLabels[value] ?? value;
}

const wakeLabels: Record<string, string> = { L: 'Ligera', M: 'Media', H: 'Pesada', J: 'Súper' };

export function wakeCategoryLabel(value: string): string {
  return wakeLabels[value] ?? value;
}

const numberFormat = new Intl.NumberFormat('es-MX');

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

export function formatLocalDateTime(iso: string): string {
  return zoned({ dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}
