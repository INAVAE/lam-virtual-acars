import { describe, expect, it } from 'vitest';
import {
  altitudeProfile,
  findingDetail,
  formatHours,
  formatMinutes,
  formatVs,
  landingRating,
  parseFindings,
  projectTrack,
  scoreTone,
} from './pirep';

describe('pirep', () => {
  it('califica la toma por velocidad vertical', () => {
    expect(landingRating(-180)?.label).toBe('Suave');
    expect(landingRating(-294)?.label).toBe('Normal');
    expect(landingRating(-549)?.label).toBe('Firme');
    expect(landingRating(-700)?.tone).toBe('danger');
    expect(landingRating(null)).toBeNull();
  });

  it('da formato a tiempos, horas y velocidad vertical', () => {
    expect(formatMinutes(56)).toBe('0:56');
    expect(formatMinutes(125)).toBe('2:05');
    expect(formatHours(90)).toBe('1.5 h');
    expect(formatHours(0)).toBe('0.0 h');
    expect(formatVs(-549)).toBe('−549 fpm');
  });

  it('tono del puntaje', () => {
    expect(scoreTone(100)).toBe('ok');
    expect(scoreTone(80)).toBe('neutral');
    expect(scoreTone(55)).toBe('warn');
    expect(scoreTone(20)).toBe('danger');
  });

  it('describe cada falta con su valor y umbral', () => {
    const [firm, taxi, bounce, overspeed, diversion] = parseFindings([
      { code: 'landing_firm', label: 'Aterrizaje firme', penalty: 5, critical: false, value: -549, threshold: 400, unit: 'fpm' },
      { code: 'taxi_speed', label: 'Rodaje rápido', penalty: 5, critical: false, value: 32, threshold: 30, unit: 'kt' },
      { code: 'landing_bounce', label: 'Rebote', penalty: 5, critical: false, value: 2, threshold: null, unit: null },
      { code: 'overspeed', label: 'Sobrevelocidad', penalty: 10, critical: false, value: 1, threshold: null, unit: null },
      { code: 'diversion', label: 'Desvío', penalty: 0, critical: true, value: null, threshold: null, unit: null },
      { nope: true },
    ]);
    expect(findingDetail(firm!)).toBe('−549 fpm (umbral 400 fpm)');
    expect(findingDetail(taxi!)).toBe('32 kt (umbral 30 kt)');
    expect(findingDetail(bounce!)).toBe('2 rebotes');
    expect(findingDetail(overspeed!)).toBe('1 vez');
    expect(findingDetail(diversion!)).toBeNull();
  });

  it('describe las faltas de actitud', () => {
    const [bank, down, upset] = parseFindings([
      { code: 'bank_excess', label: 'Alabeo excesivo', penalty: 5, critical: false, value: 41, threshold: 35, unit: '°' },
      { code: 'pitch_down_excess', label: 'Cabeceo excesivo (nariz abajo)', penalty: 5, critical: false, value: -8.4, threshold: 7.5, unit: '°' },
      { code: 'attitude_upset', label: 'Actitud anormal (upset)', penalty: 15, critical: true, value: null, threshold: null, unit: null },
    ]);
    expect(findingDetail(bank!)).toBe('41.0° (umbral 35.0°)');
    expect(findingDetail(down!)).toBe('−8.4° (umbral −7.5°)');
    expect(findingDetail(upset!)).toMatch(/45°/);
  });

  it('proyecta la traza dentro del lienzo', () => {
    const pts = [
      { latitude: 19.43, longitude: -99.07, altitude_ft: 7316, sampled_at: '2026-10-28T06:00:00Z' },
      { latitude: 18.5, longitude: -99.5, altitude_ft: 25000, sampled_at: '2026-10-28T06:20:00Z' },
      { latitude: 16.76, longitude: -99.75, altitude_ft: 16, sampled_at: '2026-10-28T06:50:00Z' },
    ];
    const p = projectTrack(pts, 400, 300);
    expect(p.path.startsWith('M')).toBe(true);
    for (const [x, y] of [p.start!, p.end!]) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(400);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(300);
    }
    // El sur queda abajo.
    expect(p.end![1]).toBeGreaterThan(p.start![1]);

    const profile = altitudeProfile(pts, 400, 120);
    expect(profile.maxFt).toBe(25000);
    expect(profile.area.endsWith('Z')).toBe(true);
    expect(projectTrack([], 10, 10).path).toBe('');
  });
});
