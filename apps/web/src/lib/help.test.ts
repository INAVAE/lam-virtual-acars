import { describe, expect, it } from 'vitest';
import { HELP_CHAPTERS, HELP_FAQ, HELP_TROUBLESHOOTING, MANUAL_CHANGES, MANUAL_UPDATED, ticketModules } from '@/content/help-content';
import { browserLabel, chapterVisible, fold, moduleForPath, normalizeReference, searchChapters, searchPairs, ticketContext } from './help';

describe('centro de ayuda', () => {
  it('el contenido del manual está completo', () => {
    const ids = HELP_CHAPTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of HELP_CHAPTERS) {
      expect(c.steps.length).toBeGreaterThan(0);
      if (c.shot?.marks) expect(c.shot.marks.length).toBeLessThanOrEqual(6);
    }
    expect(HELP_FAQ.length).toBeGreaterThan(10);
    expect(HELP_TROUBLESHOOTING.every((r) => r.length === 3)).toBe(true);
    expect(MANUAL_UPDATED).toBe(MANUAL_CHANGES[0]![0]);
    expect(MANUAL_CHANGES.map((c) => c[0])).toEqual([...MANUAL_CHANGES.map((c) => c[0])].sort().reverse());
    expect(ticketModules).toContain('Conector LAM ACARS');
  });

  it('busca sin importar acentos ni mayúsculas', () => {
    expect(fold('Habilitación')).toBe('habilitacion');
    const hits = searchChapters(HELP_CHAPTERS, 'habilitacion tipo');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((c) => fold(JSON.stringify(c)).includes('habilitacion'))).toBe(true);
    expect(searchChapters(HELP_CHAPTERS, ' ')).toHaveLength(HELP_CHAPTERS.length);
    expect(searchPairs(HELP_FAQ, 'combustible pushback').length).toBeGreaterThan(0);
    expect(searchPairs(HELP_FAQ, 'zzzz')).toEqual([]);
  });

  it('muestra cada capítulo a quien le sirve', () => {
    const pilot = { staff: false, admin: false, superadmin: false };
    expect(chapterVisible('all', pilot)).toBe(true);
    expect(chapterVisible('staff', pilot)).toBe(false);
    expect(chapterVisible('staff', { ...pilot, staff: true })).toBe(true);
    expect(chapterVisible('admin', { ...pilot, staff: true })).toBe(false);
    expect(chapterVisible('super', { staff: true, admin: true, superadmin: false })).toBe(false);
    expect(chapterVisible('admin', { ...pilot, superadmin: true })).toBe(true);
  });

  it('arma el contexto del reporte sin datos personales', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
    expect(browserLabel(ua)).toBe('Chrome · Windows');
    expect(browserLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605 Version/18 Safari/605')).toBe('Safari · macOS');
    expect(browserLabel(`${ua} Edg/141.0`)).toBe('Edge · Windows');
    const ctx = ticketContext({ userAgent: ua, width: 1440, height: 900, theme: 'dark', path: '/booking', version: '123-abc', timeZone: 'America/Mexico_City' });
    expect(ctx).toEqual({ browser: 'Chrome · Windows', viewport: '1440×900', theme: 'dark', path: '/booking', version: '123-abc', time_zone: 'America/Mexico_City' });
  });

  it('propone el módulo y limpia el folio relacionado', () => {
    expect(moduleForPath('/pireps/abc')).toBe('PIREP');
    expect(moduleForPath('/')).toBe('Dashboard');
    expect(moduleForPath('/help')).toBeNull();
    expect(normalizeReference('  pirep-2026-00006 ')).toBe('PIREP-2026-00006');
    expect(normalizeReference('   ')).toBeNull();
  });
});
