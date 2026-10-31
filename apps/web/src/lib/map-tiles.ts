/**
 * Mapa base del PIREP. Por omisión usa las teselas estándar de OpenStreetMap,
 * respetando su política de uso (https://operations.osmfoundation.org/policies/tiles/):
 * - atribución visible en el mapa con enlace a https://www.openstreetmap.org/copyright (ODbL);
 * - el navegador envía Referer (política strict-origin-when-cross-origin) y su User-Agent;
 * - sin descargas masivas, precarga ni cabeceras no-cache; las pruebas automáticas no piden teselas.
 * Si el tráfico crece, se cambia a un proveedor propio o comercial con VITE_MAP_TILE_URL y
 * VITE_MAP_ATTRIBUTION (la CSP se ajusta sola al origen de la URL).
 */
export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

export interface MapTileConfig {
  url: string;
  attribution: string;
  maxZoom: number;
}

export function mapTileConfig(env: Readonly<Record<string, unknown>> = import.meta.env): MapTileConfig {
  const url = typeof env.VITE_MAP_TILE_URL === 'string' && env.VITE_MAP_TILE_URL.trim() ? env.VITE_MAP_TILE_URL.trim() : OSM_TILE_URL;
  const custom = typeof env.VITE_MAP_ATTRIBUTION === 'string' ? env.VITE_MAP_ATTRIBUTION.trim() : '';
  // Con teselas propias de datos OSM la atribución a OpenStreetMap sigue siendo obligatoria.
  const attribution = url === OSM_TILE_URL || !custom ? OSM_ATTRIBUTION : custom;
  return { url, attribution, maxZoom: 19 };
}

/** Origen (para la CSP) de una plantilla de teselas: {s} se vuelve comodín de subdominio. */
export function tileOrigin(template: string): string {
  try {
    const host = new URL(template.replace(/\{s\}\./, 'sub.').replace(/\{[^}]+\}/g, '0')).origin;
    return template.includes('{s}.') ? host.replace('://sub.', '://*.') : host;
  } catch {
    return '';
  }
}
