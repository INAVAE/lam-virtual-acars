import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * GitHub Pages no permite cabeceras HTTP propias: la Content Security Policy
 * se inyecta como <meta> solo en el build (en desarrollo Vite usa scripts
 * en línea que la política bloquearía). `frame-ancestors` no se incluye: los
 * navegadores lo ignoran cuando llega por <meta> y solo funciona como cabecera.
 */
/** Origen de la plantilla de teselas del mapa ({s} se vuelve comodín de subdominio). */
function tileOrigin(template: string): string {
  try {
    const host = new URL(template.replace(/\{s\}\./, 'sub.').replace(/\{[^}]+\}/g, '0')).origin;
    return template.includes('{s}.') ? host.replace('://sub.', '://*.') : host;
  } catch {
    return '';
  }
}

function contentSecurityPolicy(supabaseUrl: string, tileUrl: string): Plugin {
  let supabaseOrigin = '';
  try {
    supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : '';
  } catch {
    supabaseOrigin = '';
  }
  const realtimeOrigin = supabaseOrigin.replace(/^https:/, 'wss:');
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    // Teselas del mapa del PIREP (OpenStreetMap por omisión).
    `img-src 'self' data: blob: ${supabaseOrigin} ${tileOrigin(tileUrl)}`.trim(),
    `connect-src 'self' ${supabaseOrigin} ${realtimeOrigin}`.trim(),
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');

  return {
    name: 'lam-content-security-policy',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      );
    },
  };
}

/** Copia index.html como 404.html para que GitHub Pages sirva las rutas profundas. */
function spaFallback(): Plugin {
  let outDir = 'dist';
  return {
    name: 'lam-spa-fallback',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      copyFileSync(resolve(outDir, 'index.html'), resolve(outDir, '404.html'));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const base = env.VITE_BASE_PATH || '/';

  return {
    base: base.endsWith('/') ? base : `${base}/`,
    plugins: [react(), tailwindcss(), contentSecurityPolicy(env.VITE_SUPABASE_URL ?? '', env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'), spaFallback()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    build: {
      sourcemap: true,
      target: 'es2022',
    },
  };
});
