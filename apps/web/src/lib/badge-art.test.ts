import { describe, expect, it } from 'vitest';
import { BADGE_EMBLEMS, BADGE_PRESETS, BADGE_SHAPES, podiumMetal, presetSpec, renderBadgeSvg, starPoints, trainingMetal } from './badge-art';

describe('insignias', () => {
  it('dibuja todas las formas y emblemas en los tres metales', () => {
    for (const shape of Object.keys(BADGE_SHAPES)) {
      for (const emblem of Object.keys(BADGE_EMBLEMS)) {
        for (const metal of ['gold', 'silver', 'bronze'] as const) {
          const svg = renderBadgeSvg({ shape: shape as never, emblem: emblem as never, metal, ribbon: 'TMX-01', top: 'LAM', label: '1' }, 'x');
          expect(svg.startsWith('<svg')).toBe(true);
          expect(svg).toContain('url(#x-metal)');
          expect(svg).not.toContain('NaN');
          expect(svg).not.toContain('undefined');
        }
      }
    }
  });

  it('escapa los textos y separa los degradados de cada insignia', () => {
    const svg = renderBadgeSvg({ shape: 'seal', emblem: 'plane', metal: 'gold', ribbon: '<b>&"x"', top: null }, 'uno');
    expect(svg).toContain('&lt;B&gt;&amp;&quot;X&quot;');
    expect(svg).toContain('id="uno-metal"');
    expect(renderBadgeSvg({ shape: 'seal', emblem: 'plane', metal: 'gold' }, 'dos')).toContain('id="dos-metal"');
  });

  it('sin texto de cinta no dibuja la cinta', () => {
    expect(renderBadgeSvg({ shape: 'round', emblem: 'star', metal: 'silver', ribbon: '  ' })).not.toContain('<rect x="25"');
  });

  it('metal por nivel de entrenamiento y por lugar del podio', () => {
    expect(trainingMetal('basic')).toBe('bronze');
    expect(trainingMetal('intermediate')).toBe('silver');
    expect(trainingMetal('advanced')).toBe('gold');
    expect([1, 2, 3, 4].map(podiumMetal)).toEqual(['gold', 'silver', 'bronze', null]);
  });

  it('la biblioteca tiene diseños distintos', () => {
    expect(new Set(BADGE_PRESETS.map((p) => p.id)).size).toBe(BADGE_PRESETS.length);
    expect(presetSpec(BADGE_PRESETS[0]!, 'bronze', 'AIFA').ribbon).toBe('AIFA');
    expect(starPoints(100, 100, 5, 30, 10).split(' ')).toHaveLength(10);
  });
});
