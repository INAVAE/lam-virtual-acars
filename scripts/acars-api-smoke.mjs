// Prueba de humo de la API ACARS publicada (Edge Function `acars`).
// No crea dispositivos ni toca vuelos: solo comprueba salud, validación,
// autenticación y el inicio de la vinculación (que crea un código que vence
// solo en 10 minutos).
//
// Uso: ACARS_URL=https://<proyecto>.supabase.co/functions/v1/acars node scripts/acars-api-smoke.mjs

const BASE = (process.env.ACARS_URL ?? '').replace(/\/+$/, '') + '/v1';
const results = [];

async function call(method, path, { body, token } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // Sin cuerpo JSON.
  }
  return { status: res.status, json };
}

async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? '' });
  } catch (error) {
    results.push({ name, ok: false, detail: String(error.message ?? error) });
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

let link = null;

await check('GET /health responde', async () => {
  const r = await call('GET', '/health');
  expect(r.status === 200 && r.json?.ok === true, `estado ${r.status}`);
});

await check('Ruta desconocida da 404 con código', async () => {
  const r = await call('GET', '/no-existe');
  expect(r.status === 404 && r.json?.error?.code === 'not_found', `estado ${r.status} ${JSON.stringify(r.json)}`);
});

await check('Sin token se rechaza /me (401)', async () => {
  const r = await call('GET', '/me');
  expect(r.status === 401 && r.json?.error?.code === 'invalid_token', `estado ${r.status}`);
});

await check('Token inventado se rechaza (401)', async () => {
  const r = await call('GET', '/me', { token: `lamd_${'A'.repeat(43)}` });
  expect(r.status === 401 && r.json?.error?.code === 'invalid_token', `estado ${r.status} ${JSON.stringify(r.json)}`);
});

await check('Cuerpo inválido da 400 con detalles', async () => {
  const r = await call('POST', '/link/start', { body: { device_name: '' } });
  expect(r.status === 400 && Array.isArray(r.json?.error?.details), `estado ${r.status}`);
});

await check('link/start entrega código y secreto', async () => {
  const r = await call('POST', '/link/start', { body: { device_name: 'Prueba CI', app_version: 'ci' } });
  expect(r.status === 200, `estado ${r.status} ${JSON.stringify(r.json)}`);
  expect(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(r.json.code), `código ${r.json.code}`);
  expect(/^[A-Za-z0-9_-]{43}$/.test(r.json.poll_secret), 'secreto con formato inesperado');
  link = r.json;
  return r.json.code;
});

await check('link/poll sin confirmar queda pendiente', async () => {
  expect(link, 'no hubo código');
  const r = await call('POST', '/link/poll', { body: { code: link.code, poll_secret: link.poll_secret } });
  expect(r.status === 200 && r.json?.status === 'pending' && !r.json.token, `estado ${r.status} ${JSON.stringify(r.json)}`);
});

await check('link/poll con secreto equivocado no entrega token', async () => {
  expect(link, 'no hubo código');
  const r = await call('POST', '/link/poll', { body: { code: link.code, poll_secret: 'x'.repeat(43) } });
  expect(r.status === 404 && !r.json?.token, `estado ${r.status}`);
});

for (const r of results) {
  console.log(`${r.ok ? 'OK' : 'FALLA'}: ${r.name}${r.detail ? `: ${r.detail}` : ''}`);
  if (!r.ok) console.log(`::error title=API ACARS::${r.name}: ${r.detail}`);
}
console.log(`::notice title=API ACARS::${results.filter((r) => r.ok).length}/${results.length} comprobaciones correctas`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
