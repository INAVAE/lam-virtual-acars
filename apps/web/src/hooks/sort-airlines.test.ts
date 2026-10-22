import { describe, expect, it } from 'vitest';
import { sortAirlines } from './use-lam-data';

describe('sortAirlines', () => {
  it('pone primero a Líneas Aéreas Mexicanas y ordena el resto por nombre', () => {
    const sorted = sortAirlines([
      { slug: 'taesa', name: 'TAESA' },
      { slug: 'lineas-aereas-mexicanas', name: 'Líneas Aéreas Mexicanas' },
      { slug: 'alas-del-sur', name: 'Alas del Sur' },
      { slug: 'fedex-virtual', name: 'FedEx Virtual' },
    ]);
    expect(sorted.map((a) => a.slug)).toEqual(['lineas-aereas-mexicanas', 'alas-del-sur', 'fedex-virtual', 'taesa']);
  });
});
