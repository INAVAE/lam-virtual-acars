import { describe, expect, it } from 'vitest';
import { formatPilotNumber, formatRoles, formatZulu, formatZuluDate } from './format';

describe('formatPilotNumber', () => {
  it('rellena a cuatro dígitos', () => {
    expect(formatPilotNumber(1001)).toBe('LAM1001');
    expect(formatPilotNumber(7)).toBe('LAM0007');
  });
});

describe('formatZulu', () => {
  it('usa la hora UTC sin importar la zona local', () => {
    const date = new Date('2026-10-19T05:04:03.000Z');
    expect(formatZulu(date)).toBe('05:04:03Z');
    expect(formatZuluDate(date)).toBe('2026-10-19');
  });
});

describe('formatRoles', () => {
  it('ordena los roles de mayor a menor responsabilidad', () => {
    expect(formatRoles(['pilot', 'airline_admin'])).toBe('Administrador, Piloto');
  });
});
