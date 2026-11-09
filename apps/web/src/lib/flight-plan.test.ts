import { describe, expect, it } from 'vitest';
import { formatAvgWind, formatHhMm, formatIsaDeviation, formatMass, formatWindComponent, parseFlightPlan, planDistanceNm } from './flight-plan';

describe('hoja del plan de SimBrief', () => {
  it('formatea viento, ISA y tiempos como SimBrief', () => {
    expect(formatWindComponent(-9)).toBe('M009');
    expect(formatWindComponent(12)).toBe('P012');
    expect(formatIsaDeviation(11)).toBe('P11');
    expect(formatIsaDeviation(-5)).toBe('M05');
    expect(formatAvgWind(250, 43)).toBe('250/43');
    expect(formatAvgWind(null, 43)).toBe('—');
    expect(formatHhMm(70)).toBe('01:10');
    expect(formatHhMm(98)).toBe('01:38');
    expect(formatMass(7228, 'kg', 'en-US')).toBe('7,228 kg');
  });
  it('normaliza los numeric que llegan como texto', () => {
    const plan = parseFlightPlan({ origin_icao: 'MMMY', destination_icao: 'MMSM', block_fuel: '7228.0', route_distance_nm: null, air_distance_nm: 457, fuel_units: 'kg' });
    expect(plan?.block_fuel).toBe(7228);
    expect(plan && planDistanceNm(plan)).toBe(457);
    expect(parseFlightPlan(null)).toBeNull();
    expect(parseFlightPlan({ origin_icao: 'MMMY' })).toBeNull();
  });
});
