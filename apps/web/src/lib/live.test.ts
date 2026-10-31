import type { LivePosition } from '@lam/shared-types';
import { describe, expect, it } from 'vitest';
import { ageSeconds, alertText, eteMinutes, extrapolate, flightProgress, formatAge, greatCirclePoints, worstAlert } from './live';

const T = Date.parse('2026-11-01T12:00:00Z');
const pos = (extra: Partial<LivePosition> = {}): LivePosition => ({
  sampled_at: '2026-11-01T12:00:00Z',
  latitude: 19,
  longitude: -99,
  altitude_ft: 30000,
  agl_ft: 25000,
  ias_kt: 280,
  gs_kt: 360,
  heading_deg: 0,
  vs_fpm: 0,
  on_ground: false,
  ...extra,
});

describe('mapa en vivo', () => {
  it('describe la antigüedad de la lectura', () => {
    expect(ageSeconds('2026-11-01T11:59:20Z', T)).toBe(40);
    expect(formatAge(2)).toBe('ahora');
    expect(formatAge(40)).toBe('hace 40 s');
    expect(formatAge(185)).toBe('hace 3 min');
    expect(formatAge(7300)).toBe('hace 2 h');
  });

  it('calcula avance y tiempo al destino', () => {
    expect(flightProgress({ route_nm: 200, remaining_nm: 50, phase: 'cruise' })).toBe(0.75);
    expect(flightProgress({ route_nm: 200, remaining_nm: 260, phase: 'climb' })).toBe(0);
    expect(flightProgress({ route_nm: 200, remaining_nm: 3, phase: 'taxi_in' })).toBe(1);
    expect(flightProgress({ route_nm: 200, remaining_nm: null, phase: 'preflight' })).toBe(0);
    expect(eteMinutes({ remaining_nm: 120, position: pos() })).toBe(20);
    expect(eteMinutes({ remaining_nm: 120, position: pos({ on_ground: true }) })).toBeNull();
  });

  it('estima la posición entre lecturas, solo en el aire y hasta 30 s', () => {
    // 360 kt al norte durante 10 s = 1 NM = 1/60°.
    const e = extrapolate(pos(), T + 10_000);
    expect(e.estimated).toBe(true);
    expect(e.latitude).toBeCloseTo(19 + 1 / 60, 6);
    expect(e.longitude).toBeCloseTo(-99, 6);
    expect(extrapolate(pos({ on_ground: true }), T + 10_000).estimated).toBe(false);
    expect(extrapolate(pos(), T + 45_000)).toEqual({ latitude: 19, longitude: -99, estimated: false });
    // Al este: la longitud avanza más cerca de los polos.
    const east = extrapolate(pos({ heading_deg: 90, latitude: 60 }), T + 10_000);
    expect(east.longitude).toBeCloseTo(-99 + 1 / 30, 3);
  });

  it('traza el arco de círculo máximo de aeropuerto a aeropuerto', () => {
    const arc = greatCirclePoints(19.4363, -99.0721, 20.5218, -103.3112, 10);
    expect(arc).toHaveLength(11);
    expect(arc[0]![0]).toBeCloseTo(19.4363, 4);
    expect(arc[10]![1]).toBeCloseTo(-103.3112, 4);
    expect(greatCirclePoints(1, 2, 1, 2)).toEqual([[1, 2]]);
  });

  it('describe las alertas y elige la más grave', () => {
    expect(alertText({ code: 'no_signal', level: 'warn', value: 4 })).toBe('Sin señal hace 4 min');
    expect(alertText({ code: 'attitude', level: 'warn', value: -38.4, axis: 'bank' })).toBe('Alabeo 38°');
    expect(alertText({ code: 'attitude', level: 'warn', value: -11, axis: 'pitch_down' })).toBe('Cabeceo −11°');
    expect(alertText({ code: 'diversion_risk', level: 'warn', value: 42 })).toBe('Aproximación a 42 NM del destino');
    expect(worstAlert([{ code: 'paused', level: 'info' }, { code: 'crash', level: 'danger' }, { code: 'no_signal', level: 'warn' }])?.code).toBe('crash');
    expect(worstAlert([])).toBeNull();
  });
});
