/**
 * Insignias de LAM dibujadas en SVG: forma × metal (oro, plata, bronce) ×
 * emblema de aviación, con texto opcional en la cinta. Son diseños propios y
 * paramétricos: con los mismos datos siempre sale la misma insignia, así que se
 * pueden generar al vuelo (entrenamientos, podio de eventos) o exportar a PNG
 * para subirlas como la insignia de un tour.
 */

export type BadgeMetal = 'gold' | 'silver' | 'bronze';
export type BadgeShape = 'seal' | 'laurel' | 'shield' | 'wings' | 'hexagon' | 'diamond' | 'compass' | 'round';
export type BadgeEmblem = 'plane' | 'globe' | 'wings' | 'star' | 'compass' | 'headset' | 'trophy' | 'tower' | 'number';

export interface BadgeSpec {
  shape: BadgeShape;
  metal: BadgeMetal;
  emblem: BadgeEmblem;
  /** Texto de la cinta (código del tour, nivel…). Sin texto, sin cinta. */
  ribbon?: string | null;
  /** Texto pequeño arriba del emblema (por ejemplo «LAM»). */
  top?: string | null;
  /** Número o texto corto para el emblema «number» (lugar del podio, «100»…). */
  label?: string | null;
  /** Color de la cinta; por omisión, el oscuro de la cara. */
  ribbonColor?: string | null;
}

export const BADGE_METALS: Record<BadgeMetal, { name: string; light: string; mid: string; dark: string; edge: string }> = {
  gold: { name: 'Oro', light: '#fff4c2', mid: '#e3b54a', dark: '#a06d12', edge: '#5f400a' },
  silver: { name: 'Plata', light: '#ffffff', mid: '#c8ced8', dark: '#7d8694', edge: '#454c57' },
  bronze: { name: 'Bronce', light: '#f7cfa6', mid: '#c27a43', dark: '#7d451f', edge: '#4a2811' },
};

export const BADGE_SHAPES: Record<BadgeShape, string> = {
  seal: 'Sello',
  laurel: 'Laureles',
  shield: 'Escudo',
  wings: 'Escudo con alas',
  hexagon: 'Hexágono',
  diamond: 'Rombo',
  compass: 'Rosa de los vientos',
  round: 'Medalla',
};

export const BADGE_EMBLEMS: Record<BadgeEmblem, string> = {
  plane: 'Avión',
  globe: 'Globo',
  wings: 'Alas de piloto',
  star: 'Estrella',
  compass: 'Brújula',
  headset: 'Audífonos (instrucción)',
  trophy: 'Trofeo',
  tower: 'Torre de control',
  number: 'Número',
};

const FACE = '#141b28';
const FACE_LIGHT = '#243045';

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

function f(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Polígono de estrella o sello: n puntas entre dos radios. */
export function starPoints(cx: number, cy: number, n: number, outer: number, inner: number, rotation = -90): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = ((rotation + (i * 180) / n) * Math.PI) / 180;
    pts.push(`${f(cx + r * Math.cos(a))},${f(cy + r * Math.sin(a))}`);
  }
  return pts.join(' ');
}

function polygon(cx: number, cy: number, n: number, r: number, rotation: number): string {
  return Array.from({ length: n }, (_, i) => {
    const a = ((rotation + (i * 360) / n) * Math.PI) / 180;
    return `${f(cx + r * Math.cos(a))},${f(cy + r * Math.sin(a))}`;
  }).join(' ');
}

const SHIELD = (s: number) => {
  // Escudo de 200×200 escalado por s alrededor del centro.
  const t = (x: number, y: number) => `${f(100 + (x - 100) * s)},${f(100 + (y - 100) * s)}`;
  return `M${t(100, 14)} L${t(170, 38)} L${t(170, 98)} C${t(170, 140)} ${t(140, 168)} ${t(100, 188)} C${t(60, 168)} ${t(30, 140)} ${t(30, 98)} L${t(30, 38)} Z`;
};

/** Rama de laurel de un lado: tallo en arco con hojas en pares, de abajo hacia arriba. */
function laurelSide(side: 1 | -1, fill: string): string {
  const r = 82;
  // Ángulos SVG (0 = derecha, 90 = abajo): la rama sube por la izquierda (side -1) o la derecha (side 1).
  const start = side === -1 ? 112 : 68;
  const end = side === -1 ? 232 : -52;
  const point = (deg: number, rr = r) => {
    const a = (deg * Math.PI) / 180;
    return { x: 100 + rr * Math.cos(a), y: 100 + rr * Math.sin(a) };
  };
  const p0 = point(start);
  const p1 = point(end);
  const stem = `<path d="M${f(p0.x)},${f(p0.y)} A${r},${r} 0 0 ${side === -1 ? 1 : 0} ${f(p1.x)},${f(p1.y)}" fill="none" stroke="${fill}" stroke-width="2.4" stroke-linecap="round"/>`;
  const leaves: string[] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const deg = start + ((end - start) * i) / steps;
    const size = 1 - i * 0.035;
    for (const out of [1, -1]) {
      const c = point(deg, r + out * 6.5 * size);
      // Tangente en el sentido del crecimiento, abierta hacia afuera o hacia adentro.
      const tangent = deg + (side === -1 ? 90 : -90);
      const rot = tangent + out * side * -32;
      leaves.push(`<ellipse cx="${f(c.x)}" cy="${f(c.y)}" rx="${f(9.5 * size)}" ry="${f(4 * size)}" transform="rotate(${f(rot)} ${f(c.x)} ${f(c.y)})" fill="${fill}"/>`);
    }
  }
  const tip = point(end, r);
  leaves.push(`<ellipse cx="${f(tip.x)}" cy="${f(tip.y - 6)}" rx="3.6" ry="8" fill="${fill}"/>`);
  return stem + leaves.join('');
}

/** Contorno (marco de metal) y la cara oscura de cada forma. */
function frame(shape: BadgeShape, g: { metal: string; bevel: string; face: string }): string {
  switch (shape) {
    case 'seal':
      return `<polygon points="${starPoints(100, 100, 30, 94, 85)}" fill="${g.metal}"/>
<circle cx="100" cy="100" r="76" fill="${g.bevel}"/><circle cx="100" cy="100" r="70" fill="${g.face}"/>`;
    case 'laurel':
      return `${laurelSide(1, g.metal)}${laurelSide(-1, g.metal)}
<circle cx="100" cy="100" r="70" fill="${g.metal}"/><circle cx="100" cy="100" r="64" fill="${g.bevel}"/><circle cx="100" cy="100" r="59" fill="${g.face}"/>`;
    case 'shield':
      return `<path d="${SHIELD(1)}" fill="${g.metal}"/><path d="${SHIELD(0.9)}" fill="${g.bevel}"/><path d="${SHIELD(0.84)}" fill="${g.face}"/>`;
    case 'wings': {
      const wing = (side: 1 | -1) =>
        [0, 1, 2, 3].map((i) => {
          const y = 74 + i * 14;
          const len = 58 - i * 11;
          const x0 = 100 + side * 52;
          const x1 = x0 + side * len;
          return `<path d="M${x0},${y} Q${f(x0 + side * len * 0.6)},${y - 14} ${f(x1)},${y - 6} Q${f(x0 + side * len * 0.55)},${y + 4} ${x0},${y + 10} Z" fill="${g.metal}"/>`;
        }).join('');
      return `${wing(1)}${wing(-1)}<path d="${SHIELD(0.78)}" fill="${g.metal}"/><path d="${SHIELD(0.7)}" fill="${g.bevel}"/><path d="${SHIELD(0.65)}" fill="${g.face}"/>`;
    }
    case 'hexagon':
      return `<polygon points="${polygon(100, 100, 6, 92, -90)}" fill="${g.metal}"/><polygon points="${polygon(100, 100, 6, 82, -90)}" fill="${g.bevel}"/><polygon points="${polygon(100, 100, 6, 76, -90)}" fill="${g.face}"/>`;
    case 'diamond':
      return `<polygon points="${polygon(100, 100, 4, 94, -90)}" fill="${g.metal}"/><polygon points="${polygon(100, 100, 4, 82, -90)}" fill="${g.bevel}"/><polygon points="${polygon(100, 100, 4, 75, -90)}" fill="${g.face}"/>`;
    case 'compass':
      return `<polygon points="${starPoints(100, 100, 8, 96, 60, -90)}" fill="${g.metal}"/><polygon points="${starPoints(100, 100, 4, 96, 40, -90)}" fill="${g.bevel}"/>
<circle cx="100" cy="100" r="66" fill="${g.metal}"/><circle cx="100" cy="100" r="60" fill="${g.face}"/>`;
    case 'round':
      return `<circle cx="100" cy="100" r="92" fill="${g.metal}"/><circle cx="100" cy="100" r="84" fill="${g.bevel}"/><circle cx="100" cy="100" r="78" fill="${g.metal}"/><circle cx="100" cy="100" r="72" fill="${g.face}"/>
${Array.from({ length: 16 }, (_, i) => {
  const a = (i * 22.5 * Math.PI) / 180;
  return `<circle cx="${f(100 + 88 * Math.cos(a))}" cy="${f(100 + 88 * Math.sin(a))}" r="1.8" fill="${g.face}"/>`;
}).join('')}`;
  }
}

/** Emblema centrado en (100, 96), dibujado con el metal. */
function emblem(kind: BadgeEmblem, fill: string, label: string | null | undefined): string {
  switch (kind) {
    case 'plane':
      // Avión de línea visto desde arriba.
      return `<g transform="translate(100 96) rotate(-35) scale(1.05)" fill="${fill}">
<path d="M0,-38 C4,-38 5,-30 5,-22 L5,-8 L36,8 L36,15 L5,6 L4,24 L13,31 L13,36 L0,32 L-13,36 L-13,31 L-4,24 L-5,6 L-36,15 L-36,8 L-5,-8 L-5,-22 C-5,-30 -4,-38 0,-38 Z"/></g>`;
    case 'globe':
      return `<g transform="translate(100 96)" fill="none" stroke="${fill}" stroke-width="3.2">
<circle r="30"/><ellipse rx="13" ry="30"/><line x1="-30" y1="0" x2="30" y2="0"/><path d="M-26,-15 Q0,-9 26,-15 M-26,15 Q0,9 26,15"/></g>`;
    case 'wings':
      return `<g transform="translate(100 98)" fill="${fill}">
<circle r="9"/><path d="M-9,-3 L-46,-12 L-40,-6 L-50,-5 L-42,0 L-48,3 L-38,4 L-9,5 Z"/><path d="M9,-3 L46,-12 L40,-6 L50,-5 L42,0 L48,3 L38,4 L9,5 Z"/></g>`;
    case 'star':
      return `<polygon points="${starPoints(100, 96, 5, 34, 14)}" fill="${fill}"/>`;
    case 'compass':
      return `<g fill="${fill}"><polygon points="${starPoints(100, 96, 4, 34, 7, -90)}"/><polygon points="${starPoints(100, 96, 4, 20, 5, -45)}" opacity="0.7"/><circle cx="100" cy="96" r="4" fill="${FACE}"/></g>`;
    case 'headset':
      return `<g transform="translate(100 98)" fill="none" stroke="${fill}" stroke-width="5" stroke-linecap="round">
<path d="M-24,4 L-24,-6 A24,24 0 0 1 24,-6 L24,4"/><rect x="-31" y="0" width="12" height="20" rx="4" fill="${fill}" stroke="none"/><rect x="19" y="0" width="12" height="20" rx="4" fill="${fill}" stroke="none"/>
<path d="M-25,20 Q-24,30 -6,30" stroke-width="3"/><circle cx="-4" cy="30" r="3.5" fill="${fill}" stroke="none"/></g>`;
    case 'trophy':
      return `<g transform="translate(100 96)" fill="${fill}">
<path d="M-18,-28 L18,-28 L16,-4 C14,8 6,12 0,12 C-6,12 -14,8 -16,-4 Z"/><path d="M-18,-22 L-28,-22 C-30,-8 -22,-2 -15,-2 L-16,-6 C-20,-7 -24,-11 -23,-17 L-18,-17 Z"/>
<path d="M18,-22 L28,-22 C30,-8 22,-2 15,-2 L16,-6 C20,-7 24,-11 23,-17 L18,-17 Z"/><rect x="-4" y="11" width="8" height="10"/><rect x="-14" y="21" width="28" height="7" rx="2"/></g>`;
    case 'tower':
      return `<g transform="translate(100 100) scale(0.85)" fill="${fill}">
<path d="M-20,-22 L20,-22 L16,-10 L-16,-10 Z"/><rect x="-14" y="-30" width="28" height="6" rx="2"/><rect x="-1.5" y="-38" width="3" height="8"/>
<path d="M-8,-10 L8,-10 L11,30 L-11,30 Z"/><rect x="-18" y="30" width="36" height="5" rx="1.5"/>
<rect x="-14" y="-20" width="5" height="7" fill="${FACE}"/><rect x="-3" y="-20" width="6" height="7" fill="${FACE}"/><rect x="9" y="-20" width="5" height="7" fill="${FACE}"/></g>`;
    case 'number': {
      const text = (label ?? '1').slice(0, 4);
      const size = text.length <= 1 ? 52 : text.length === 2 ? 44 : text.length === 3 ? 36 : 28;
      return `<text x="100" y="${f(96 + size * 0.36)}" text-anchor="middle" font-family="'Arial Black','Segoe UI Black','Arial',sans-serif" font-weight="900" font-size="${size}" fill="${fill}">${esc(text)}</text>`;
    }
  }
}

/** Cinta con texto sobre el tercio inferior. */
function ribbon(text: string, metalFill: string, edgeFill: string, ribbonColor: string, textFill: string): string {
  const t = esc(text.toUpperCase().slice(0, 18));
  const width = 150;
  const fit = text.length > 9 ? ` textLength="${width - 34}" lengthAdjust="spacingAndGlyphs"` : '';
  return `<g>
<path d="M14,134 L34,134 L34,160 L14,160 L22,147 Z" fill="${edgeFill}"/><path d="M186,134 L166,134 L166,160 L186,160 L178,147 Z" fill="${edgeFill}"/>
<rect x="25" y="128" width="${width}" height="30" rx="3" fill="${metalFill}"/><rect x="29" y="131" width="${width - 8}" height="24" rx="2" fill="${ribbonColor}"/>
<text x="100" y="149" text-anchor="middle" font-family="'Arial Narrow','Segoe UI Semibold','Arial',sans-serif" font-weight="700" font-size="16" letter-spacing="1.5" fill="${textFill}"${fit}>${t}</text></g>`;
}

/**
 * La insignia como SVG (200×200). <paramref name="uid"/> hace únicos los
 * degradados cuando hay varias insignias en la misma página.
 */
export function renderBadgeSvg(spec: BadgeSpec, uid = 'b', size = 200): string {
  const m = BADGE_METALS[spec.metal];
  const id = (name: string) => `${uid}-${name}`;
  const metal = `url(#${id('metal')})`;
  const bevel = `url(#${id('bevel')})`;
  const face = `url(#${id('face')})`;
  const hasRibbon = Boolean(spec.ribbon?.trim());
  const top = spec.top?.trim();
  const body = [
    frame(spec.shape, { metal, bevel, face }),
    `<g transform="translate(0 ${hasRibbon ? -8 : 0})">${emblem(spec.emblem, metal, spec.label)}</g>`,
    top
      ? `<text x="100" y="${hasRibbon ? 52 : 56}" text-anchor="middle" font-family="'Arial Narrow','Segoe UI Semibold','Arial',sans-serif" font-weight="700" font-size="11" letter-spacing="2.5" fill="${m.light}" opacity="0.9">${esc(top.toUpperCase().slice(0, 14))}</text>`
      : '',
    hasRibbon ? ribbon(spec.ribbon!.trim(), metal, `url(#${id('edge')})`, spec.ribbonColor || FACE_LIGHT, m.light) : '',
  ].join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="${size}" height="${size}" role="img">
<defs>
<linearGradient id="${id('metal')}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${m.light}"/><stop offset="0.35" stop-color="${m.mid}"/><stop offset="0.55" stop-color="${m.light}"/><stop offset="0.8" stop-color="${m.mid}"/><stop offset="1" stop-color="${m.dark}"/></linearGradient>
<linearGradient id="${id('bevel')}" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${m.edge}"/><stop offset="0.5" stop-color="${m.dark}"/><stop offset="1" stop-color="${m.mid}"/></linearGradient>
<linearGradient id="${id('edge')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${m.dark}"/><stop offset="1" stop-color="${m.edge}"/></linearGradient>
<radialGradient id="${id('face')}" cx="0.4" cy="0.3" r="0.8"><stop offset="0" stop-color="${FACE_LIGHT}"/><stop offset="1" stop-color="${FACE}"/></radialGradient>
<filter id="${id('shadow')}" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000" flood-opacity="0.45"/></filter>
</defs>
<g filter="url(#${id('shadow')})">
${body}
</g>
</svg>`;
}

/** Metal de un entrenamiento según su nivel: básico bronce, intermedio plata, avanzado oro. */
export function trainingMetal(level: 'basic' | 'intermediate' | 'advanced'): BadgeMetal {
  return level === 'advanced' ? 'gold' : level === 'intermediate' ? 'silver' : 'bronze';
}

/** Metal del podio de un evento (1.º oro, 2.º plata, 3.º bronce); null fuera del podio. */
export function podiumMetal(position: number): BadgeMetal | null {
  return position === 1 ? 'gold' : position === 2 ? 'silver' : position === 3 ? 'bronze' : null;
}

export interface BadgePreset {
  id: string;
  name: string;
  /** Para qué se recomienda. */
  use: string;
  shape: BadgeShape;
  emblem: BadgeEmblem;
}

/** Biblioteca: cada diseño existe en oro, plata y bronce. */
export const BADGE_PRESETS: BadgePreset[] = [
  { id: 'cruise', name: 'Crucero', use: 'Tours de ruta', shape: 'seal', emblem: 'plane' },
  { id: 'explorer', name: 'Explorador', use: 'Tours largos o internacionales', shape: 'laurel', emblem: 'globe' },
  { id: 'captain', name: 'Capitán', use: 'Tours de flota o de carrera', shape: 'wings', emblem: 'star' },
  { id: 'aviator', name: 'Aviador', use: 'Primer tour o bienvenida', shape: 'round', emblem: 'wings' },
  { id: 'navigator', name: 'Navegante', use: 'Tours de aeropuertos difíciles', shape: 'compass', emblem: 'compass' },
  { id: 'instructor', name: 'Instrucción', use: 'Entrenamientos', shape: 'hexagon', emblem: 'headset' },
  { id: 'champion', name: 'Campeón', use: 'Ganadores de eventos', shape: 'laurel', emblem: 'trophy' },
  { id: 'podium', name: 'Podio', use: 'Lugares 1.º, 2.º y 3.º de un evento', shape: 'round', emblem: 'number' },
  { id: 'tower', name: 'Torre', use: 'Eventos con ATC o fly-ins', shape: 'diamond', emblem: 'tower' },
  { id: 'star', name: 'Estrella', use: 'Hitos y reconocimientos', shape: 'shield', emblem: 'star' },
  { id: 'route', name: 'Ruta', use: 'Tours regionales', shape: 'shield', emblem: 'plane' },
  { id: 'globe-seal', name: 'Mundo', use: 'Vuelta al mundo', shape: 'seal', emblem: 'globe' },
  { id: 'centurion', name: 'Centurión', use: 'Metas de 100 vuelos u horas', shape: 'compass', emblem: 'number' },
];

/** Una insignia lista para un tour, entrenamiento o evento a partir de un diseño de la biblioteca. */
export function presetSpec(preset: BadgePreset, metal: BadgeMetal, ribbonText?: string | null, label?: string | null): BadgeSpec {
  return { shape: preset.shape, emblem: preset.emblem, metal, ribbon: ribbonText ?? null, top: 'LAM', label: label ?? null };
}

/** SVG a data URL (para <img>). */
export function badgeDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
