import { describe, expect, it } from 'vitest';
import { clockTime, dayTime, dualTime, formatDateTimeIn, isValidTimeZone, utcTimeOfDay, zoneAbbreviation } from './time';

const T = new Date('2026-10-31T04:15:09Z');

describe('time', () => {
  it('hora en UTC y en la zona local', () => {
    expect(clockTime(T, 'UTC')).toBe('04:15');
    expect(clockTime(T, 'America/Mexico_City', true)).toBe('22:15:09');
    expect(dayTime(T, 'America/Mexico_City')).toBe('30 OCT 22:15');
  });

  it('abreviatura de la zona', () => {
    expect(zoneAbbreviation('UTC')).toBe('UTC');
    expect(zoneAbbreviation('America/New_York', new Date('2026-07-01T12:00:00Z'))).toBe('EDT');
    expect(zoneAbbreviation('America/Mexico_City', T)).toMatch(/^(CST|GMT-6)$/);
  });

  it('hora doble en el orden elegido', () => {
    const z = dualTime(T, 'America/Mexico_City', 'utc');
    expect(z.primary).toBe('04:15Z');
    expect(z.secondary).toMatch(/^22:15 (CST|GMT-6)$/);
    const l = dualTime(T, 'America/Mexico_City', 'local', { withDate: true });
    expect(l.primary).toMatch(/^30 OCT 22:15 /);
    expect(l.secondary).toBe('31 OCT 04:15Z');
    expect(dualTime(T, 'UTC', 'local')).toEqual({ primary: '04:15Z', secondary: '' });
  });

  it('horarios UTC de las rutas en hora local', () => {
    expect(utcTimeOfDay('14:30:00', 'America/Mexico_City', 'utc', T).secondary).toMatch(/^08:30 /);
  });

  it('valida zonas y formatea fecha y hora local', () => {
    expect(isValidTimeZone('America/Mexico_City')).toBe(true);
    expect(isValidTimeZone('Hora/Inventada')).toBe(false);
    expect(formatDateTimeIn('2026-10-31T04:15:09Z', 'America/Mexico_City')).toContain('30');
  });
});
