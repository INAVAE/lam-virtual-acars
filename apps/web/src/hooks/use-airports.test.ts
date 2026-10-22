import { describe, expect, it } from 'vitest';
import { searchTerm } from './use-airports';

describe('searchTerm', () => {
  it('quita caracteres que rompen el filtro de PostgREST', () => {
    expect(searchTerm('mmmx,(name).eq')).toBe('mmmx name eq');
  });
  it('conserva acentos y espacios', () => {
    expect(searchTerm('  Ciudad   de México ')).toBe('Ciudad de México');
  });
});
