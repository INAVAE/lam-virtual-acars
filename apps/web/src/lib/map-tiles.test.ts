import { describe, expect, it } from 'vitest';
import { mapTileConfig, OSM_ATTRIBUTION, OSM_TILE_URL, tileOrigin } from './map-tiles';

describe('map-tiles', () => {
  it('usa OpenStreetMap con su atribución y enlace a la licencia', () => {
    const c = mapTileConfig({});
    expect(c.url).toBe(OSM_TILE_URL);
    expect(c.attribution).toContain('OpenStreetMap');
    expect(c.attribution).toContain('https://www.openstreetmap.org/copyright');
  });

  it('permite otro proveedor sin perder la atribución obligatoria', () => {
    expect(mapTileConfig({ VITE_MAP_TILE_URL: 'https://tiles.example.com/{z}/{x}/{y}.png' }).attribution).toBe(OSM_ATTRIBUTION);
    expect(
      mapTileConfig({ VITE_MAP_TILE_URL: 'https://tiles.example.com/{z}/{x}/{y}.png', VITE_MAP_ATTRIBUTION: 'Ejemplo © OpenStreetMap' }).attribution,
    ).toBe('Ejemplo © OpenStreetMap');
  });

  it('calcula el origen para la CSP', () => {
    expect(tileOrigin(OSM_TILE_URL)).toBe('https://tile.openstreetmap.org');
    expect(tileOrigin('https://{s}.tiles.example.com/{z}/{x}/{y}.png')).toBe('https://*.tiles.example.com');
    expect(tileOrigin('no es url')).toBe('');
  });
});
