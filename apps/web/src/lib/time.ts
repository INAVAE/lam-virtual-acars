/**
 * Horas UTC (Zulu) y locales. La operación usa UTC; la hora local del piloto se
 * muestra al lado. Funciones puras: la zona y el orden llegan como parámetros.
 */

export type TimePrimary = 'utc' | 'local';

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Zonas IANA disponibles en el navegador (con respaldo mínimo). */
export function supportedTimeZones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone');
    if (list && list.length > 0) return list.includes('UTC') ? list : ['UTC', ...list];
  } catch {
    // Navegadores sin supportedValuesOf.
  }
  return ['UTC', 'America/Mexico_City', 'America/Cancun', 'America/Tijuana', 'America/Hermosillo', 'America/Mazatlan', 'America/Monterrey', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/Madrid'];
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, f);
  }
  return f;
}

function parts(date: Date, timeZone: string) {
  const out: Record<string, string> = {};
  for (const p of formatter('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)) {
    out[p.type] = p.value;
  }
  return out;
}

/** Abreviatura de la zona en esa fecha: "CST", "EST" o "GMT-6" si no tiene nombre corto. */
export function zoneAbbreviation(timeZone: string, date: Date = new Date()): string {
  if (timeZone === 'UTC') return 'UTC';
  const name = formatter('en-US', { timeZone, timeZoneName: 'short' })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName')?.value;
  return name ?? timeZone;
}

/** "14:05" o "14:05:09" en la zona indicada. */
export function clockTime(date: Date, timeZone: string, seconds = false): string {
  const p = parts(date, timeZone);
  return seconds ? `${p.hour}:${p.minute}:${p.second}` : `${p.hour}:${p.minute}`;
}

const MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

/** "25 OCT 14:30" en la zona indicada. */
export function dayTime(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${p.day} ${MONTHS[Number(p.month) - 1]} ${p.hour}:${p.minute}`;
}

export interface DualTime {
  primary: string;
  secondary: string;
}

/**
 * La misma hora en UTC ("14:05Z") y en la zona local ("08:05 CST"), en el orden
 * elegido por el piloto. Si la zona local es UTC, la secundaria queda vacía.
 */
export function dualTime(
  value: Date | string | number,
  timeZone: string,
  primary: TimePrimary,
  options: { seconds?: boolean; withDate?: boolean } = {},
): DualTime {
  const date = value instanceof Date ? value : new Date(value);
  const body = (tz: string) => (options.withDate ? dayTime(date, tz) : clockTime(date, tz, options.seconds));
  const utc = `${body('UTC')}Z`;
  if (timeZone === 'UTC') return { primary: utc, secondary: '' };
  const local = `${body(timeZone)} ${zoneAbbreviation(timeZone, date)}`;
  return primary === 'utc' ? { primary: utc, secondary: local } : { primary: local, secondary: utc };
}

/** Hora del día UTC de un horario ("14:30:00") convertida a la zona local en la fecha de referencia. */
export function utcTimeOfDay(value: string, timeZone: string, primary: TimePrimary, reference: Date = new Date()): DualTime {
  const [h, m] = value.split(':').map(Number);
  const date = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate(), h ?? 0, m ?? 0));
  return dualTime(date, timeZone, primary);
}

/** Fecha y hora con el formato de la app ("30 oct 2026, 10:05 p.m.") en la zona indicada. */
export function formatDateTimeIn(iso: string, timeZone: string): string {
  return formatter('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(iso));
}

export function formatDateIn(iso: string, timeZone: string): string {
  return formatter('es-MX', { dateStyle: 'medium', timeZone }).format(new Date(iso));
}
