import { describe, expect, it } from 'vitest';
import {
  ageMinutes,
  ceilingFt,
  describeWeather,
  flightCategory,
  formatAge,
  formatAltimeter,
  formatClouds,
  formatTemperature,
  formatVisibility,
  formatWind,
  normalizeIcao,
  tafChangeLabel,
} from './weather';

describe('clima', () => {
  it('normaliza el código ICAO', () => {
    expect(normalizeIcao(' mmmx ')).toBe('MMMX');
    expect(normalizeIcao('k-jfk!')).toBe('KJFK');
  });

  it('lee el viento', () => {
    expect(formatWind(270, 12, 22)).toBe('270° 12 kt, ráfagas 22 kt');
    expect(formatWind(50, 8, null)).toBe('050° 8 kt');
    expect(formatWind('VRB', 3, null)).toBe('Variable 3 kt');
    expect(formatWind(0, 0, null)).toBe('Calma');
    expect(formatWind(null, null, null)).toBe('Sin dato');
  });

  it('convierte la visibilidad a km o metros', () => {
    expect(formatVisibility('10+')).toBe('10 km o más');
    expect(formatVisibility(6.21)).toBe('10 km o más');
    expect(formatVisibility(3)).toBe('4800 m');
    expect(formatVisibility(4)).toBe('6 km');
    expect(formatVisibility(0.5)).toBe('800 m');
    expect(formatVisibility(null)).toBe('Sin dato');
  });

  it('calcula el techo y la categoría de vuelo', () => {
    const clouds = [
      { cover: 'FEW', base: 800 },
      { cover: 'BKN', base: 2500 },
      { cover: 'OVC', base: 8000 },
    ];
    expect(ceilingFt(clouds)).toBe(2500);
    expect(ceilingFt([{ cover: 'SCT', base: 1000 }])).toBeNull();
    expect(ceilingFt([], 200)).toBe(200);
    const base = { flight_category: null, vertical_visibility_ft: null };
    expect(flightCategory({ ...base, clouds, visibility_sm: '10+' })).toBe('MVFR');
    expect(flightCategory({ ...base, clouds: [{ cover: 'SCT', base: 4000 }], visibility_sm: 10 })).toBe('VFR');
    expect(flightCategory({ ...base, clouds: [{ cover: 'OVC', base: 700 }], visibility_sm: 4 })).toBe('IFR');
    expect(flightCategory({ ...base, clouds: [], visibility_sm: 0.25 })).toBe('LIFR');
    expect(flightCategory({ ...base, flight_category: 'ifr', clouds: [], visibility_sm: 10 })).toBe('IFR');
    expect(flightCategory({ ...base, clouds: [], visibility_sm: null })).toBeNull();
  });

  it('describe nubes y fenómenos en español', () => {
    expect(formatClouds([{ cover: 'BKN', base: 2000 }, { cover: 'OVC', base: 8000 }])).toBe('Fragmentadas a 2,000 ft · Cubierto a 8,000 ft');
    expect(formatClouds([{ cover: 'SCT', base: 3000, type: 'CB' }])).toBe('Dispersas a 3,000 ft (cumulonimbos)');
    expect(formatClouds([{ cover: 'CLR', base: null }])).toBe('Despejado');
    expect(formatClouds([])).toBe('Sin nubes reportadas');
    expect(describeWeather('-RA')).toBe('Lluvia ligera');
    expect(describeWeather('+TSRA BR')).toBe('Tormenta con lluvia fuerte · Neblina');
    expect(describeWeather('VCSH')).toBe('Chubascos en las cercanías');
    expect(describeWeather('XXYY')).toBe('XXYY');
    expect(describeWeather('-SHRA')).toBe('Chubascos de lluvia ligera');
    expect(describeWeather('FZFG')).toBe('Niebla engelante');
    expect(describeWeather(null)).toBeNull();
  });

  it('presenta temperatura, QNH y antigüedad', () => {
    expect(formatTemperature(16, 9)).toBe('16 °C / rocío 9 °C');
    expect(formatAltimeter(1013.2)).toBe('1013 hPa · 29.92 inHg');
    const now = Date.parse('2026-11-05T02:00:00Z');
    expect(ageMinutes('2026-11-05T01:44:00Z', now)).toBe(16);
    expect(formatAge(16)).toBe('hace 16 min');
    expect(formatAge(125)).toBe('hace 2 h 05 min');
  });

  it('nombra los cambios del TAF', () => {
    expect(tafChangeLabel({ change: null, probability: null })).toBe('Inicial');
    expect(tafChangeLabel({ change: 'TEMPO', probability: null })).toBe('Temporal');
    expect(tafChangeLabel({ change: 'PROB', probability: 30 })).toBe('Probabilidad 30 %');
    expect(tafChangeLabel({ change: 'BECMG', probability: null })).toBe('Cambiando');
  });
});
