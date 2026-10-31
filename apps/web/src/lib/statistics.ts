/** Utilidades de la página de estadísticas y del rendimiento de pilotos. */
import type { AirlineStatistics } from '@lam/shared-types';

/** "2026-03" → "mar 26" (mes corto en español, UTC). */
export function monthLabel(month: string, withYear = true): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  const name = new Intl.DateTimeFormat('es-MX', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1))).replace('.', '');
  return withYear ? `${name} ${String(y).slice(2)}` : name;
}

export type RankingRow = AirlineStatistics['ranking'][number];
export type RankingKey = 'block_minutes' | 'flights' | 'distance_nm' | 'average_score' | 'average_landing_vs_fpm' | 'last_30_days_minutes';

/**
 * Ordena el ranking. Más es mejor en todo, salvo la toma promedio: la más
 * suave (más cercana a 0) va primero. Los valores nulos van al final.
 */
export function sortRanking(rows: readonly RankingRow[], key: RankingKey): RankingRow[] {
  return [...rows].sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    if (va === null && vb === null) return a.name.localeCompare(b.name);
    if (va === null) return 1;
    if (vb === null) return -1;
    if (va !== vb) return key === 'average_landing_vs_fpm' ? Math.abs(va) - Math.abs(vb) : vb - va;
    return b.block_minutes - a.block_minutes || a.name.localeCompare(b.name);
  });
}

/** Cambio entre dos puntajes promedio, con un umbral para no marcar ruido como tendencia. */
export function scoreTrend(current: number | null, previous: number | null, threshold = 2): 'up' | 'down' | 'flat' | null {
  if (current === null || previous === null) return null;
  const d = current - previous;
  if (d >= threshold) return 'up';
  if (d <= -threshold) return 'down';
  return 'flat';
}

/** Días desde una fecha ISO (redondeado hacia abajo); null si no hay fecha. */
export function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000));
}

/** Color de cada grupo de aterrizaje: de verde (suave) a rojo (muy duro). */
export const LANDING_COLORS: Record<string, string> = {
  butter: '#22c55e',
  soft: '#84cc16',
  normal: '#38bdf8',
  firm: '#facc15',
  hard: '#f97316',
  very_hard: '#ef4444',
};

/** Grupo de aterrizaje por velocidad vertical (mismos cortes que la base de datos). */
export function landingBucket(vsFpm: number): keyof typeof LANDING_COLORS {
  if (vsFpm > -100) return 'butter';
  if (vsFpm > -200) return 'soft';
  if (vsFpm > -300) return 'normal';
  if (vsFpm > -400) return 'firm';
  if (vsFpm > -600) return 'hard';
  return 'very_hard';
}

/** 0.125 → "13 %"; null → "—". */
export function percent(ratio: number | null | undefined, digits = 0): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)} %`;
}

/**
 * Tendencia de la toma: compara el promedio de las últimas 10 con las 10
 * anteriores. Más cerca de 0 fpm es mejor; menos de 15 fpm de diferencia es estable.
 */
export function landingTrend(last: number | null, previous: number | null, threshold = 15): 'better' | 'worse' | 'flat' | null {
  if (last === null || previous === null) return null;
  const d = Math.abs(previous) - Math.abs(last);
  if (d >= threshold) return 'better';
  if (d <= -threshold) return 'worse';
  return 'flat';
}
