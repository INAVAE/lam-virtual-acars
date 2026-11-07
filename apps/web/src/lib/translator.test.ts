import { describe, expect, it } from 'vitest';
import { EN } from '@/content/i18n-en';
import { compilePatterns, normalize, translateText, type Dictionary } from './translator';

const dict: Dictionary = {
  strings: { 'Cerrar sesión': 'Sign out', Pendiente: 'Pending', 'Ver todos': 'View all' },
  patterns: [
    ['Hay {0} solicitudes', 'There are {0} requests'],
    ['Estado: {0}', 'Status: {0}'],
  ],
};
const compiled = compilePatterns(dict.patterns);

describe('traductor', () => {
  it('traduce textos exactos con espacios normalizados', () => {
    expect(translateText(normalize('  Cerrar   sesión \n'), dict, compiled)).toBe('Sign out');
    expect(translateText('No existe', dict, compiled)).toBeNull();
  });
  it('traduce plantillas y lo que va dentro si también está en el diccionario', () => {
    expect(translateText('Hay 4 solicitudes', dict, compiled)).toBe('There are 4 requests');
    expect(translateText('Estado: Pendiente', dict, compiled)).toBe('Status: Pending');
  });
  it('el diccionario en inglés no tiene plantillas con marcadores distintos', () => {
    for (const [from, to] of EN.patterns) {
      const a = (from.match(/\{\d+\}/g) ?? []).sort().join();
      const b = (to.match(/\{\d+\}/g) ?? []).sort().join();
      expect(a).toBe(b);
    }
    expect(EN.strings['Cerrar sesión']).toBe('Sign out');
  });
});
