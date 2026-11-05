/**
 * Lógica del centro de ayuda sin React: búsqueda en el manual y contexto que
 * acompaña a un reporte de incidencia.
 */
import type { HelpAudience, HelpChapter } from '@/content/help-content';

/** Navegador y sistema en palabras: el user agent completo es ilegible. */
export function browserLabel(ua: string): string {
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Navegador desconocido';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return [browser, os].filter(Boolean).join(' · ');
}

/** Minúsculas sin acentos, para buscar «habilitacion» y encontrar «habilitación». */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function matches(haystack: string[], words: string[]): boolean {
  const text = fold(haystack.join(' '));
  return words.every((w) => text.includes(w));
}

function queryWords(query: string): string[] {
  return fold(query)
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

/** Capítulos que contienen todas las palabras buscadas (título, resumen, pasos y nota). */
export function searchChapters(chapters: readonly HelpChapter[], query: string): HelpChapter[] {
  const words = queryWords(query);
  if (words.length === 0) return [...chapters];
  return chapters.filter((c) => matches([c.title, c.summary, c.note ?? '', ...c.steps.flat()], words));
}

export function searchPairs<T extends readonly string[]>(rows: readonly T[], query: string): T[] {
  const words = queryWords(query);
  if (words.length === 0) return [...rows];
  return rows.filter((r) => matches([...r], words));
}

/** Para quién se muestra un capítulo según los roles de quien mira. */
export function chapterVisible(audience: HelpAudience, roles: { staff: boolean; admin: boolean; superadmin: boolean }): boolean {
  if (audience === 'super') return roles.superadmin;
  if (audience === 'admin') return roles.admin || roles.superadmin;
  if (audience === 'staff') return roles.staff || roles.admin || roles.superadmin;
  return true;
}

/** Folio relacionado tal como lo escribe la gente: «pirep-2026-6» se deja en mayúsculas y sin espacios de más. */
export function normalizeReference(value: string): string | null {
  const v = value.trim().replace(/\s+/g, ' ').toUpperCase();
  return v ? v.slice(0, 60) : null;
}

export interface TicketContextInput {
  userAgent: string;
  width: number;
  height: number;
  theme: string;
  path: string;
  version: string;
  timeZone: string;
}

/** Lo que se adjunta solo a un reporte. Nada personal: navegador, ventana, tema, pantalla y versión. */
export function ticketContext(input: TicketContextInput): Record<string, string | number> {
  return {
    browser: browserLabel(input.userAgent),
    viewport: `${input.width}×${input.height}`,
    theme: input.theme,
    path: input.path.slice(0, 200),
    version: input.version,
    time_zone: input.timeZone,
  };
}

/** Módulo de la web a partir de la ruta, para proponerlo en el reporte. */
export function moduleForPath(path: string): string | null {
  const first = path.replace(/^\/+/, '').split(/[/?#]/)[0] ?? '';
  const map: Record<string, string> = {
    '': 'Dashboard',
    live: 'Live Flights',
    booking: 'Flight Booking',
    'my-flights': 'My Flights',
    weather: 'Weather',
    pireps: 'PIREP',
    events: 'Events',
    tours: 'Tours',
    pilots: 'Pilots',
    airlines: 'Airlines',
    fleet: 'Fleet',
    routes: 'Routes',
    airports: 'Airports',
    statistics: 'Statistics',
    operations: 'Operations Center',
    administration: 'Administration',
    settings: 'Settings',
  };
  return map[first] ?? null;
}
