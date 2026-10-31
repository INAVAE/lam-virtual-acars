import { describe, expect, it } from 'vitest';
import {
  altitudeBand,
  apuIntervals,
  cumulativeDistance,
  eventMarkers,
  flightExtremes,
  formatElapsed,
  formatLatLon,
  fuelFlowAt,
  fuelSeries,
  nearestIndexByPosition,
  nearestIndexByTime,
  niceTicks,
  phaseGroup,
  phaseSpans,
  segmentsBy,
  type AnalysisPoint,
} from './flight-analysis';

const t0 = Date.parse('2026-10-28T06:00:00Z');
const pt = (i: number, phase: string, alt: number, lat = 19 + i * 0.1, lon = -99, extra: Partial<AnalysisPoint> = {}): AnalysisPoint => ({
  seq: i,
  sampled_at: new Date(t0 + i * 60_000).toISOString(),
  latitude: lat,
  longitude: lon,
  altitude_ft: alt,
  gs_kt: 200 + i,
  ias_kt: 180 + i,
  vs_fpm: i < 4 ? 1500 : -800,
  heading_deg: 90,
  on_ground: phase === 'taxi_out' || phase === 'taxi_in',
  phase,
  ...extra,
});

const TRACK = [
  pt(0, 'taxi_out', 7300),
  pt(1, 'taxi_out', 7300),
  pt(2, 'takeoff', 7400),
  pt(3, 'climb', 15000),
  pt(4, 'cruise', 25000),
  pt(5, 'descent', 9000),
  pt(6, 'taxi_in', 50),
];

describe('flight-analysis', () => {
  it('agrupa fases para el color', () => {
    expect(phaseGroup('pushback')).toBe('ground');
    expect(phaseGroup('engines_started')).toBe('ground');
    expect(phaseGroup('cruise')).toBe('cruise');
  });

  it('divide en tramos sin huecos', () => {
    const s = segmentsBy(TRACK, 'phase');
    expect(s.map((x) => x.key)).toEqual(['ground', 'takeoff', 'climb', 'cruise', 'descent', 'ground']);
    // Cada tramo termina en el primer punto del siguiente.
    expect(s[0]).toMatchObject({ from: 0, to: 2 });
    expect(s[s.length - 1]).toMatchObject({ from: 6, to: 6 });
    for (let i = 1; i < s.length; i++) expect(s[i]!.from).toBe(s[i - 1]!.to);
  });

  it('colorea por bandas de altitud', () => {
    expect(altitudeBand(500)).toBe(0);
    expect(altitudeBand(7300)).toBe(2);
    expect(altitudeBand(25000)).toBe(4);
    expect(altitudeBand(41000)).toBe(6);
    expect(segmentsBy(TRACK, 'altitude').length).toBeGreaterThan(3);
    expect(segmentsBy([], 'phase')).toEqual([]);
  });

  it('intervalos de fase en el tiempo', () => {
    const spans = phaseSpans(TRACK);
    expect(spans[0]).toEqual({ group: 'ground', start: t0, end: t0 + 2 * 60_000 });
  });

  it('distancia acumulada y punto más cercano', () => {
    const d = cumulativeDistance(TRACK);
    expect(d[0]).toBe(0);
    expect(d[1]).toBeCloseTo(6, 0); // 0.1° de latitud ≈ 6 NM
    const times = TRACK.map((p) => Date.parse(p.sampled_at));
    expect(nearestIndexByTime(times, t0 + 2.4 * 60_000)).toBe(2);
    expect(nearestIndexByTime(times, t0 + 2.6 * 60_000)).toBe(3);
    expect(nearestIndexByTime(times, t0 - 1)).toBe(0);
    expect(nearestIndexByTime(times, t0 + 99 * 60_000)).toBe(6);
    expect(nearestIndexByTime([], 0)).toBe(-1);
    expect(nearestIndexByPosition(TRACK, 19.31, -99)).toBe(3);
    expect(nearestIndexByPosition(TRACK, 19.31, -99, 5, 6)).toBe(5);
  });

  it('extremos del vuelo', () => {
    const e = flightExtremes(TRACK);
    expect(e.maxAltitude).toEqual({ value: 25000, index: 4 });
    expect(e.maxIas?.index).toBe(6);
    expect(e.maxClimb?.value).toBe(1500);
    expect(e.maxDescent?.value).toBe(-800);
  });

  it('marcadores de eventos', () => {
    const m = eventMarkers([
      { id: 'a', seq: 0, type: 'takeoff', phase: 'initial_climb', occurred_at: '2026-10-28T06:02:00Z', altitude_ft: 7400, latitude: 19.2, longitude: -99, data: { ias_kt: 153, flaps_deg: 5 } },
      { id: 'b', seq: 1, type: 'touchdown', phase: 'landing', occurred_at: '2026-10-28T06:06:00Z', altitude_ft: 60, data: { vs_fpm: -294.4, g_force: 1.25 } },
      { id: 'c', seq: 2, type: 'phase_change', phase: 'approach', occurred_at: '2026-10-28T06:05:00Z', altitude_ft: 3000, data: { reason: 'go_around' } },
      { id: 'd', seq: 3, type: 'phase_change', phase: 'cruise', occurred_at: '2026-10-28T06:04:00Z', altitude_ft: 25000, data: { to: 'cruise' } },
      { id: 'e', seq: 4, type: 'overspeed', phase: 'descent', occurred_at: '2026-10-28T06:05:00Z', altitude_ft: 9000, data: { ias_kt: 345 } },
    ]);
    expect(m.map((x) => x.kind)).toEqual(['takeoff', 'touchdown', 'go_around', 'warning']);
    expect(m[0]!.detail).toBe('153 kt · flaps 5°');
    expect(m[1]!.detail).toBe('-294 fpm · 1.25 G');
    expect(m[2]!.label).toBe('Motor y al aire');
    expect(m[3]!.label).toBe('Sobrevelocidad');
  });

  it('ejes y formato', () => {
    expect(niceTicks(25024)).toEqual([0, 10000, 20000, 30000]);
    expect(niceTicks(290)).toEqual([0, 100, 200, 300]);
    expect(niceTicks(0)).toEqual([0]);
    expect(formatElapsed(65 * 60_000)).toBe('T+1:05');
    expect(formatLatLon(19.4363, -99.0721)).toBe('19.4363°N 99.0721°W');
  });

  it('combustible de la traza o interpolado entre eventos', () => {
    const times = TRACK.map((p) => Date.parse(p.sampled_at));
    const withFuel = TRACK.map((p, i) => ({ ...p, fuel_kg: 6000 - i * 100 }));
    const real = fuelSeries(withFuel, times, []);
    expect(real.approximate).toBe(false);
    expect(real.values[3]).toBe(5700);
    // 100 kg por minuto = 6,000 kg/h
    expect(fuelFlowAt(real.values, times, 3)).toBe(6000);

    const events = [
      { id: 'a', seq: 0, type: 'block_off', phase: 'pushback', occurred_at: TRACK[0]!.sampled_at, altitude_ft: null, data: { fuel_kg: 6000 } },
      { id: 'b', seq: 1, type: 'block_on', phase: 'taxi_in', occurred_at: TRACK[4]!.sampled_at, altitude_ft: null, data: { fuel_kg: 5600 } },
    ];
    const approx = fuelSeries(TRACK, times, events);
    expect(approx.approximate).toBe(true);
    expect(approx.values.slice(0, 6)).toEqual([6000, 5900, 5800, 5700, 5600, null]);
    expect(fuelSeries(TRACK, times, []).values.every((v) => v === null)).toBe(true);
  });

  it('APU: marcadores e intervalos en marcha', () => {
    const apu = (id: string, min: number, state: string) => ({
      id,
      seq: 0,
      type: 'note',
      phase: 'preflight',
      occurred_at: new Date(t0 + min * 60_000).toISOString(),
      altitude_ft: null,
      data: { kind: 'apu', state, fuel_kg: 6000 },
    });
    const events = [apu('a', 0, 'start'), apu('b', 12, 'stop'), apu('c', 60, 'start')];
    expect(apuIntervals(events, t0 + 70 * 60_000)).toEqual([
      { start: t0, end: t0 + 12 * 60_000 },
      { start: t0 + 60 * 60_000, end: t0 + 70 * 60_000 },
    ]);
    const m = eventMarkers(events);
    expect(m.map((x) => x.label)).toEqual(['APU encendida', 'APU apagada', 'APU encendida']);
    expect(m[0]!.detail).toBe('6000 kg a bordo');
    expect(eventMarkers([{ ...apu('d', 0, 'running') }])[0]!.label).toBe('APU ya en marcha al iniciar ACARS');
    expect(eventMarkers([{ ...apu('e', 0, 'start'), data: { kind: 'adapter' } }])).toEqual([]);
  });
});
