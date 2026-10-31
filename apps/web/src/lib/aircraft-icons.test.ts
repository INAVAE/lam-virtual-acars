import { describe, expect, it } from 'vitest';
import { aircraftSvg, defaultMapCategory, MAP_CATEGORY_SIZE, mapCategory } from './aircraft-icons';

describe('defaultMapCategory', () => {
  it('clasifica por motor, estela y pasajeros como en la base', () => {
    expect(defaultMapCategory('C172', 'L', 'piston', 3)).toBe('light');
    expect(defaultMapCategory('TBM9', 'L', 'turboprop', 5)).toBe('light');
    expect(defaultMapCategory('AT76', 'M', 'turboprop', 78)).toBe('turboprop');
    expect(defaultMapCategory('C68A', 'M', 'jet', 12)).toBe('business_jet');
    expect(defaultMapCategory('E190', 'M', 'jet', 100)).toBe('regional_jet');
    expect(defaultMapCategory('B738', 'M', 'jet', 189)).toBe('narrowbody');
    expect(defaultMapCategory('A320', 'M', 'jet', null)).toBe('narrowbody');
    expect(defaultMapCategory('B77W', 'H', 'jet', 396)).toBe('widebody');
    expect(defaultMapCategory('B748', 'H', 'jet', 467)).toBe('jumbo');
    expect(defaultMapCategory('A388', 'J', 'jet', 853)).toBe('jumbo');
  });
});

describe('aircraftSvg', () => {
  it('usa el tamaño de la categoría y cae en pasillo único si no la conoce', () => {
    expect(mapCategory('zzz')).toBe('narrowbody');
    expect(aircraftSvg('jumbo', '#ff0000')).toContain(`width="${MAP_CATEGORY_SIZE.jumbo}"`);
    expect(aircraftSvg('jumbo', '#ff0000')).toContain('fill="#ff0000"');
    expect(aircraftSvg(undefined)).toContain(`width="${MAP_CATEGORY_SIZE.narrowbody}"`);
  });
});
