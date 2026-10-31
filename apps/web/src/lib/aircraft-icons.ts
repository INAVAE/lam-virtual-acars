/**
 * Siluetas de avión para el mapa en vivo, vistas desde arriba con la nariz hacia
 * arriba (viewBox 0 0 24 24). Hay una por categoría y el tamaño crece con el avión,
 * para distinguir de un vistazo un monomotor de un 737 o de un A380. Son dibujos
 * propios, sin copiar íconos de otras redes.
 */
export type MapCategory = 'light' | 'business_jet' | 'turboprop' | 'regional_jet' | 'narrowbody' | 'widebody' | 'jumbo';

export const MAP_CATEGORIES: readonly MapCategory[] = ['light', 'business_jet', 'turboprop', 'regional_jet', 'narrowbody', 'widebody', 'jumbo'];

export const MAP_CATEGORY_LABELS: Record<MapCategory, string> = {
  light: 'Ligero (hélice)',
  business_jet: 'Jet ejecutivo',
  turboprop: 'Turbohélice',
  regional_jet: 'Jet regional',
  narrowbody: 'Pasillo único (737, A320)',
  widebody: 'Fuselaje ancho (777, 787, A350)',
  jumbo: 'Cuatrimotor (747, A380)',
};

/** Tamaño de la figura en el mapa (px). */
export const MAP_CATEGORY_SIZE: Record<MapCategory, number> = {
  light: 18,
  business_jet: 20,
  turboprop: 23,
  regional_jet: 25,
  narrowbody: 28,
  widebody: 33,
  jumbo: 37,
};

// Fuselaje y alas de cada figura; los motores van aparte para dibujarlos con otro tono.
const BODY: Record<MapCategory, string> = {
  light:
    'M12 3c.5 0 .9.5.9 1.1v3.5h8.3v1.8l-8.3.5-.5 7.4 2.9 1.2v1.3l-3.3-.5-.4 1.1h-.2l-.4-1.1-3.3.5v-1.3l2.9-1.2-.5-7.4-8.3-.5V7.6h8.3V4.1c0-.6.4-1.1.9-1.1z',
  business_jet:
    'M12 2.5c.5 0 1 .6 1 1.3v6.5l5.6 3.7v1.6l-5.6-1.6v3.6l2.4 1.4v1.3l-3.4-.8-3.4.8v-1.3l2.4-1.4v-3.6l-5.6 1.6V14l5.6-3.7V3.8c0-.7.5-1.3 1-1.3z',
  turboprop:
    'M12 2.5c.7 0 1.2.6 1.2 1.4v4.4h8.6v2.1l-8.6.6v6.8l3 1.4v1.4l-3.4-.6L12 21.5l-.8-1.5-3.4.6v-1.4l3-1.4v-6.8l-8.6-.6V8.3h8.6V3.9c0-.8.5-1.4 1.2-1.4z',
  regional_jet:
    'M12 2c.6 0 1.1.6 1.1 1.4v6l6.4 4v1.7l-6.4-1.9v4.2l2 1.5v1.4L12 21.3l-3.1 1v-1.4l2-1.5v-4.2l-6.4 1.9v-1.7l6.4-4v-6C10.9 2.6 11.4 2 12 2z',
  narrowbody:
    'M12 2c.8 0 1.4.7 1.4 1.6v5.6l7.6 4.4v2l-7.6-2.3v4.6l2.2 1.7v1.6L12 20.1l-3.6 1.1v-1.6l2.2-1.7v-4.6L3 15.6v-2l7.6-4.4V3.6C10.6 2.7 11.2 2 12 2z',
  widebody:
    'M12 1.5c1.1 0 1.9.8 1.9 2v5.4l8.6 5v2.2l-8.6-2.4v4.6l2.6 1.9v1.7L12 20.6l-4.5 1.3v-1.7l2.6-1.9v-4.6l-8.6 2.4v-2.2l8.6-5V3.5c0-1.2.8-2 1.9-2z',
  jumbo:
    'M12 1.2c1.2 0 2.1.9 2.1 2.2v5.3l8.6 5.1v2.2l-8.6-2.4v4.7l2.7 1.9v1.8L12 20.8l-4.8 1.2v-1.8l2.7-1.9v-4.7l-8.6 2.4V13.8l8.6-5.1V3.4c0-1.3.9-2.2 2.1-2.2z',
};

const ENGINES: Record<MapCategory, string> = {
  light: 'M9.6 2.3h4.8v.7H9.6z',
  business_jet: 'M9.5 14.2h1.3v2.4H9.5zM13.2 14.2h1.3v2.4h-1.3z',
  turboprop: 'M6.6 6.6h1.6v4.2H6.6zM15.8 6.6h1.6v4.2h-1.6zM5.2 6.2h4.4v.6H5.2zM14.4 6.2h4.4v.6h-4.4z',
  regional_jet: 'M9.4 14.6h1.2v2.6H9.4zM13.4 14.6h1.2v2.6h-1.2z',
  narrowbody: 'M6.4 12.2h1.4v2.2H6.4zM16.2 12.2h1.4v2.2h-1.4z',
  widebody: 'M5.9 11.6h1.8v2.8H5.9zM16.3 11.6h1.8v2.8h-1.8z',
  jumbo: 'M4.2 13.4h1.4v2.2H4.2zM7.4 11.5h1.6v2.4H7.4zM15 11.5h1.6v2.4H15zM18.4 13.4h1.4v2.2h-1.4z',
};

export function mapCategory(value: string | null | undefined): MapCategory {
  return MAP_CATEGORIES.includes(value as MapCategory) ? (value as MapCategory) : 'narrowbody';
}

/** SVG de la figura con el color de relleno dado (fase, evento o tour). */
export function aircraftSvg(category: string | null | undefined, color = 'currentColor'): string {
  const c = mapCategory(category);
  const size = MAP_CATEGORY_SIZE[c];
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">` +
    `<path d="${BODY[c]}" fill="${color}" stroke="#0b1220" stroke-width="0.8" stroke-linejoin="round"/>` +
    `<path d="${ENGINES[c]}" fill="#0b1220" opacity="0.75"/>` +
    `</svg>`
  );
}

/**
 * Categoría por omisión a partir de los datos del tipo. Es la misma regla que
 * private.default_map_category en la base, para mostrarla en el formulario.
 */
export function defaultMapCategory(icao: string, wake: string, engine: string, maxPassengers: number | null | undefined): MapCategory {
  const pax = maxPassengers ?? null;
  if (engine === 'piston') return 'light';
  if (engine === 'turboprop') return wake === 'L' || (pax ?? 0) < 20 ? 'light' : 'turboprop';
  if (wake === 'J' || /^(B74|A34|A38|IL96|IL76|C5|A124|A225)/.test(icao)) return 'jumbo';
  if (wake === 'H') return 'widebody';
  if (wake === 'L' || (pax ?? 999) < 20) return 'business_jet';
  if ((pax ?? 999) <= 110) return 'regional_jet';
  return 'narrowbody';
}
