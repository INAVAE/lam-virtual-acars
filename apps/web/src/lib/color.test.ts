import { describe, expect, it } from 'vitest';
import { contrastRatio, readableTextOn, safeAccent } from './color';

describe('contrastRatio', () => {
  it('da 21:1 entre blanco y negro', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 1);
  });
});

describe('readableTextOn', () => {
  it('usa texto blanco sobre el verde LAM', () => {
    expect(readableTextOn('#057956')).toBe('#FFFFFF');
  });

  it('usa texto blanco sobre azul aeronáutico', () => {
    expect(readableTextOn('#2563EB')).toBe('#FFFFFF');
  });

  it('usa texto oscuro sobre verde claro', () => {
    expect(readableTextOn('#22C55E')).toBe('#0B1220');
  });
});

describe('safeAccent', () => {
  it('vuelve al verde LAM con un color inválido', () => {
    expect(safeAccent('rojo')).toBe('#057956');
    expect(safeAccent(null)).toBe('#057956');
    expect(safeAccent('#E11D48')).toBe('#E11D48');
  });
});
