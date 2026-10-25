// Revisión visual de las pantallas con sesión.
//
// Abre el sitio publicado con una sesión ficticia de superadministrador y
// responde las llamadas a Supabase con datos de ejemplo interceptados en el
// navegador. No toca la base de datos real. Guarda capturas en
// ./visual-screenshots y falla si una pantalla lanza excepciones.
//
// Uso: SITE_URL=https://inavae.github.io/lam-virtual-acars/ node scripts/visual-check.mjs

import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const SITE = (process.env.SITE_URL ?? '').replace(/\/?$/, '/');
const PROJECT_REF = 'fnsfgjtmwfiizofsjajm';
const OUT = 'visual-screenshots';
mkdirSync(OUT, { recursive: true });

// -----------------------------------------------------------------------------
// Datos de ejemplo
// -----------------------------------------------------------------------------
const USER_ID = '00000000-0000-4000-8000-000000000001';
const ORG_ID = '00000000-0000-4000-8000-0000000000aa';
const now = new Date().toISOString();
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const airline = (n, slug, name, icao, color, op, logo, extra = {}) => ({
  id: id(100 + n),
  organization_id: ORG_ID,
  slug,
  name,
  icao_code: icao,
  iata_code: null,
  radio_callsign: null,
  description: `Descripción de ejemplo de ${name}.`,
  brand_primary_color: color,
  brand_secondary_color: null,
  logo_path: logo,
  is_unofficial_brand: false,
  is_active: true,
  network: 'IVAO',
  flight_plan_remarks: null,
  operation_type: op,
  website_url: null,
  created_at: now,
  updated_at: now,
  ...extra,
});

const AIRLINES = [
  airline(1, 'lineas-aereas-mexicanas', 'Líneas Aéreas Mexicanas', 'MXL', '#057956', 'mixed', 'airlines/lineas-aereas-mexicanas.png', {
    flight_plan_remarks: 'IVAOVA/MXL',
    website_url: 'https://lineasaereasmexicanas.com.mx',
  }),
  airline(2, 'alas-del-sur', 'Alas del Sur', 'WOS', '#D29006', 'passenger', 'airlines/alas-del-sur.png'),
  airline(3, 'fedex-virtual', 'FedEx Virtual', 'FDX', '#4D148C', 'cargo', 'airlines/fedex-virtual.png', { is_unofficial_brand: true }),
  airline(4, 'taesa', 'TAESA', 'TEJ', '#FCBA5A', 'passenger', 'airlines/taesa.png', { is_unofficial_brand: true }),
  airline(5, 'viva-virtual', 'VIVA Virtual', 'VIV', '#1E88E5', 'passenger', 'airlines/viva-virtual.png', { is_unofficial_brand: true }),
];
const MXL = AIRLINES[0];

const PROFILE = {
  id: USER_ID,
  pilot_number: 1001,
  email: 'piloto@example.com',
  display_name: 'Piloto de Prueba',
  country_code: 'MX',
  simbrief_username: 'pilotolam',
  primary_airline_id: null,
  account_status: 'active',
  joined_at: now,
  created_at: now,
  updated_at: now,
};

const AIRPORTS = [
  [1, 'MMMX', 'MEX', 'Aeropuerto Internacional Benito Juárez', 'Ciudad de México', 19.4363, -99.0721, 7316, 'large_airport'],
  [2, 'MMGL', 'GDL', 'Aeropuerto Internacional de Guadalajara', 'Guadalajara', 20.5218, -103.3112, 5016, 'large_airport'],
  [3, 'MMMY', 'MTY', 'Aeropuerto Internacional de Monterrey', 'Monterrey', 25.7785, -100.1069, 1278, 'large_airport'],
  [4, 'MMUN', 'CUN', 'Aeropuerto Internacional de Cancún', 'Cancún', 21.0365, -86.8771, 22, 'large_airport'],
  [5, 'MMTJ', 'TIJ', 'Aeropuerto Internacional de Tijuana', 'Tijuana', 32.5411, -116.97, 489, 'large_airport'],
].map(([n, icao, iata, name, city, lat, lon, elev, type]) => ({
  id: n,
  icao_code: icao,
  iata_code: iata,
  name,
  city,
  country_code: 'MX',
  latitude: lat,
  longitude: lon,
  elevation_ft: elev,
  airport_type: type,
  source: 'ourairports',
  created_at: now,
  updated_at: now,
}));
const ap = (icao) => AIRPORTS.find((a) => a.icao_code === icao);

const TYPES = [
  [1, 'A20N', 'Airbus', 'A320neo', 'M', 'jet', 194, null, 450],
  [2, 'B738', 'Boeing', '737-800', 'M', 'jet', 189, null, 453],
  [3, 'B77W', 'Boeing', '777-300ER', 'H', 'jet', 396, null, 490],
  [4, 'MD11', 'McDonnell Douglas', 'MD-11 / MD-11F', 'H', 'jet', 293, 91000, 480],
  [5, 'AT76', 'ATR', '72-600', 'M', 'turboprop', 72, null, 275],
].map(([n, icao, manufacturer, model, wake, engine, pax, cargo, speed]) => ({
  id: n,
  icao_code: icao,
  manufacturer,
  model,
  wake_category: wake,
  engine_type: engine,
  max_passengers: pax,
  max_cargo_kg: cargo,
  cruise_speed_kts: speed,
  created_at: now,
  updated_at: now,
}));
const typeRef = (n) => {
  const t = TYPES.find((x) => x.id === n);
  return { icao_code: t.icao_code, manufacturer: t.manufacturer, model: t.model };
};

const AIRCRAFT = [
  ['XA-MXA', '101', 2, 'Y186', 'available', 'MMMX', 'MMMX', 12543, 4210],
  ['XA-MXB', '102', 2, 'Y186', 'in_flight', 'MMMX', 'MMGL', 9870, 3302],
  ['XA-MXC', '201', 1, 'Y186', 'maintenance', 'MMGL', 'MMGL', 4410, 1505],
  ['XA-MXD', '301', 3, 'C42Y354', 'available', 'MMMX', 'MMUN', 22050, 2011],
].map(([reg, fleet, typeId, config, status, base, current, minutes, cycles], i) => ({
  id: id(300 + i),
  airline_id: MXL.id,
  aircraft_type_id: typeId,
  registration: reg,
  fleet_number: fleet,
  configuration: config,
  operation_type: 'passenger',
  status,
  base_airport_id: ap(base).id,
  current_airport_id: ap(current).id,
  total_minutes: minutes,
  cycles,
  last_flight_at: now,
  notes: null,
  type: typeRef(typeId),
  base: { icao_code: base, name: ap(base).name },
  current: { icao_code: current, name: ap(current).name },
}));

const ROUTES = [
  ['100', 'MMMX', 'MMGL', 248, 65, '14:30:00', 127, [1, 2]],
  ['102', 'MMGL', 'MMMX', 248, 65, '17:45:00', 127, [1, 2]],
  ['210', 'MMMX', 'MMMY', 381, 85, '09:10:00', 21, [2]],
  ['350', 'MMMX', 'MMUN', 698, 127, null, 96, [2, 3]],
  ['801', 'MMTJ', 'MMMX', 1219, 200, '06:00:00', 127, [3]],
].map(([fn, o, d, nm, min, time, days, types], i) => ({
  id: id(400 + i),
  airline_id: MXL.id,
  flight_number: fn,
  origin_airport_id: ap(o).id,
  destination_airport_id: ap(d).id,
  distance_nm: nm,
  estimated_minutes: min,
  departure_time_utc: time,
  days_of_week: days,
  operation_type: 'passenger',
  is_active: i !== 3,
  notes: null,
  origin: { icao_code: o, name: ap(o).name, city: ap(o).city },
  destination: { icao_code: d, name: ap(d).name, city: ap(d).city },
  route_aircraft_types: types.map((t) => ({ aircraft_type_id: t, aircraft_types: { icao_code: TYPES[t - 1].icao_code } })),
}));

const member = (n, name, roles, status) => ({
  id: id(500 + n),
  airline_id: MXL.id,
  user_id: id(600 + n),
  roles,
  status,
  requested_at: now,
  decided_at: null,
  profile: {
    id: id(600 + n),
    pilot_number: 1001 + n,
    display_name: name,
    email: `piloto${n}@example.com`,
    country_code: 'MX',
    account_status: 'active',
    simbrief_username: null,
  },
});
const MEMBERS = [
  member(1, 'Ana Martínez', ['pilot'], 'pending'),
  member(2, 'Luis Hernández', ['pilot'], 'pending'),
  member(3, 'Carla Ruiz', ['airline_admin', 'pilot'], 'active'),
  member(4, 'Diego Torres', ['ops_chief', 'pilot'], 'active'),
  member(5, 'Sofía Ramírez', ['pilot'], 'active'),
];

const RATINGS = [
  { airline_id: MXL.id, user_id: USER_ID, aircraft_type_id: 2, granted_at: now },
  { airline_id: MXL.id, user_id: USER_ID, aircraft_type_id: 1, granted_at: now },
  { airline_id: MXL.id, user_id: id(603), aircraft_type_id: 2, granted_at: now },
  { airline_id: MXL.id, user_id: id(605), aircraft_type_id: 1, granted_at: now },
];

const AIRCRAFT_OPTIONS = [
  ['XA-MXA', '101', 2, 'available', 'MMMX', null],
  ['XA-MXE', '103', 1, 'available', 'MMMX', null],
  ['XA-MXB', '102', 2, 'in_flight', 'MMGL', 'aircraft_unavailable'],
  ['XA-MXC', '201', 1, 'maintenance', 'MMGL', 'aircraft_unavailable'],
  ['XA-MXD', '301', 3, 'available', 'MMUN', 'type_not_allowed'],
].map(([reg, fleet, typeId, status, loc, reason], i) => ({
  aircraft_id: id(300 + i),
  registration: reg,
  fleet_number: fleet,
  aircraft_type_id: typeId,
  type_icao: TYPES[typeId - 1].icao_code,
  type_model: TYPES[typeId - 1].model,
  status,
  location_icao: loc,
  block_reason: reason,
}));

const inHours = (h) => new Date(Date.now() + h * 3600_000).toISOString();
const flight = (n, callsign, fn, o, d, typeId, reg, status, extra = {}) => ({
  id: id(700 + n),
  booking_id: id(800 + n),
  airline_id: MXL.id,
  user_id: USER_ID,
  aircraft_id: id(300),
  aircraft_registration: reg,
  airline_icao: 'MXL',
  flight_number: fn,
  callsign,
  planned_distance_nm: 248,
  planned_minutes: 65,
  scheduled_departure_at: inHours(5),
  operation_type: 'passenger',
  network: 'IVAO',
  flight_plan_remarks: 'IVAOVA/MXL',
  status,
  created_at: now,
  started_at: null,
  completed_at: null,
  cancelled_at: null,
  airline: { name: MXL.name, slug: MXL.slug, logo_path: MXL.logo_path, brand_primary_color: MXL.brand_primary_color },
  type: typeRef(typeId),
  origin: { icao_code: o, name: ap(o).name, city: ap(o).city },
  destination: { icao_code: d, name: ap(d).name, city: ap(d).city },
  booking: { id: id(800 + n), status: status === 'scheduled' ? 'active' : 'cancelled', expires_at: inHours(19), closed_at: null },
  ofp: null,
  session: null,
  live: null,
  pilot: { display_name: PROFILE.display_name, pilot_number: PROFILE.pilot_number },
  ...extra,
});
const FLIGHTS = [
  flight(4, 'MXL350', '350', 'MMMX', 'MMUN', 2, 'XA-MXB', 'in_progress', {
    started_at: now,
    session: { id: id(900), status: 'active', phase: 'cruise', started_at: now, last_contact_at: new Date().toISOString(), sim_aircraft_title: 'Boeing 737-800', end_reason: null },
    live: { altitude_ft: 36000, gs_kt: 462, ias_kt: 268, vs_fpm: 0, on_ground: false, sampled_at: now },
  }),
  flight(1, 'MXL100', '100', 'MMMX', 'MMGL', 2, 'XA-MXA', 'scheduled', {
    ofp: {
      flight_id: id(701),
      airline_id: MXL.id,
      user_id: USER_ID,
      request_id: '123456789',
      static_id: null,
      generated_at: now,
      airline_icao: 'MXL',
      flight_number: '100',
      atc_callsign: 'MXL100',
      origin_icao: 'MMMX',
      destination_icao: 'MMGL',
      alternate_icao: 'MMPR',
      aircraft_icao: 'A20N',
      registration: 'XA-MXA',
      route: 'MEX1A TLC UJ5 GDL',
      cruise_altitude_ft: 34000,
      air_distance_nm: 262,
      est_enroute_minutes: 58,
      est_block_minutes: 72,
      fuel_units: 'kg',
      block_fuel: 5320,
      trip_fuel: 2810,
      reserve_fuel: 1150,
      zfw: 58210,
      tow: 63300,
      ldw: 60490,
      pax_count: 168,
      cargo: 1200,
      pdf_url: 'https://www.simbrief.com/ofp/flightplans/MMMXMMGL_PDF_123456789.pdf',
      mismatches: [{ field: 'aircraft_type', expected: 'B738', actual: 'A20N', severity: 'high' }],
      fetched_at: now,
    },
  }),
  flight(2, 'MXL21K', '210', 'MMMX', 'MMMY', 1, 'XA-MXE', 'scheduled', { scheduled_departure_at: null }),
];
const HISTORY = [
  flight(3, 'MXL801', '801', 'MMTJ', 'MMMX', 3, 'XA-MXD', 'cancelled', { cancelled_at: now, booking: { id: id(803), status: 'expired', expires_at: now, closed_at: now } }),
];

const AUDIT = [
  { id: 3, occurred_at: now, actor_id: USER_ID, airline_id: MXL.id, action: 'update', entity_type: 'airlines', entity_id: MXL.id, old_data: { name: 'LAM', is_active: false }, new_data: { name: 'Líneas Aéreas Mexicanas', is_active: true } },
  { id: 2, occurred_at: now, actor_id: USER_ID, airline_id: MXL.id, action: 'insert', entity_type: 'aircraft', entity_id: 'XA-MXA', old_data: null, new_data: { registration: 'XA-MXA', status: 'available' } },
  { id: 1, occurred_at: now, actor_id: null, airline_id: MXL.id, action: 'insert', entity_type: 'routes', entity_id: '100', old_data: null, new_data: { flight_number: '100' } },
];

// -----------------------------------------------------------------------------
// Respuestas simuladas de Supabase
// -----------------------------------------------------------------------------
function eqParam(url, column) {
  const v = url.searchParams.get(column);
  return v?.startsWith('eq.') ? decodeURIComponent(v.slice(3)) : null;
}

function rowsFor(url) {
  const table = url.pathname.split('/').pop();
  switch (table) {
    case 'airlines': {
      const slug = eqParam(url, 'slug');
      return slug ? AIRLINES.filter((a) => a.slug === slug) : AIRLINES;
    }
    case 'organizations':
      return [{ id: ORG_ID, slug: 'lam', name: 'Líneas Aéreas Mexicanas', created_at: now, updated_at: now }];
    case 'profiles':
      return [PROFILE];
    case 'organization_members':
      return [{ organization_id: ORG_ID, user_id: USER_ID, role: 'superadmin', created_at: now, created_by: null, profile: { pilot_number: 1001, display_name: PROFILE.display_name, email: PROFILE.email } }];
    case 'airline_memberships':
      return eqParam(url, 'user_id')
        ? [{ id: id(599), airline_id: MXL.id, roles: ['pilot'], status: 'active', requested_at: now }]
        : MEMBERS;
    case 'pilot_type_ratings': {
      const user = eqParam(url, 'user_id');
      return user ? RATINGS.filter((r) => r.user_id === user) : RATINGS;
    }
    case 'flights': {
      const status = url.searchParams.get('status') ?? '';
      return status.includes('scheduled') ? FLIGHTS : HISTORY;
    }
    case 'acars_devices':
      return [
        { id: id(950), name: 'PC-SIMULADOR', token_prefix: 'lamd_Q7xK', app_version: '0.1.0', created_at: now, last_used_at: now, revoked_at: null },
        { id: id(951), name: 'LAPTOP-VIEJA', token_prefix: 'lamd_a9Bc', app_version: '0.1.0', created_at: now, last_used_at: null, revoked_at: now },
      ];
    case 'airline_settings':
      return [{ airline_id: eqParam(url, 'airline_id'), max_active_bookings: 3, booking_expiry_hours: 24, require_aircraft_at_origin: false, require_type_rating: true, auto_approve_pireps: false, public_tracking: true, delay_tolerance_minutes: 30, updated_at: now, updated_by: null }];
    case 'airports': {
      const one = eqParam(url, 'id');
      return one ? AIRPORTS.filter((a) => String(a.id) === one) : AIRPORTS;
    }
    case 'aircraft_types':
      return TYPES;
    case 'aircraft':
      return eqParam(url, 'airline_id') === MXL.id ? AIRCRAFT : [];
    case 'routes':
      return eqParam(url, 'airline_id') === MXL.id ? ROUTES : [];
    case 'route_aircraft_types':
      return [];
    case 'audit_logs':
      return AUDIT;
    default:
      return [];
  }
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-expose-headers': 'content-range',
};

async function handleSupabase(route) {
  const request = route.request();
  const url = new URL(request.url());
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });

  if (url.pathname.startsWith('/auth/v1/user')) {
    return route.fulfill({ status: 200, headers: CORS, json: { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: PROFILE.email } });
  }
  if (url.pathname.startsWith('/auth/v1/')) return route.fulfill({ status: 200, headers: CORS, json: {} });

  if (url.pathname === '/rest/v1/rpc/get_dashboard_summary') {
    return route.fulfill({
      status: 200,
      headers: CORS,
      json: { scope: 'organization', airlines_total: 5, airlines_active: 5, pilots_active_members: 3, pending_requests: 2, profiles_total: 6, bookings_active: 4, my_bookings_active: 2 },
    });
  }
  if (url.pathname === '/rest/v1/rpc/route_aircraft_options') {
    return route.fulfill({ status: 200, headers: CORS, json: AIRCRAFT_OPTIONS });
  }
  if (url.pathname.startsWith('/rest/v1/') && (request.method() === 'GET' || request.method() === 'HEAD')) {
    const rows = rowsFor(url);
    const headers = { ...CORS, 'content-range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` };
    const single = (request.headers()['accept'] ?? '').includes('vnd.pgrst.object');
    return route.fulfill({ status: 200, headers, json: single ? (rows[0] ?? null) : rows });
  }
  if (url.pathname.startsWith('/rest/v1/')) {
    const headers = { ...CORS, 'content-range': '*/0' };
    return route.fulfill({ status: 200, headers, json: [] });
  }
  return route.fulfill({ status: 200, headers: CORS, json: {} });
}

function fakeSession() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600 * 24;
  const accessToken = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER_ID, role: 'authenticated', aud: 'authenticated', exp, email: PROFILE.email })}.prueba`;
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 86400,
    expires_at: exp,
    refresh_token: 'prueba',
    user: { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: PROFILE.email, app_metadata: {}, user_metadata: {}, created_at: now },
  };
}

// -----------------------------------------------------------------------------
// Capturas
// -----------------------------------------------------------------------------
const results = [];
const browser = await chromium.launch();

async function shoot(name, path, { viewport = { width: 1440, height: 900 }, airlineId = null, theme = 'dark', action, waitFor } = {}) {
  const context = await browser.newContext({ viewport, locale: 'es-MX', colorScheme: theme });
  await context.addInitScript(
    ([key, session, selected, themeValue]) => {
      window.localStorage.setItem(key, JSON.stringify(session));
      window.localStorage.setItem('lam.theme', themeValue);
      if (selected) window.localStorage.setItem('lam.selectedAirline', selected);
      else window.localStorage.removeItem('lam.selectedAirline');
    },
    [`sb-${PROJECT_REF}-auth-token`, fakeSession(), airlineId, theme],
  );
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(m.text());
  });
  await page.route(/\.supabase\.co\//, handleSupabase);
  try {
    await page.goto(`${SITE}${path}`, { waitUntil: 'networkidle' });
    if (waitFor) await page.getByText(waitFor, { exact: false }).first().waitFor({ timeout: 15000 });
    if (action) await action(page);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (overflow) problems.push('desplazamiento horizontal en la página');
    results.push({ name, ok: problems.length === 0, detail: problems.join(' | ') });
  } catch (error) {
    await page.screenshot({ path: `${OUT}/${name}-error.png`, fullPage: true }).catch(() => {});
    results.push({ name, ok: false, detail: `${String(error.message).split('\n')[0]} ${problems.join(' | ')}` });
  }
  await context.close();
}

await shoot('01-dashboard', '', { waitFor: 'Aerolíneas registradas' });
await shoot('02-airlines', 'airlines', { waitFor: 'Nueva aerolínea' });
await shoot('03-airline-detail', 'airlines/lineas-aereas-mexicanas', { waitFor: 'Políticas operacionales' });
await shoot('04-pilots', 'pilots', { airlineId: MXL.id, waitFor: 'Ana Martínez' });
await shoot('05-fleet', 'fleet', { airlineId: MXL.id, waitFor: 'XA-MXA' });
await shoot('06-fleet-types', 'fleet', {
  airlineId: MXL.id,
  waitFor: 'XA-MXA',
  action: async (page) => {
    await page.getByRole('tab', { name: 'Tipos de aeronave' }).click();
    await page.getByText('777-300ER').waitFor();
  },
});
await shoot('07-airports', 'airports', { waitFor: 'MMUN' });
await shoot('08-routes', 'routes', { airlineId: MXL.id, waitFor: 'MXL100' });
await shoot('09-route-dialog', 'routes', {
  airlineId: MXL.id,
  waitFor: 'MXL100',
  action: async (page) => {
    await page.getByRole('button', { name: 'Editar' }).first().click();
    await page.getByRole('dialog').getByText('Tipos de aeronave permitidos').waitFor();
  },
});
await shoot('10-routes-import', 'routes', {
  airlineId: MXL.id,
  waitFor: 'MXL100',
  action: async (page) => {
    await page.getByRole('button', { name: 'Importar CSV' }).click();
    await page.getByRole('dialog').getByText('Descargar plantilla').waitFor();
  },
});
await shoot('11-administration', 'administration', { waitFor: 'Bitácora' });
await shoot('12-fleet-mobile', 'fleet', { airlineId: MXL.id, viewport: { width: 390, height: 844 }, waitFor: 'XA-MXA' });
await shoot('13-airline-detail-light', 'airlines/alas-del-sur', { theme: 'light', waitFor: 'Políticas operacionales' });
await shoot('14-booking', 'booking', { airlineId: MXL.id, waitFor: 'Tus reservas activas' });
await shoot('15-booking-dialog', 'booking', {
  airlineId: MXL.id,
  waitFor: 'MXL100',
  action: async (page) => {
    await page.getByRole('button', { name: 'Reservar' }).first().click();
    await page.getByRole('dialog').getByText('XA-MXE').waitFor();
    await page.getByRole('dialog').getByLabel('Callsign').fill('mxl 4100');
  },
});
await shoot('16-booking-airline', 'booking', {
  airlineId: MXL.id,
  waitFor: 'MXL100',
  action: async (page) => {
    await page.getByRole('tab', { name: 'Reservas de la aerolínea' }).click();
    await page.getByText('MXL21K').first().waitFor();
  },
});
await shoot('17-my-flights', 'my-flights', { waitFor: 'MXL21K' });
await shoot('18-my-flights-history', 'my-flights', {
  waitFor: 'MXL21K',
  action: async (page) => {
    await page.getByRole('tab', { name: 'Historial' }).click();
    await page.getByText('MXL801').waitFor();
  },
});
await shoot('19-my-flights-mobile', 'my-flights', { viewport: { width: 390, height: 844 }, waitFor: 'MXL21K' });
await shoot('20-pilot-ratings', 'pilots', {
  airlineId: MXL.id,
  waitFor: 'Ana Martínez',
  action: async (page) => {
    await page.getByRole('tab', { name: /Miembros/ }).click();
    await page.getByRole('button', { name: 'Habilitaciones' }).first().click();
    await page.getByRole('dialog').getByText('En la flota de la aerolínea').waitFor();
  },
});
await shoot('21-my-flights-light', 'my-flights', { theme: 'light', waitFor: 'MXL21K' });
await shoot('22-settings-acars', 'settings', { waitFor: 'PC-SIMULADOR' });

await browser.close();

for (const r of results) {
  if (!r.ok) console.log(`::error title=FALLA::${r.name}: ${r.detail}`);
}
// Un solo resumen: GitHub limita las anotaciones por paso.
console.log(`::notice title=Revisión visual::${results.filter((r) => r.ok).map((r) => r.name).join(', ')}`);
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} pantallas sin errores`);
process.exit(failed.length ? 1 : 0);
