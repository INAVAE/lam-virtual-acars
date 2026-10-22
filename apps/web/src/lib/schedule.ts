/** Días de operación: máscara de bits con lunes = 1 … domingo = 64. */
export const WEEKDAYS = [
  { bit: 1, short: 'L', name: 'Lunes' },
  { bit: 2, short: 'M', name: 'Martes' },
  { bit: 4, short: 'X', name: 'Miércoles' },
  { bit: 8, short: 'J', name: 'Jueves' },
  { bit: 16, short: 'V', name: 'Viernes' },
  { bit: 32, short: 'S', name: 'Sábado' },
  { bit: 64, short: 'D', name: 'Domingo' },
] as const;

export const ALL_DAYS = 127;

/** Texto corto de los días: "Diario", "L X V" … */
export function formatDays(mask: number): string {
  if (mask === ALL_DAYS) return 'Diario';
  return WEEKDAYS.filter((d) => mask & d.bit)
    .map((d) => d.short)
    .join(' ');
}

/** Máscara a dígitos 1-7 (formato del CSV). */
export function maskToDigits(mask: number): string {
  return WEEKDAYS.map((d, i) => (mask & d.bit ? String(i + 1) : '')).join('');
}

/** Minutos a "1 h 05 min". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

/** Minutos acumulados a horas con un decimal: 125 -> "2.1". */
export function formatHours(minutes: number): string {
  return (minutes / 60).toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** "14:30:00" -> "14:30Z" */
export function formatUtcTime(value: string | null): string | null {
  if (!value) return null;
  return `${value.slice(0, 5)}Z`;
}
