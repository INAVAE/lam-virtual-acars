/** URL absoluta dentro del sitio, respetando la ruta base de GitHub Pages. */
export function appUrl(path: string): string {
  const base = import.meta.env.BASE_URL;
  const clean = path.replace(/^\/+/, '');
  return new URL(`${base}${clean}`, window.location.origin).toString();
}
