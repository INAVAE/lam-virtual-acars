import { describe, expect, it } from 'vitest';
import { estimatedRouteMinutes, formatTypeUsage, isPendingRoute } from './routes';

describe('rutas', () => {
  it('una ruta sin fecha de activación está pendiente', () => {
    expect(isPendingRoute({ activated_at: null })).toBe(true);
    expect(isPendingRoute({ activated_at: '2026-11-04T00:00:00Z' })).toBe(false);
  });

  it('resume los tipos volados', () => {
    expect(formatTypeUsage(undefined)).toBeNull();
    expect(formatTypeUsage([])).toBeNull();
    expect(
      formatTypeUsage([
        { aircraftTypeId: 1, icao: 'B738', flights: 3, lastFlightAt: '' },
        { aircraftTypeId: 2, icao: 'A20N', flights: 1, lastFlightAt: '' },
      ]),
    ).toBe('B738 ×3 · A20N');
  });

  it('estima la duración como la base de datos', () => {
    expect(estimatedRouteMinutes(0)).toBe(30);
    expect(estimatedRouteMinutes(430)).toBe(90);
    expect(estimatedRouteMinutes(20000)).toBe(1440);
  });
});
