import { describe, expect, it } from 'vitest';
import { daysSince, landingBucket, landingTrend, monthLabel, percent, scoreTrend, sortRanking, type RankingRow } from './statistics';

const row = (name: string, extra: Partial<RankingRow>): RankingRow => ({
  user_id: name,
  name,
  number: 1001,
  country_code: 'MX',
  flights: 1,
  block_minutes: 60,
  distance_nm: 100,
  average_score: 90,
  average_landing_vs_fpm: -200,
  best_landing_vs_fpm: -150,
  last_30_days_minutes: 0,
  last_flight_at: '2026-10-01T00:00:00Z',
  ...extra,
});

describe('estadísticas', () => {
  it('nombra los meses en español', () => {
    expect(monthLabel('2026-03')).toBe('mar 26');
    expect(monthLabel('2026-12', false)).toBe('dic');
  });

  it('ordena el ranking; la toma más suave primero', () => {
    const rows = [
      row('Ana', { block_minutes: 300, average_landing_vs_fpm: -320, average_score: 85 }),
      row('Beto', { block_minutes: 500, average_landing_vs_fpm: -120, average_score: null }),
      row('Ceci', { block_minutes: 100, average_landing_vs_fpm: null, average_score: 98 }),
    ];
    expect(sortRanking(rows, 'block_minutes').map((r) => r.name)).toEqual(['Beto', 'Ana', 'Ceci']);
    expect(sortRanking(rows, 'average_landing_vs_fpm').map((r) => r.name)).toEqual(['Beto', 'Ana', 'Ceci']);
    expect(sortRanking(rows, 'average_score').map((r) => r.name)).toEqual(['Ceci', 'Ana', 'Beto']);
  });

  it('marca la tendencia del puntaje con un margen', () => {
    expect(scoreTrend(92, 85)).toBe('up');
    expect(scoreTrend(80, 88)).toBe('down');
    expect(scoreTrend(90, 89)).toBe('flat');
    expect(scoreTrend(90, null)).toBeNull();
  });

  it('cuenta los días desde el último vuelo', () => {
    const now = Date.parse('2026-11-01T12:00:00Z');
    expect(daysSince('2026-10-29T13:00:00Z', now)).toBe(2);
    expect(daysSince(null, now)).toBeNull();
  });
});

describe('estadísticas de aterrizaje', () => {
  it('agrupa por velocidad vertical', () => {
    expect(landingBucket(-50)).toBe('butter');
    expect(landingBucket(-150)).toBe('soft');
    expect(landingBucket(-300)).toBe('firm');
    expect(landingBucket(-599)).toBe('hard');
    expect(landingBucket(-650)).toBe('very_hard');
  });

  it('da formato de porcentaje', () => {
    expect(percent(0.125)).toBe('13 %');
    expect(percent(1)).toBe('100 %');
    expect(percent(null)).toBe('—');
  });

  it('compara las últimas 10 tomas con las 10 anteriores', () => {
    expect(landingTrend(-180, -260)).toBe('better');
    expect(landingTrend(-300, -200)).toBe('worse');
    expect(landingTrend(-205, -210)).toBe('flat');
    expect(landingTrend(-200, null)).toBeNull();
  });
});
