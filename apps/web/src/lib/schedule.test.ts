import { describe, expect, it } from 'vitest';
import { formatDays, formatDuration, formatUtcTime, maskToDigits } from './schedule';

describe('formatDays', () => {
  it('muestra Diario con todos los días', () => {
    expect(formatDays(127)).toBe('Diario');
  });
  it('muestra lunes, miércoles y viernes', () => {
    expect(formatDays(21)).toBe('L X V');
  });
});

describe('maskToDigits', () => {
  it('convierte la máscara al formato del CSV', () => {
    expect(maskToDigits(21)).toBe('135');
  });
});

describe('formatDuration', () => {
  it('formatea horas y minutos', () => {
    expect(formatDuration(65)).toBe('1 h 05 min');
    expect(formatDuration(45)).toBe('45 min');
  });
});

describe('formatUtcTime', () => {
  it('agrega la Z de hora UTC', () => {
    expect(formatUtcTime('14:30:00')).toBe('14:30Z');
    expect(formatUtcTime(null)).toBeNull();
  });
});
