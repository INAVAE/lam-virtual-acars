import { describe, expect, it } from 'vitest';
import {
  atcFacility,
  atcStation,
  atisText,
  cleanFixes,
  firFor,
  formatFrequency,
  groupAtcs,
  isLabeledFix,
  labelMode,
  latestRadarFrame,
  onlineFor,
  radarTileUrl,
} from './map-layers';

describe('capas del mapa', () => {
  it('limpia los puntos del plan', () => {
    const fixes = cleanFixes([
      { ident: 'MMMX', type: 'apt', lat: 19.43, lon: -99.07 },
      { ident: 'MMMX', type: 'apt', lat: 19.43, lon: -99.07 },
      { ident: 'SLM', type: 'vor', lat: 19.8, lon: -99.0, via: 'DCT' },
      { ident: 'BAD', lat: 95, lon: 0 },
      { foo: 1 },
      { ident: 'TOC', type: 'ltlg', lat: 20, lon: -100 },
    ]);
    expect(fixes.map((f) => f.ident)).toEqual(['MMMX', 'SLM', 'TOC']);
    expect(fixes.filter(isLabeledFix).map((f) => f.ident)).toEqual(['MMMX', 'SLM']);
    expect(cleanFixes(null)).toEqual([]);
  });

  it('reduce las etiquetas al alejar el mapa', () => {
    expect(labelMode(7)).toBe('full');
    expect(labelMode(4.5)).toBe('compact');
  });

  it('clasifica y agrupa los controladores de IVAO', () => {
    expect(atcFacility({ callsign: 'MMMX_TWR', position: 'TWR' })).toBe('TWR');
    expect(atcFacility({ callsign: 'MMFR_CTR', position: null })).toBe('CTR');
    expect(atcFacility({ callsign: 'XX_OBS', position: 'OBS' })).toBe('OTHER');
    expect(atcStation('TFFG_FIS_TWR')).toBe('TFFG');
    const stations = groupAtcs([
      { callsign: 'SKCL_TWR', position: 'TWR', latitude: 3.54, longitude: -76.38 },
      { callsign: 'SKCL_APP', position: 'APP', latitude: 3.54, longitude: -76.38 },
      { callsign: 'SKCL_GND', position: 'GND' },
      { callsign: 'MMFR_CTR', position: 'CTR', latitude: 19.4, longitude: -99.1 },
    ]);
    expect(stations.map((s) => `${s.kind}:${s.code}:${s.facilities.join('/')}`)).toEqual(['center:MMFR:CTR', 'airport:SKCL:GND/TWR/APP']);
    expect(stations[1]!.latitude).toBe(3.54);
    expect(stations[1]!.atcs.map((a) => a.callsign)).toEqual(['SKCL_GND', 'SKCL_TWR', 'SKCL_APP']);
  });

  it('encuentra la FIR del VATSpy Data Project', () => {
    const index = { firs: { MMFR: ['Mexico', 'MMFR'] as [string, string], MMFO: ['Mazatlan', 'MMZT'] as [string, string] } };
    expect(firFor('mmfo', index)).toEqual({ name: 'Mazatlan', boundary: 'MMZT' });
    expect(firFor('XXXX', index)).toBeNull();
    expect(firFor('MMFR', null)).toBeNull();
  });

  it('presenta frecuencia, tiempo en línea y ATIS', () => {
    expect(formatFrequency(118.1)).toBe('118.100');
    expect(formatFrequency(null)).toBe('—');
    const now = Date.parse('2026-11-05T03:00:00Z');
    expect(onlineFor('2026-11-05T01:48:00Z', now)).toBe('1 h 12 min');
    expect(onlineFor('2026-11-05T02:50:00Z', now)).toBe('10 min');
    expect(atisText(['ts-1.sa-east-1.ivao.aero/SKCL_TWR', 'Information BRAVO', ' ARR RWY 02 '])).toEqual(['Information BRAVO', 'ARR RWY 02']);
  });

  it('lee el último cuadro de radar de RainViewer', () => {
    const frame = latestRadarFrame({
      host: 'https://tilecache.rainviewer.com',
      radar: { past: [{ time: 1, path: '/v2/radar/1' }, { time: 2, path: '/v2/radar/2' }] },
    });
    expect(frame).toEqual({ host: 'https://tilecache.rainviewer.com', path: '/v2/radar/2', time: 2 });
    expect(radarTileUrl(frame!)).toBe('https://tilecache.rainviewer.com/v2/radar/2/256/{z}/{x}/{y}/2/1_1.png');
    expect(latestRadarFrame({ host: 'javascript:alert(1)', radar: { past: [{ path: '/x' }] } })).toBeNull();
    expect(latestRadarFrame({ host: 'https://a.b', radar: { past: [] } })).toBeNull();
  });
});
