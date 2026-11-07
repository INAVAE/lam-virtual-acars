import { describe, expect, it } from 'vitest';
import {
  buildTrainingIcs,
  dateKeyIn,
  googleCalendarUrl,
  isDiscordUrl,
  isoToZonedInput,
  monthGrid,
  shiftMonth,
  trainingPhase,
  zonedInputToIso,
} from './training';

const T = {
  id: '00000000-0000-4000-8000-000000000001',
  folio: 'TRN-2026-0001',
  title: 'SOP del A320, parte 1',
  description: 'Flujo de cabina; listas de verificación',
  starts_at: '2026-11-10T01:00:00.000Z',
  ends_at: '2026-11-10T03:00:00.000Z',
  status: 'scheduled' as const,
  discord_url: 'https://discord.gg/lamvirtual',
  discord_channel: '#training-a320',
  instructor: { display_name: 'Capitana Ruiz' },
};

describe('zonas horarias', () => {
  it('convierte la hora local de México a UTC y de regreso', () => {
    expect(zonedInputToIso('2026-11-09T19:00', 'America/Mexico_City')).toBe('2026-11-10T01:00:00.000Z');
    expect(isoToZonedInput('2026-11-10T01:00:00.000Z', 'America/Mexico_City')).toBe('2026-11-09T19:00');
  });
  it('respeta el horario de verano de Nueva York', () => {
    expect(zonedInputToIso('2026-07-01T10:00', 'America/New_York')).toBe('2026-07-01T14:00:00.000Z');
    expect(zonedInputToIso('2026-12-01T10:00', 'America/New_York')).toBe('2026-12-01T15:00:00.000Z');
  });
  it('UTC queda igual', () => {
    expect(zonedInputToIso('2026-11-10T01:00', 'UTC')).toBe('2026-11-10T01:00:00.000Z');
    expect(zonedInputToIso('nada', 'UTC')).toBeNull();
  });
  it('el día del calendario depende de la zona', () => {
    expect(dateKeyIn(T.starts_at, 'UTC')).toBe('2026-11-10');
    expect(dateKeyIn(T.starts_at, 'America/Mexico_City')).toBe('2026-11-09');
  });
});

describe('calendario', () => {
  it('arma semanas de lunes a domingo', () => {
    const weeks = monthGrid(2026, 11);
    expect(weeks[0]![0]!.key).toBe('2026-10-26');
    expect(weeks[0]![6]!.key).toBe('2026-11-01');
    expect(weeks.flat().filter((d) => d.inMonth)).toHaveLength(30);
  });
  it('cambia de año al avanzar o retroceder', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });
  it('sabe si viene, está en curso o terminó', () => {
    expect(trainingPhase(T, Date.parse('2026-11-09T00:00:00Z'))).toBe('upcoming');
    expect(trainingPhase(T, Date.parse('2026-11-10T02:00:00Z'))).toBe('live');
    expect(trainingPhase(T, Date.parse('2026-11-11T00:00:00Z'))).toBe('ended');
    expect(trainingPhase({ ...T, status: 'cancelled' }, 0)).toBe('cancelled');
  });
});

describe('ICS', () => {
  const ics = buildTrainingIcs(T, 'https://inavae.github.io/lam-virtual-acars/training/x', new Date('2026-11-07T00:00:00Z'));
  it('tiene inicio y fin en UTC', () => {
    expect(ics).toContain('DTSTART:20261110T010000Z');
    expect(ics).toContain('DTEND:20261110T030000Z');
    expect(ics).toContain('UID:trn-2026-0001-00000000-0000-4000-8000-000000000001@lam-virtual-acars');
  });
  it('escapa comas y punto y coma', () => {
    expect(ics).toContain('SUMMARY:TRN-2026-0001 · SOP del A320\\, parte 1');
    expect(ics).toContain('Flujo de cabina\\; listas');
  });
  it('usa CRLF y ninguna línea pasa de 75 octetos', () => {
    const lines = ics.split('\r\n');
    expect(lines.every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    expect(ics.endsWith('\r\n')).toBe(true);
  });
  it('arma el enlace de Google Calendar', () => {
    const url = googleCalendarUrl(T, 'https://example.com/t');
    expect(url).toContain('dates=20261110T010000Z%2F20261110T030000Z');
    expect(url).toContain('location=https%3A%2F%2Fdiscord.gg%2Flamvirtual');
  });
  it('valida el enlace de Discord', () => {
    expect(isDiscordUrl('https://discord.gg/lamvirtual')).toBe(true);
    expect(isDiscordUrl('https://discord.com/channels/123/456')).toBe(true);
    expect(isDiscordUrl('https://evil.example/x')).toBe(false);
  });
});
