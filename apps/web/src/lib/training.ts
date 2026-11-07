/** Entrenamientos: etiquetas, conversión de horas por zona, calendario del mes y archivo ICS. */

export type TrainingCategory = 'flight_ops' | 'aircraft' | 'procedures' | 'navigation' | 'atc' | 'weather' | 'theory' | 'safety' | 'simulator' | 'other';
export type TrainingLevel = 'basic' | 'intermediate' | 'advanced';
export type TrainingRegistrationStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';
export type TrainingResult = 'completed' | 'absent';

export const trainingCategories: Record<TrainingCategory, { label: string; color: string }> = {
  flight_ops: { label: 'Operaciones de vuelo', color: '#0ea5e9' },
  aircraft: { label: 'Operación de aeronaves', color: '#22c55e' },
  procedures: { label: 'Procedimientos y SOP', color: '#14b8a6' },
  navigation: { label: 'Navegación', color: '#6366f1' },
  atc: { label: 'Comunicación y ATC', color: '#f59e0b' },
  weather: { label: 'Meteorología', color: '#38bdf8' },
  theory: { label: 'Teoría', color: '#a855f7' },
  safety: { label: 'Seguridad y CRM', color: '#ef4444' },
  simulator: { label: 'Simulador y conector', color: '#eab308' },
  other: { label: 'Otro tema', color: '#94a3b8' },
};

export const trainingLevels: Record<TrainingLevel, string> = {
  basic: 'Básico',
  intermediate: 'Intermedio',
  advanced: 'Avanzado',
};

export const registrationStatus: Record<TrainingRegistrationStatus, { label: string; tone: 'warn' | 'ok' | 'danger' | 'neutral' }> = {
  pending: { label: 'Pendiente de confirmación', tone: 'warn' },
  approved: { label: 'Participación confirmada', tone: 'ok' },
  rejected: { label: 'No aprobada', tone: 'danger' },
  withdrawn: { label: 'Retirada', tone: 'neutral' },
};

export const trainingResults: Record<TrainingResult, { label: string; tone: 'ok' | 'neutral' }> = {
  completed: { label: 'Completó', tone: 'ok' },
  absent: { label: 'No asistió', tone: 'neutral' },
};

export interface TrainingTiming {
  starts_at: string;
  ends_at: string;
  status: 'scheduled' | 'cancelled';
}

/** «upcoming», «live», «ended» o «cancelled». */
export function trainingPhase(t: TrainingTiming, now: number): 'upcoming' | 'live' | 'ended' | 'cancelled' {
  if (t.status === 'cancelled') return 'cancelled';
  if (now < Date.parse(t.starts_at)) return 'upcoming';
  if (now < Date.parse(t.ends_at)) return 'live';
  return 'ended';
}

// -----------------------------------------------------------------------------
// Zonas horarias: el formulario captura en UTC o en la zona del piloto
// -----------------------------------------------------------------------------
interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function wallParts(date: Date, timeZone: string): WallParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const get = (type: string) => Number(fmt.formatToParts(date).find((p) => p.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute') };
}

/** Diferencia en minutos entre la hora de la zona y UTC en ese instante. */
function offsetMinutes(date: Date, timeZone: string): number {
  const p = wallParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(date.getTime() / 60_000) * 60_000) / 60_000);
}

const INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** "AAAA-MM-DDTHH:MM" (input datetime-local) leído en la zona indicada → ISO UTC. */
export function zonedInputToIso(value: string, timeZone: string): string | null {
  const m = INPUT.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  if (timeZone === 'UTC') return new Date(guess).toISOString();
  // Dos pasadas para acertar en los cambios de horario.
  let ts = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  ts = guess - offsetMinutes(new Date(ts), timeZone) * 60_000;
  return new Date(ts).toISOString();
}

/** ISO → "AAAA-MM-DDTHH:MM" en la zona indicada (para el input datetime-local). */
export function isoToZonedInput(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const p = wallParts(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** "AAAA-MM-DD" del instante en la zona indicada (el día del calendario donde cae). */
export function dateKeyIn(iso: string | Date, timeZone: string): string {
  const p = wallParts(iso instanceof Date ? iso : new Date(iso), timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

// -----------------------------------------------------------------------------
// Calendario del mes (semanas de lunes a domingo)
// -----------------------------------------------------------------------------
export interface CalendarDay {
  key: string;
  day: number;
  inMonth: boolean;
}

export function monthGrid(year: number, month: number): CalendarDay[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const start = Date.UTC(year, month - 1, 1 - offset);
  const days: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start + i * 86_400_000);
    days.push({
      key: d.toISOString().slice(0, 10),
      day: d.getUTCDate(),
      inMonth: d.getUTCMonth() === month - 1,
    });
  }
  const weeks: CalendarDay[][] = [];
  for (let w = 0; w < 6; w++) weeks.push(days.slice(w * 7, w * 7 + 7));
  // Sin la sexta semana si quedó toda fuera del mes.
  return weeks[5]!.every((d) => !d.inMonth) ? weeks.slice(0, 5) : weeks;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

// -----------------------------------------------------------------------------
// Calendario externo: archivo ICS y enlace de Google Calendar
// -----------------------------------------------------------------------------
export interface CalendarTraining {
  id: string;
  folio: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  status: 'scheduled' | 'cancelled';
  discord_url: string | null;
  discord_channel: string | null;
  instructor: { display_name: string | null } | null;
}

function icsDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Las líneas de un ICS no deben pasar de 75 octetos; se continúan con un espacio. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length === 0 ? 75 : 74)) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join('\r\n ');
}

function calendarDetails(t: CalendarTraining, pageUrl: string): string {
  return [
    t.description ?? '',
    t.instructor?.display_name ? `Instructor: ${t.instructor.display_name}` : '',
    t.discord_url ? `Discord${t.discord_channel ? ` (${t.discord_channel})` : ''}: ${t.discord_url}` : '',
    `LAM Virtual ACARS: ${pageUrl}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildTrainingIcs(t: CalendarTraining, pageUrl: string, now: Date = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LAM Virtual ACARS//Training//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${t.folio.toLowerCase()}-${t.id}@lam-virtual-acars`,
    `DTSTAMP:${icsDate(now.toISOString())}`,
    `DTSTART:${icsDate(t.starts_at)}`,
    `DTEND:${icsDate(t.ends_at)}`,
    `SUMMARY:${icsText(`${t.folio} · ${t.title}`)}`,
    `DESCRIPTION:${icsText(calendarDetails(t, pageUrl))}`,
    t.discord_url ? `LOCATION:${icsText(t.discord_url)}` : '',
    `URL:${pageUrl}`,
    `STATUS:${t.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsText(t.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function googleCalendarUrl(t: CalendarTraining, pageUrl: string): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${t.folio} · ${t.title}`,
    dates: `${icsDate(t.starts_at)}/${icsDate(t.ends_at)}`,
    details: calendarDetails(t, pageUrl),
  });
  if (t.discord_url) params.set('location', t.discord_url);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function downloadIcs(t: CalendarTraining, pageUrl: string): void {
  const blob = new Blob([buildTrainingIcs(t, pageUrl)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${t.folio}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Enlace de Discord válido (https://discord.gg/… o https://discord.com/…). */
export function isDiscordUrl(value: string): boolean {
  return /^https:\/\/(www\.)?(discord\.com|discord\.gg|discordapp\.com)\/[A-Za-z0-9/_-]+$/.test(value.trim());
}
