const HEX = /^#([0-9a-f]{6})$/i;

export const DEFAULT_ACCENT = '#2563EB';
const DARK_TEXT = '#0B1220';
const LIGHT_TEXT = '#FFFFFF';

export function isHexColor(value: string): boolean {
  return HEX.test(value);
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Luminancia relativa WCAG 2.x. */
export function relativeLuminance(hex: string): number {
  const match = HEX.exec(hex);
  if (!match?.[1]) throw new Error(`Color inválido: ${hex}`);
  const n = Number.parseInt(match[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Texto (blanco o tinta oscura) con mejor contraste sobre el color dado. */
export function readableTextOn(background: string): string {
  return contrastRatio(background, LIGHT_TEXT) >= contrastRatio(background, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT;
}

/** Acento seguro: si el color de la aerolínea no es válido, usa el azul LAM. */
export function safeAccent(color: string | null | undefined): string {
  return color && isHexColor(color) ? color : DEFAULT_ACCENT;
}
