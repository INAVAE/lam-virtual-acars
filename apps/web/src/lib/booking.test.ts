import { describe, expect, it } from 'vitest';
import {
  CALLSIGN_PATTERN,
  blockReasonLabel,
  formatTimeLeft,
  formatZuluDateTime,
  normalizeCallsign,
  parseMismatches,
  simbriefDispatchUrl,
} from './booking';

describe('booking helpers', () => {
  it('normaliza el callsign como la base de datos', () => {
    expect(normalizeCallsign(' mxl 100 ')).toBe('MXL100');
    expect(CALLSIGN_PATTERN.test('MXL100')).toBe(true);
    expect(CALLSIGN_PATTERN.test('MX')).toBe(false);
    expect(CALLSIGN_PATTERN.test('MXL-100')).toBe(false);
  });

  it('traduce motivos de bloqueo', () => {
    expect(blockReasonLabel(null)).toBeNull();
    expect(blockReasonLabel('no_rating')).toBe('Sin habilitación de tipo');
    expect(blockReasonLabel('desconocido')).toBe('No disponible');
  });

  it('muestra el tiempo restante', () => {
    const now = new Date('2026-10-24T12:00:00Z');
    expect(formatTimeLeft('2026-10-24T17:20:00Z', now)).toBe('5 h 20 min');
    expect(formatTimeLeft('2026-10-24T12:12:30Z', now)).toBe('12 min');
    expect(formatTimeLeft('2026-10-26T13:00:00Z', now)).toBe('2 d 1 h');
    expect(formatTimeLeft('2026-10-24T11:00:00Z', now)).toBe('vencida');
  });

  it('formatea fecha y hora UTC', () => {
    expect(formatZuluDateTime('2026-10-25T14:30:00Z')).toBe('25 OCT 14:30Z');
  });

  it('descarta diferencias con forma desconocida', () => {
    expect(parseMismatches([{ field: 'destination', expected: 'MMGL', actual: 'MMMY', severity: 'high' }, { foo: 1 }, null])).toHaveLength(1);
    expect(parseMismatches('x')).toEqual([]);
  });

  it('arma el enlace de SimBrief Dispatch', () => {
    const url = new URL(
      simbriefDispatchUrl({
        airlineIcao: 'MXL',
        flightNumber: '100',
        callsign: 'MXL100',
        aircraftIcao: 'A20N',
        registration: 'XA-MXL',
        origin: 'MMMX',
        destination: 'MMGL',
        remarks: 'IVAOVA/MXL',
        departure: '2026-10-25T14:05:00Z',
      }),
    );
    expect(url.hostname).toBe('dispatch.simbrief.com');
    expect(url.searchParams.get('orig')).toBe('MMMX');
    expect(url.searchParams.get('manualrmk')).toBe('IVAOVA/MXL');
    expect(url.searchParams.get('deph')).toBe('14');
    expect(url.searchParams.get('depm')).toBe('5');
  });
});
