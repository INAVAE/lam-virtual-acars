// Genera el manual de uso en PDF con el mismo contenido de la ayuda de la web.
//
// Fuente única: apps/web/src/content/help-content.ts (capítulos, preguntas
// frecuentes, fallas y novedades). Las capturas las toma scripts/visual-check.mjs
// (las que empiezan con «m-», con su .marks.json de elementos numerados).
//
// Uso (Node 22):
//   node --experimental-strip-types scripts/build-manual.mjs \
//     --content apps/web/src/content/help-content.ts \
//     --shots visual-screenshots --out apps/web/dist/manual/Manual-LAM-Virtual-ACARS.pdf \
//     --version 123-abc1234 --root .
//
// Si falta una captura, el capítulo sale sin imagen: el manual nunca deja de
// generarse por una pantalla.

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith('--') ? [...acc, [v.slice(2), all[i + 1]]] : acc), []),
);
const ROOT = resolve(args.root ?? '.');
const CONTENT = resolve(args.content ?? join(ROOT, 'apps/web/src/content/help-content.ts'));
const SHOTS = resolve(args.shots ?? 'visual-screenshots');
const OUT = resolve(args.out ?? 'Manual-LAM-Virtual-ACARS.pdf');
const VERSION = args.version ?? 'desarrollo';
const SITE = args.site ?? 'https://inavae.github.io/lam-virtual-acars/';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
}

const help = await import(pathToFileURL(CONTENT).href);
const { HELP_CHAPTERS, HELP_FAQ, HELP_TROUBLESHOOTING, MANUAL_CHANGES, MANUAL_UPDATED, MANUAL_TITLE, audienceLabels } = help;

// -----------------------------------------------------------------------------
// Recursos
// -----------------------------------------------------------------------------
const esc = (s) =>
  String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

function dataUri(path, type) {
  return existsSync(path) ? `data:${type};base64,${readFileSync(path).toString('base64')}` : null;
}

function fontFace(family, pkg, file, weight) {
  const path = join(ROOT, 'apps/web/node_modules/@fontsource', pkg, 'files', file);
  const uri = dataUri(path, 'font/woff2');
  return uri ? `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;src:url(${uri}) format('woff2');}` : '';
}

const fonts = [
  fontFace('Barlow', 'barlow', 'barlow-latin-400-normal.woff2', 400),
  fontFace('Barlow', 'barlow', 'barlow-latin-500-normal.woff2', 500),
  fontFace('Barlow', 'barlow', 'barlow-latin-600-normal.woff2', 600),
  fontFace('Barlow Semi Condensed', 'barlow-semi-condensed', 'barlow-semi-condensed-latin-600-normal.woff2', 600),
  fontFace('IBM Plex Mono', 'ibm-plex-mono', 'ibm-plex-mono-latin-400-normal.woff2', 400),
].join('');

const logo = dataUri(join(ROOT, 'apps/web/public/apple-touch-icon.png'), 'image/png');

function readMarks(file) {
  const path = join(SHOTS, `${file}.marks.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// HTML
// -----------------------------------------------------------------------------
function figure(shot, images) {
  const img = images.get(shot.file);
  if (!img) return '';
  const meta = readMarks(shot.file);
  const legend = shot.marks ?? [];
  const pins = (meta?.marks ?? [])
    .map((box, i) => {
      if (!box || !meta.width || !meta.height || i >= legend.length) return '';
      const inside = box.x < meta.width && box.y < meta.height && box.x + box.w > 0 && box.y + box.h > 0;
      if (!inside) return '';
      const left = (Math.max(box.x, 0) / meta.width) * 100;
      const top = (Math.max(box.y, 0) / meta.height) * 100;
      const w = (Math.min(box.w, meta.width - Math.max(box.x, 0)) / meta.width) * 100;
      const h = (Math.min(box.h, meta.height - Math.max(box.y, 0)) / meta.height) * 100;
      return `<span class="box" style="left:${left}%;top:${top}%;width:${w}%;height:${h}%"></span><span class="pin" style="left:${left}%;top:${top}%">${i + 1}</span>`;
    })
    .join('');
  const legendHtml = legend.length
    ? `<p class="legend"><b>En la imagen:</b> ${legend.map((t, i) => `<span><i>${i + 1}</i>${esc(t)}</span>`).join('')}</p>`
    : '';
  return `<figure><div class="shot"><img src="${img}" alt="">${pins}</div><figcaption>${esc(shot.caption)}</figcaption>${legendHtml}</figure>`;
}

function chapter(c, n, images) {
  const steps = c.steps.map(([t, d]) => `<li><b>${esc(t)}.</b> ${esc(d)}</li>`).join('');
  const who = c.audience !== 'all' ? `<span class="who">${esc(audienceLabels[c.audience])}</span>` : '';
  return `<section class="chapter${c.shot && images.has(c.shot.file) ? ' with-shot' : ''}" id="${esc(c.id)}">
    <h2><span class="n">${n}</span>${esc(c.title)}${who}</h2>
    <p class="summary">${esc(c.summary)}</p>
    ${c.shot ? figure(c.shot, images) : ''}
    <ol class="steps">${steps}</ol>
    ${c.note ? `<p class="note"><b>Ten en cuenta.</b> ${esc(c.note)}</p>` : ''}
  </section>`;
}

function buildHtml(images) {
  const nFaq = HELP_CHAPTERS.length + 1;
  const nFix = HELP_CHAPTERS.length + 2;
  const nNews = HELP_CHAPTERS.length + 3;
  const toc = [
    ...HELP_CHAPTERS.map((c, i) => [i + 1, c.title, c.audience !== 'all' ? audienceLabels[c.audience] : '']),
    [nFaq, 'Preguntas frecuentes', ''],
    [nFix, 'Si algo falla', ''],
    [nNews, 'Novedades', ''],
  ]
    .map(([n, t, a]) => `<li><span class="n">${n}</span><span class="t">${esc(t)}</span><span class="a">${esc(a)}</span></li>`)
    .join('');

  const faq = HELP_FAQ.map(([q, a]) => `<div class="qa"><p class="q">${esc(q)}</p><p>${esc(a)}</p></div>`).join('');
  const fixes = HELP_TROUBLESHOOTING.map(([s, c, f]) => `<tr><td><b>${esc(s)}</b></td><td class="muted">${esc(c)}</td><td>${esc(f)}</td></tr>`).join('');
  const news = MANUAL_CHANGES.map(([d, t]) => `<tr><td class="mono">${esc(d)}</td><td>${esc(t)}</td></tr>`).join('');
  const generated = new Date().toISOString().slice(0, 10);

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(MANUAL_TITLE)}</title><style>
${fonts}
@page { size: Letter; margin: 0.75in 0.75in 0.8in; }
* { box-sizing: border-box; }
:root { --ink:#0f172a; --muted:#475569; --line:#cbd5e1; --accent:#0e7490; --warn-bg:#fff7e6; --warn-line:#f2c46d; --pin:#ea580c; }
html { font-family: 'Barlow', 'Liberation Sans', 'DejaVu Sans', Arial, sans-serif; font-size: 10.5pt; color: var(--ink); line-height: 1.45; }
h1, h2, h3 { font-family: 'Barlow Semi Condensed', 'Barlow', sans-serif; font-weight: 600; line-height: 1.15; }
.mono { font-family: 'IBM Plex Mono', 'DejaVu Sans Mono', monospace; font-size: 9pt; }
.muted { color: var(--muted); }
/* Portada */
.cover { height: 9.4in; display: flex; flex-direction: column; justify-content: space-between; break-after: page; }
.cover .brand { display: flex; align-items: center; gap: 14px; }
.cover .brand img { width: 64px; height: 64px; border-radius: 12px; }
.cover .brand span { font: 600 13pt 'Barlow Semi Condensed', sans-serif; letter-spacing: .08em; color: var(--accent); text-transform: uppercase; }
.cover h1 { font-size: 40pt; margin: 28px 0 12px; }
.cover .lead { font-size: 13pt; color: var(--muted); max-width: 5.4in; }
.cover .meta { border-top: 1px solid var(--line); padding-top: 12px; font-size: 9.5pt; color: var(--muted); }
.cover .meta b { color: var(--ink); }
.cover .bar { height: 6px; background: linear-gradient(90deg, #0e7490, #22d3ee); border-radius: 3px; }
/* Índice */
.toc { break-after: page; }
.toc h2, .section-title { font-size: 18pt; border-bottom: 1.5px solid var(--ink); padding-bottom: 6px; margin: 0 0 14px; }
.toc ol { list-style: none; padding: 0; margin: 0; }
.toc li { display: grid; grid-template-columns: 2.2em 1fr auto; gap: 8px; padding: 6px 0; border-bottom: 1px solid #e2e8f0; }
.toc .n { color: var(--accent); font-weight: 600; }
.toc .a { color: var(--muted); font-size: 9pt; }
.toc .foot { margin-top: 18px; color: var(--muted); font-size: 9.5pt; }
/* Capítulos */
.chapter { break-inside: avoid-page; margin-bottom: 26px; }
.chapter.with-shot { break-before: page; }
.toc + .chapter.with-shot { break-before: auto; }
.chapter h2 { font-size: 16pt; margin: 0 0 4px; border-bottom: 1.5px solid var(--ink); padding-bottom: 6px; display: flex; align-items: baseline; gap: 10px; }
.chapter h2 .n { color: var(--accent); min-width: 1.4em; }
.who { margin-left: auto; font: 500 8.5pt 'Barlow', sans-serif; color: var(--accent); border: 1px solid var(--accent); border-radius: 3px; padding: 1px 6px; }
.summary { color: var(--muted); margin: 6px 0 10px; }
.steps { padding-left: 1.3em; margin: 10px 0; }
.steps li { margin: 5px 0; }
.note { background: var(--warn-bg); border: 1px solid var(--warn-line); border-radius: 4px; padding: 8px 10px; font-size: 9.5pt; margin: 10px 0 0; }
figure { margin: 8px 0 10px; break-inside: avoid; }
.shot { position: relative; border: 1px solid var(--line); border-radius: 4px; overflow: hidden; line-height: 0; max-width: 100%; }
.shot img { width: 100%; display: block; max-height: 5.6in; object-fit: contain; object-position: top left; }
.box { position: absolute; border: 2px solid var(--pin); border-radius: 3px; }
.pin { position: absolute; transform: translate(-45%, -45%); width: 20px; height: 20px; border-radius: 50%; background: var(--pin); color: #fff; font: 600 10pt/20px 'Barlow', sans-serif; text-align: center; box-shadow: 0 0 0 2px #fff; }
figcaption { font-size: 9pt; color: var(--muted); margin-top: 4px; }
.legend { font-size: 9pt; margin: 4px 0 0; display: flex; flex-wrap: wrap; gap: 4px 14px; }
.legend i { font-style: normal; display: inline-block; width: 15px; height: 15px; border-radius: 50%; background: var(--pin); color: #fff; font-weight: 600; font-size: 8pt; line-height: 15px; text-align: center; margin-right: 4px; }
/* Preguntas, fallas, novedades */
.part { break-before: page; }
.qa { break-inside: avoid; padding: 7px 0; border-bottom: 1px solid #e2e8f0; }
.qa p { margin: 0; }
.qa .q { font-weight: 600; margin-bottom: 2px; }
table { width: 100%; border-collapse: collapse; font-size: 9.2pt; }
th { text-align: left; font-weight: 600; border-bottom: 1.5px solid var(--ink); padding: 5px 6px; }
td { vertical-align: top; border-bottom: 1px solid #e2e8f0; padding: 6px; }
tr { break-inside: avoid; }
.kv td:first-child { color: var(--muted); width: 40%; }
.kv td:last-child { font-weight: 600; }
</style></head><body>

<section class="cover">
  <div>
    <div class="brand">${logo ? `<img src="${logo}" alt="">` : ''}<span>LAM Virtual ACARS</span></div>
    <h1>Manual de uso</h1>
    <p class="lead">Del primer ingreso al vuelo con LAM ACARS y la administración de la aerolínea, con preguntas frecuentes, diagnóstico de fallas y reporte de incidencias.</p>
  </div>
  <div>
    <div class="bar"></div>
    <p class="meta"><b>Líneas Aéreas Mexicanas · operaciones virtuales para Microsoft Flight Simulator 2024</b><br>
    Contenido actualizado el ${esc(MANUAL_UPDATED)} · versión de la web ${esc(VERSION)} · generado el ${generated}<br>
    ${esc(SITE)}<br>
    Proyecto de simulación. Las aerolíneas basadas en marcas reales son operaciones virtuales no oficiales y no tienen relación con esas compañías.</p>
  </div>
</section>

<section class="toc">
  <h2>Qué hay en este manual</h2>
  <ol>${toc}</ol>
  <p class="foot">Este mismo contenido se consulta dentro de la web, en el botón de ayuda (?) de la barra superior. Desde ahí también se descarga este PDF y se reportan fallas, mejoras o dudas, que llegan con folio a quien las atiende. Las capturas se toman de la web con datos de ejemplo.</p>
</section>

${HELP_CHAPTERS.map((c, i) => chapter(c, i + 1, images)).join('\n')}

<section class="part">
  <h2 class="section-title"><span style="color:var(--accent)">${nFaq}</span>&nbsp; Preguntas frecuentes</h2>
  ${faq}
</section>

<section class="part">
  <h2 class="section-title"><span style="color:var(--accent)">${nFix}</span>&nbsp; Si algo falla</h2>
  <p class="summary">Busca el síntoma, no la causa: la causa viene explicada.</p>
  <table><thead><tr><th style="width:27%">Qué ves</th><th style="width:33%">Por qué pasa</th><th>Cómo se arregla</th></tr></thead><tbody>${fixes}</tbody></table>
  <p class="note"><b>Si nada de esto lo resuelve.</b> Repórtalo en Ayuda → Reportar una incidencia, con la pantalla, lo que pulsaste y lo que apareció. Si es del conector, agrega el folio del PIREP y la bitácora de %LOCALAPPDATA%\\LamAcars\\logs.</p>
</section>

<section class="part">
  <h2 class="section-title"><span style="color:var(--accent)">${nNews}</span>&nbsp; Novedades</h2>
  <p class="summary">Cambios de la plataforma que modificaron este manual, el más reciente primero.</p>
  <table><tbody>${news}</tbody></table>

  <h2 class="section-title" style="margin-top:28px">Soporte y datos del sistema</h2>
  <table class="kv"><tbody>
    <tr><td>Dirección de la web</td><td>${esc(SITE)}</td></tr>
    <tr><td>Descarga del conector LAM ACARS</td><td>github.com/INAVAE/lam-virtual-acars/releases</td></tr>
    <tr><td>Versión de la web</td><td>${esc(VERSION)}</td></tr>
    <tr><td>Contenido del manual</td><td>${esc(MANUAL_UPDATED)}</td></tr>
    <tr><td>Reportar una falla, mejora o duda</td><td>Ayuda → Reportar una incidencia (folio INC)</td></tr>
    <tr><td>Bitácora del conector</td><td>%LOCALAPPDATA%\\LamAcars\\logs</td></tr>
    <tr><td>Clima</td><td>NOAA Aviation Weather Center</td></tr>
    <tr><td>Mapa y regiones de control</td><td>OpenStreetMap · VATSpy Data Project (CC BY-SA 4.0) · IVAO (datos públicos) · RainViewer</td></tr>
  </tbody></table>
  <p class="note"><b>Sobre este documento.</b> Se genera en cada publicación del sitio a partir del mismo texto que muestra la ayuda dentro de la web, así que los dos dicen siempre lo mismo. Todo es para simulación.</p>
</section>
</body></html>`;
}

// -----------------------------------------------------------------------------
// PDF
// -----------------------------------------------------------------------------
const browser = await chromium.launch();
try {
  const page = await browser.newPage();

  // Las capturas se recomprimen como JPEG para que el PDF pese poco.
  const images = new Map();
  for (const c of HELP_CHAPTERS) {
    if (!c.shot) continue;
    const path = join(SHOTS, `${c.shot.file}.png`);
    if (!existsSync(path)) {
      console.log(`::warning title=Manual::Falta la captura ${c.shot.file}; el capítulo «${c.title}» sale sin imagen`);
      continue;
    }
    const png = `data:image/png;base64,${readFileSync(path).toString('base64')}`;
    const jpeg = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.86);
    }, png);
    images.set(c.shot.file, jpeg);
  }

  await page.setContent(buildHtml(images), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  mkdirSync(dirname(OUT), { recursive: true });
  await page.pdf({
    path: OUT,
    format: 'Letter',
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `<div style="width:100%;font-size:7.5pt;color:#64748b;padding:0 0.75in;display:flex;justify-content:space-between;font-family:Arial,sans-serif"><span>LAM Virtual ACARS · Manual de uso · ${esc(MANUAL_UPDATED)}</span><span class="pageNumber"></span></div>`,
    margin: { top: '0.7in', bottom: '0.75in', left: '0.75in', right: '0.75in' },
  });
  console.log(`Manual generado: ${OUT} (${images.size} capturas)`);
} finally {
  await browser.close();
}
