import { describe, expect, it } from 'vitest';
import { formatNumber } from './format';
import { bookingOpen, criterionValue, eventMinutes, eventTiming, isoToUtcInput, pilotChooses, utcInputToIso, type RankingEntry } from './events';

const ev = { starts_at: '2026-11-10T18:00:00Z', ends_at: '2026-11-10T22:00:00Z' };
const at = (iso: string) => Date.parse(iso);

describe('eventos', () => {
  it('sabe qué aeropuerto elige el piloto en cada escenario', () => {
    expect(pilotChooses('same_origin_same_destination')).toBeNull();
    expect(pilotChooses('any_origin_same_destination')).toBe('origin');
    expect(pilotChooses('same_origin_any_destination')).toBe('destination');
  });

  it('distingue próximo, en curso y terminado', () => {
    expect(eventTiming(ev, at('2026-11-10T17:59:00Z'))).toBe('upcoming');
    expect(eventTiming(ev, at('2026-11-10T18:00:00Z'))).toBe('live');
    expect(eventTiming(ev, at('2026-11-10T22:00:00Z'))).toBe('ended');
    expect(eventMinutes(ev)).toBe(240);
  });

  it('abre reservas 12 horas antes y las cierra al terminar', () => {
    expect(bookingOpen(ev, at('2026-11-10T05:59:00Z'))).toBe(false);
    expect(bookingOpen(ev, at('2026-11-10T06:00:00Z'))).toBe(true);
    expect(bookingOpen(ev, at('2026-11-10T21:59:00Z'))).toBe(true);
    expect(bookingOpen(ev, at('2026-11-10T22:00:00Z'))).toBe(false);
  });

  it('muestra el valor del criterio del premio', () => {
    const entry = { score: 92, landing_vs_fpm: -118, distance_nm: 1250, block_on_at: '2026-11-10T19:41:00Z' } as RankingEntry;
    expect(criterionValue(entry, 'best_score', String)).toBe('92 pts');
    expect(criterionValue(entry, 'softest_landing', String)).toBe('-118 fpm');
    expect(criterionValue(entry, 'first_arrival', (s) => s.slice(11, 16))).toBe('19:41');
    expect(criterionValue(entry, 'longest_distance', String)).toBe(`${formatNumber(1250)} NM`);
  });

  it('convierte la hora UTC del formulario', () => {
    expect(utcInputToIso('2026-11-10T18:00')).toBe('2026-11-10T18:00:00Z');
    expect(utcInputToIso('mal')).toBeNull();
    expect(isoToUtcInput('2026-11-10T18:00:00Z')).toBe('2026-11-10T18:00');
  });
});
