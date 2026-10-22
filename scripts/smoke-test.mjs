// Prueba de humo del sitio publicado.
// Uso: SITE_URL=https://inavae.github.io/lam-virtual-acars/ node scripts/smoke-test.mjs
// Requiere el paquete `playwright` con Chromium instalado.
// Escribe capturas en ./smoke-screenshots y anotaciones de GitHub Actions.

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const SITE = (process.env.SITE_URL ?? '').replace(/\/?$/, '/');
if (!SITE.startsWith('http')) {
  console.error('Define SITE_URL');
  process.exit(2);
}
const OUT = 'smoke-screenshots';
mkdirSync(OUT, { recursive: true });

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const line = `${name}${detail ? `: ${detail}` : ''}`;
  console.log(ok ? `::notice title=OK::${line}` : `::error title=FALLA::${line}`);
}

async function check(name, fn) {
  try {
    const detail = await fn();
    record(name, true, typeof detail === 'string' ? detail : '');
  } catch (error) {
    record(name, false, String(error?.message ?? error).split('\n')[0]);
  }
}

const browser = await chromium.launch();

async function openPage(viewport, colorScheme = 'dark') {
  const context = await browser.newContext({ viewport, colorScheme, locale: 'es-MX' });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`consola: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`excepción: ${err.message}`));
  const supabase = [];
  page.on('response', (res) => {
    if (res.url().includes('.supabase.co')) supabase.push({ url: res.url(), status: res.status() });
  });
  return { context, page, problems, supabase };
}

const desktop = { width: 1440, height: 900 };
const mobile = { width: 390, height: 844 };

// 1. Raíz sin sesión: debe llevar a la página pública.
await check('La raíz redirige a la bienvenida sin sesión', async () => {
  const { context, page, problems, supabase } = await openPage(desktop);
  await page.goto(SITE, { waitUntil: 'networkidle' });
  await page.waitForURL(/\/bienvenida$/, { timeout: 15000 });
  await page.getByRole('heading', { level: 1 }).waitFor();
  const h1 = (await page.getByRole('heading', { level: 1 }).innerText()).replace(/\s+/g, ' ');
  if (!h1.includes('Líneas Aéreas Mexicanas')) throw new Error(`Título inesperado: ${h1}`);
  await page.getByRole('heading', { name: 'Aerolíneas en operación' }).waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/01-bienvenida-escritorio.png`, fullPage: true });
  const airlines = supabase.find((r) => r.url.includes('/rest/v1/airlines'));
  if (!airlines) throw new Error('No hubo consulta a Supabase por aerolíneas');
  if (airlines.status !== 200) throw new Error(`Supabase respondió ${airlines.status} a la consulta de aerolíneas`);
  if (problems.length) throw new Error(problems.join(' | '));
  await context.close();
  return `Supabase respondió ${airlines.status}`;
});

// 2. Ruta profunda cargada directamente (fallback 404.html de Pages).
await check('La ruta profunda /registro carga directamente', async () => {
  const { context, page, problems } = await openPage(desktop);
  await page.goto(`${SITE}registro`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Crear cuenta de piloto' }).waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${OUT}/02-registro-escritorio.png`, fullPage: true });
  if (problems.length) throw new Error(problems.join(' | '));
  await context.close();
});

// 3. Validación del formulario de registro sin enviar nada al servidor.
await check('El registro valida contraseñas distintas', async () => {
  const { context, page } = await openPage(desktop);
  await page.goto(`${SITE}registro`, { waitUntil: 'networkidle' });
  await page.getByLabel('Nombre para mostrar').fill('Prueba');
  await page.getByLabel('Correo').fill('nadie@example.com');
  await page.getByLabel('Contraseña', { exact: true }).fill('cabina2024');
  await page.getByLabel('Repite la contraseña').fill('otra2024');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await page.getByText('Las contraseñas no coinciden').waitFor({ timeout: 5000 });
  await context.close();
});

// 4. Inicio de sesión con credenciales falsas: comprueba que Supabase Auth responde.
await check('Supabase Auth rechaza credenciales inválidas con un mensaje claro', async () => {
  const { context, page, problems, supabase } = await openPage(desktop);
  await page.goto(`${SITE}entrar`, { waitUntil: 'networkidle' });
  await page.getByLabel('Correo').fill('smoke-test@example.invalid');
  await page.getByLabel('Contraseña').fill('NoEsReal2024');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.getByText('Correo o contraseña incorrectos.').waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${OUT}/03-entrar-error.png`, fullPage: true });
  const token = supabase.find((r) => r.url.includes('/auth/v1/token'));
  if (!token) throw new Error('No hubo llamada a Supabase Auth');
  // El 400 de Auth se registra como error de red en consola; no es un fallo de la app.
  const real = problems.filter((p) => !/status of 400/.test(p));
  if (real.length) throw new Error(real.join(' | '));
  await context.close();
  return `Auth respondió ${token.status}`;
});

// 5. Ruta inexistente.
await check('Una ruta inexistente muestra la página 404', async () => {
  const { context, page } = await openPage(desktop);
  await page.goto(`${SITE}esta-ruta-no-existe`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Esta página no existe' }).waitFor({ timeout: 15000 });
  await context.close();
});

// 6. Ruta protegida sin sesión: debe pedir inicio de sesión.
await check('Settings sin sesión lleva a iniciar sesión', async () => {
  const { context, page } = await openPage(desktop);
  await page.goto(`${SITE}settings`, { waitUntil: 'networkidle' });
  await page.waitForURL(/\/entrar$/, { timeout: 15000 });
  await context.close();
});

// 7. Política de seguridad de contenido presente.
await check('El sitio publica una Content Security Policy', async () => {
  const { context, page } = await openPage(desktop);
  await page.goto(`${SITE}bienvenida`, { waitUntil: 'domcontentloaded' });
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  if (!csp || !csp.includes('fnsfgjtmwfiizofsjajm.supabase.co')) throw new Error(`CSP inesperada: ${csp}`);
  await context.close();
});

// 8. Vista móvil y modo claro, para revisión visual.
await check('Capturas en móvil y modo claro', async () => {
  const m = await openPage(mobile);
  await m.page.goto(`${SITE}bienvenida`, { waitUntil: 'networkidle' });
  await m.page.waitForTimeout(1000);
  await m.page.screenshot({ path: `${OUT}/04-bienvenida-movil.png`, fullPage: true });
  const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  await m.page.goto(`${SITE}entrar`, { waitUntil: 'networkidle' });
  await m.page.screenshot({ path: `${OUT}/05-entrar-movil.png`, fullPage: true });
  await m.context.close();

  const l = await openPage(desktop, 'light');
  await l.page.goto(`${SITE}bienvenida`, { waitUntil: 'networkidle' });
  await l.page.waitForTimeout(1000);
  await l.page.screenshot({ path: `${OUT}/06-bienvenida-claro.png`, fullPage: true });
  await l.context.close();
  if (overflow) throw new Error('La página tiene desplazamiento horizontal en móvil');
});

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`);
process.exit(failed.length ? 1 : 0);
