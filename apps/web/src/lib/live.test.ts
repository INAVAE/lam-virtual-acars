import type { LivePosition } from '@lam/shared-types';
import { describe, expect, it } from 'vitest';
import { ageSeconds, alertText, eteMinutes, extrapolate, flightProgress, formatAge, greatCirclePoints, mergeTrace, parseSelection, routeProgress, toggleSelection, worstAlert, type CompactTracePoint } from './live';

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
    // 20 NM a 360 kt, 70 NM a 280 kt y las últimas 30 NM a 180 kt.
    expect(eteMinutes({ remaining_nm: 120, position: pos() })).toBe(28);
    expect(eteMinutes({ remaining_nm: 600, position: pos() })).toBe(108);
    expect(eteMinutes({ remaining_nm: 10, position: pos({ gs_kt: 150 }) })).toBe(4);
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

describe('traza y selección en el mapa en vivo', () => {
  const cp = (seq: number, phase = 'cruise'): CompactTracePoint => [seq, Date.parse('2026-11-01T12:00:00Z') + seq * 1000, 19 + seq / 100, -99, 30000, 450, 280, 0, 90, 0, phase, 270, 40, 5000 - seq];
  const ev = (seq: number) => ({ id: `e${seq}`, seq, type: 'takeoff', phase: 'initial_climb', occurred_at: '2026-11-01T12:00:00Z', altitude_ft: 0, data: {} });

  it('agrega los puntos nuevos sin duplicar', () => {
    const a = mergeTrace(undefined, { active: true, points: [cp(0), cp(1, 'climb')], events: [ev(0)] });
    expect(a.points).toHaveLength(2);
    expect(a.points[1]).toMatchObject({ seq: 1, phase: 'climb', wind_kt: 40, on_ground: false });
    expect(a.lastSeq).toBe(1);
    const b = mergeTrace(a, { active: true, points: [cp(1), cp(2)], events: [ev(0), ev(3)] });
    expect(b.points.map((p) => p.seq)).toEqual([0, 1, 2]);
    expect(b.events.map((e) => e.seq)).toEqual([0, 3]);
    expect(mergeTrace(b, { active: true, points: [], events: [] })).toBe(b);
    expect(mergeTrace(b, { active: false, points: [], events: [] }).active).toBe(false);
  });

  it('agrega y quita vuelos de la selección', () => {
    expect(toggleSelection(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleSelection(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggleSelection(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd']);
  });

  it('lee la selección de la URL', () => {
    const id1 = '00000000-0000-4000-8000-000000001500';
    const id2 = '00000000-0000-4000-8000-000000001501';
    expect(parseSelection(`${id1},${id2},${id1},basura`)).toEqual([id1, id2]);
    expect(parseSelection(null)).toEqual([]);
  });

  it('mide lo que falta por la ruta del plan, no en línea recta', () => {
    // Ruta que pasa al norte del destino y regresa para la aproximación (como SVMI).
    const fixes = [
      { lat: 11.0, lon: -66.0 },
      { lat: 11.0, lon: -67.0 },
      { lat: 10.8, lon: -67.3 },
      { lat: 10.6, lon: -67.0 },
    ];
    // Avión sobre el primer tramo, a 0.5° del inicio, volando al oeste (270°).
    const r = routeProgress(fixes, 11.0, -66.5, 270)!;
    expect(Math.round(r.offRouteNm)).toBe(0);
    const total = r.totalNm;
    expect(total).toBeGreaterThan(80);
    // Falta medio primer tramo (~29 NM) más los otros dos.
    expect(Math.round(total - r.remainingNm)).toBe(29);
    // La línea recta al destino sería mucho menor que lo que falta por la ruta.
    expect(r.remainingNm).toBeGreaterThan(70);
    // Al avanzar sobre la ruta, lo que falta siempre baja.
    const later = routeProgress(fixes, 10.8, -67.25, 225)!;
    expect(later.remainingNm).toBeLessThan(r.remainingNm);
    // Sin ruta o lejos de ella: no hay dato y se usa la línea recta.
    expect(routeProgress([], 11, -66, 270)).toBeNull();
    expect(routeProgress(fixes, 20, -66, 270)).toBeNull();
  });
});
