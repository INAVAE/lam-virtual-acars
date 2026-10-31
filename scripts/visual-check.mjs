// Revisión visual de las pantallas con sesión.
//
// Abre el sitio publicado con una sesión ficticia de superadministrador y
// responde las llamadas a Supabase con datos de ejemplo interceptados en el
// navegador. No toca la base de datos real. Guarda capturas en
// ./visual-screenshots y falla si una pantalla lanza excepciones.
//
// Uso: SITE_URL=https://inavae.github.io/lam-virtual-acars/ node scripts/visual-check.mjs

import { mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
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
  time_zone: 'America/Mexico_City',
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
  flight(5, 'MXL106', '106', 'MMMX', 'MMGL', 2, 'XA-MXB', 'completed', { completed_at: now, pirep: { id: id(1200), status: 'pending', score: 90 } }),
];

// PIREP de ejemplo: MMMX → MMAA con traza sintética.
const PIREP_ID = id(1200);
const t0 = Date.now() - 3 * 3600_000;
const at = (min) => new Date(t0 + min * 60_000).toISOString();
// Vuelo simulado de 56 min con perfil realista: APU, arranque, rodaje, ascenso,
// crucero, descenso y rodaje de llegada. El combustible se integra por etapa.
const FUEL_RATE = (m) => (m < 0.5 ? 0 : m < 3 ? 2 : m < 8.6 ? 18 : m < 20 ? 55 : m < 34 ? 40 : m < 52.5 ? 20 : 14); // kg/min
const fuelAt = (m) => {
  let kg = 6129;
  for (let t = 0; t < m; t += 0.05) kg -= FUEL_RATE(t) * 0.05;
  return Math.round(kg);
};
const phaseAt = (m) =>
  m < 2 ? 'preflight' : m < 3 ? 'pushback' : m < 8.6 ? 'taxi_out' : m < 9.3 ? 'takeoff' : m < 10 ? 'initial_climb' : m < 20 ? 'climb' : m < 34 ? 'cruise' : m < 50 ? 'descent' : m < 52.5 ? 'approach' : m < 53 ? 'landing' : 'taxi_in';
const altAt = (m) => (m < 9.3 ? 7316 : m < 20 ? 7316 + ((m - 9.3) / 10.7) * 17684 : m < 34 ? 25000 : m < 52.5 ? 25000 - ((m - 34) / 18.5) * 24984 : 16);
const iasAt = (m) => (m < 2 ? 0 : m < 3 ? 3 : m < 8.6 ? 16 : m < 9.3 ? 140 : m < 12 ? 210 : m < 20 ? 280 : m < 34 ? 270 : m < 48 ? 280 : m < 52.5 ? 150 : m < 53 ? 90 : 14);
// Viento: del sur cerca del suelo, rolando al oeste y arreciando con la altura.
// En la aproximación (minuto 51) cae de 20 a 2 kt: una cizalladura de −18 kt.
const windAt = (m, alt) => {
  if (m >= 50.9 && m < 51.4) return { dir: 180, kt: 2 };
  if (alt < 3000) return { dir: 180, kt: 20 };
  return { dir: Math.round(180 + Math.min(1, alt / 25000) * 90), kt: Math.round(20 + Math.min(1, (alt - 3000) / 22000) * 45) };
};
const TRACK = Array.from({ length: 140 }, (_, i) => {
  const m = (i / 139) * 56;
  const f = m / 56;
  const phase = phaseAt(m);
  const ground = ['preflight', 'pushback', 'taxi_out', 'taxi_in'].includes(phase) || (phase === 'landing' && m > 52.8);
  const ias = iasAt(m);
  return {
    seq: i,
    sampled_at: at(m),
    latitude: 19.436 - f * 2.68 + Math.sin(f * Math.PI) * 0.25,
    longitude: -99.072 - f * 0.68,
    altitude_ft: Math.round(altAt(m)),
    gs_kt: Math.round(ground ? ias : ias * (1 + altAt(m) / 60000)),
    ias_kt: ias,
    vs_fpm: phase === 'climb' || phase === 'initial_climb' ? 1650 : phase === 'descent' || phase === 'approach' ? -1350 : 0,
    heading_deg: 195,
    fuel_kg: fuelAt(m),
    wind_dir_deg: windAt(m, Math.max(0, altAt(m) - (m < 34 ? 7316 : 16))).dir,
    wind_kt: windAt(m, Math.max(0, altAt(m) - (m < 34 ? 7316 : 16))).kt,
    on_ground: ground,
    phase,
  };
});
const EVENTS = [
  ['note', 'aircraft_connected', 0, { kind: 'adapter', adapter: 'PMDG 737', sdk: true }],
  ['phase_change', 'preflight', 0, { from: 'aircraft_connected', to: 'preflight' }],
  ['note', 'preflight', 0.5, { kind: 'apu', state: 'start', fuel_kg: fuelAt(0.5) }],
  ['block_off', 'pushback', 2, { fuel_kg: fuelAt(2) }],
  ['engine_start', 'pushback', 3, { running: 1, count: 2 }],
  ['engine_start', 'pushback', 3.6, { running: 2, count: 2 }],
  ['note', 'taxi_out', 6, { kind: 'apu', state: 'stop', fuel_kg: fuelAt(6) }],
  ['takeoff', 'initial_climb', 9.3, { ias_kt: 153, pitch_deg: 8.3, flaps_deg: 5, fuel_kg: fuelAt(9.3), wind_dir_deg: 180, wind_kt: 20, headwind_kt: 19.3, crosswind_kt: -5.2 }],
  ['note', 'climb', 14, { kind: 'attitude', axis: 'bank', peak_deg: -38.4, seconds: 6, altitude_ft: Math.round(altAt(14)), ias_kt: 280 }],
  ['phase_change', 'cruise', 20, { from: 'climb', to: 'cruise' }],
  ['note', 'descent', 42, { kind: 'attitude', axis: 'pitch_down', peak_deg: -8.1, seconds: 4, altitude_ft: Math.round(altAt(42)), ias_kt: 280 }],
  ['touchdown', 'landing', 52.8, { vs_fpm: -294, g_force: 1.25, flaps_deg: 30, fuel_kg: fuelAt(52.8), wind_dir_deg: 180, wind_kt: 20, headwind_kt: 19.3, crosswind_kt: -5.2 }],
  ['block_on', 'taxi_in', 55.5, { fuel_kg: fuelAt(55.5) }],
].map(([type, phase, min, data], i) => ({ id: id(1300 + i), seq: i, type, phase, occurred_at: at(min), latitude: null, longitude: null, altitude_ft: null, data }));
const stage = (a, b) => ({ kg: fuelAt(a) - fuelAt(b), minutes: Math.round((b - a) * 10) / 10, kg_per_hour: Math.round(((fuelAt(a) - fuelAt(b)) / (b - a)) * 60) });
const MOCK_FUEL = {
  block_off_kg: fuelAt(2),
  takeoff_kg: fuelAt(9.3),
  landing_kg: fuelAt(52.8),
  block_on_kg: fuelAt(55.5),
  taxi_out_kg: fuelAt(2) - fuelAt(9.3),
  trip_kg: fuelAt(9.3) - fuelAt(52.8),
  taxi_in_kg: fuelAt(52.8) - fuelAt(55.5),
  used_kg: fuelAt(2) - fuelAt(55.5),
  samples: 140,
  before_engines_kg: fuelAt(0) - fuelAt(3),
  apu: { minutes: 5.5, starts: 1, first_on_at: at(0.5), last_off_at: at(6), running_at_start: false, running_at_end: false },
  stages: { taxi_out: stage(0, 9.3), climb: stage(9.3, 20), cruise: stage(20, 34), descent: stage(34, 53), taxi_in: stage(53, 56) },
  plan: { block_kg: 6144, trip_kg: 1777, reserve_kg: 1118, landing_kg: 6144 - 1777 - (fuelAt(2) - fuelAt(9.3)), units: 'kg' },
};
const pirepRow = (n, callsign, status, score, extra = {}) => ({
  id: n === 0 ? PIREP_ID : id(1200 + n),
  airline_id: MXL.id,
  user_id: USER_ID,
  flight_id: id(1250 + n),
  session_id: id(1270 + n),
  aircraft_id: id(300),
  aircraft_type_id: 2,
  aircraft_registration: 'XA-MXB',
  callsign,
  flight_number: callsign.slice(3),
  origin_airport_id: 1,
  destination_airport_id: 2,
  arrival_airport_id: 2,
  diverted: false,
  block_off_at: at(2),
  takeoff_at: at(9.3),
  landing_at: at(52.8),
  block_on_at: at(55.5),
  block_minutes: 54,
  flight_minutes: 44,
  distance_nm: 207,
  planned_distance_nm: 165,
  fuel_used_kg: MOCK_FUEL.used_kg,
  max_altitude_ft: 25024,
  landing_vs_fpm: -294,
  landing_g: 1.25,
  landing_bounces: 0,
  score,
  findings: [
    { code: 'bank_excess', label: 'Alabeo excesivo', penalty: 5, critical: false, value: 38.4, threshold: 35, unit: '°' },
    { code: 'pitch_down_excess', label: 'Cabeceo excesivo (nariz abajo)', penalty: 5, critical: false, value: -8.1, threshold: 7.5, unit: '°' },
    {
      code: 'taxi_speed', label: 'Rodaje rápido', penalty: 5, critical: false, value: 32, threshold: 30, unit: 'kt',
      waived: true, waived_by_name: PROFILE.display_name, waived_at: now,
      waived_reason: 'Salida directa: despegue autorizado sin posición y mantener; los 32 kt fueron la carrera de despegue.',
    },
  ],
  metrics: {
    block_estimated: false,
    fuel_block_off_kg: MOCK_FUEL.block_off_kg,
    fuel_block_on_kg: MOCK_FUEL.block_on_kg,
    takeoff: { ias_kt: 153, pitch_deg: 8.3, flaps_deg: 5 },
    touchdown: { vs_fpm: -294, g_force: 1.25, pitch_deg: 3.1, bank_deg: 1.6, ias_kt: 141, bounces: 0, flaps_deg: 30, gear_down: true, vs_source: 'touchdown_normal_velocity' },
    max_taxi_gs_kt: 32,
    sim_aircraft_title: '737-800BCF BW',
    sim_aircraft_icao: 'B738',
    client_version: '0.1.19',
    fuel: MOCK_FUEL,
    attitude: { excursions: 2, max_bank_deg: 38.4, min_pitch_down_deg: -8.1 },
    wind: {
      samples: 140,
      takeoff: { at: at(9.3), dir_deg: 180, kt: 20, heading_deg: 195, headwind_kt: 19.3, crosswind_kt: -5.2 },
      touchdown: { at: at(52.8), dir_deg: 180, kt: 20, heading_deg: 195, headwind_kt: 19.3, crosswind_kt: -5.2 },
      max: { at: at(30), dir_deg: 270, kt: 65, altitude_ft: 25000, phase: 'cruise' },
      shear: { events: 1, max_change_kt: -18.3, at: at(51.2), phase: 'approach', altitude_ft: 6850 },
    },
  },
  has_critical: false,
  status,
  auto_approved: false,
  pilot_comment: null,
  review_comment: status === 'rejected' ? 'Desvío sin justificar' : null,
  reviewed_by: status === 'pending' ? null : USER_ID,
  reviewed_at: status === 'pending' ? null : now,
  created_at: at(56),
  updated_at: now,
  airline: { name: MXL.name, icao_code: 'MXL', slug: MXL.slug, logo_path: MXL.logo_path, brand_primary_color: MXL.brand_primary_color },
  pilot: { display_name: PROFILE.display_name, pilot_number: PROFILE.pilot_number },
  reviewer: status === 'pending' ? null : { display_name: PROFILE.display_name },
  type: { icao_code: 'B738', manufacturer: 'Boeing', model: '737-800' },
  origin: { icao_code: 'MMMX', name: 'Aeropuerto Internacional de la Ciudad de México', city: 'Ciudad de México', latitude: 19.4363, longitude: -99.0721 },
  destination: { icao_code: 'MMAA', name: 'Aeropuerto Internacional de Acapulco', city: 'Acapulco', latitude: 16.7571, longitude: -99.754 },
  arrival: { icao_code: 'MMAA', name: 'Aeropuerto Internacional de Acapulco', city: 'Acapulco', latitude: 16.7571, longitude: -99.754 },
  ...extra,
});
const PIREPS = [
  pirepRow(0, 'MXL106', 'pending', 90),
  pirepRow(1, 'MXL350', 'accepted', 100, { findings: [], landing_vs_fpm: -162, block_minutes: 128 }),
  pirepRow(2, 'MXL801', 'rejected', 55, {
    diverted: true,
    has_critical: true,
    arrival: { icao_code: 'MMPR', name: 'Puerto Vallarta', city: 'Puerto Vallarta' },
    landing_vs_fpm: -712,
    findings: [
      { code: 'landing_hard', label: 'Aterrizaje duro', penalty: 25, critical: false, value: -712, threshold: 600, unit: 'fpm' },
      { code: 'diversion', label: 'Desvío', penalty: 0, critical: true, value: null, threshold: null, unit: null },
    ],
  }),
];
// -----------------------------------------------------------------------------
// Fase 6: vuelos en vivo, estadísticas, Operations Center y aterrizajes
// -----------------------------------------------------------------------------
const apt = (icao) => {
  const a = AIRPORTS.find((x) => x.icao_code === icao) ?? AIRPORTS[0];
  return { icao: a.icao_code, name: a.name, city: a.city, latitude: a.latitude, longitude: a.longitude };
};
const minsAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const liveFlight = (n, callsign, from, to, pos, phase, extra = {}) => ({
  flight_id: id(1500 + n),
  session_id: id(1550 + n),
  airline: { id: MXL.id, icao: MXL.icao_code, name: MXL.name, slug: MXL.slug, color: MXL.brand_primary_color, logo_path: MXL.logo_path },
  callsign,
  flight_number: callsign.slice(3),
  network: 'IVAO',
  pilot: { id: n === 0 ? USER_ID : id(700 + n), name: n === 0 ? PROFILE.display_name : ['Ana Torres', 'Luis Ramírez', 'Sofía Méndez'][n - 1], number: 1001 + n },
  is_mine: n === 0,
  aircraft_registration: ['XA-MXB', 'XA-MXC', 'XA-MXD', 'XA-MXE'][n],
  aircraft_type: 'B738',
  aircraft_model: 'Boeing 737-800',
  sim_aircraft_title: 'PMDG 737-800',
  origin: apt(from),
  destination: apt(to),
  planned_distance_nm: 300,
  planned_minutes: 70,
  route_nm: 270,
  remaining_nm: pos.remaining,
  started_at: minsAgo(pos.started),
  last_contact_at: minsAgo(pos.contact ?? 0.05),
  phase,
  position: {
    sampled_at: minsAgo(pos.contact ?? 0.05), latitude: pos.lat, longitude: pos.lon, altitude_ft: pos.alt, agl_ft: pos.alt - 1000,
    ias_kt: pos.ias, gs_kt: pos.gs, heading_deg: pos.hdg, vs_fpm: pos.vs, on_ground: pos.alt < 8000 && pos.gs < 40,
    wind_dir_deg: 260, wind_kt: 42,
  },
  alerts: [],
  ...extra,
});
const LIVE = [
  liveFlight(0, 'MXL106', 'MMMX', 'MMGL', { lat: 20.05, lon: -101.6, alt: 34000, ias: 270, gs: 455, hdg: 288, vs: 0, remaining: 98, started: 52 }, 'cruise'),
  liveFlight(1, 'MXL221', 'MMGL', 'MMMX', { lat: 19.9, lon: -100.1, alt: 14500, ias: 280, gs: 320, hdg: 112, vs: -1800, remaining: 58, started: 61 }, 'descent', {
    alerts: [{ code: 'attitude', level: 'warn', at: minsAgo(12), value: 37, axis: 'bank' }],
  }),
  liveFlight(2, 'MXL310', 'MMMX', 'MMMY', { lat: 19.43, lon: -99.07, alt: 7316, ias: 12, gs: 14, hdg: 50, vs: 0, remaining: 380, started: 9 }, 'taxi_out'),
  liveFlight(3, 'MXL455', 'MMMY', 'MMMX', { lat: 23.6, lon: -100.2, alt: 31000, ias: 265, gs: 410, hdg: 180, vs: 0, remaining: 230, started: 40, contact: 6 }, 'cruise', {
    alerts: [{ code: 'no_signal', level: 'warn', at: minsAgo(6), value: 6 }],
  }),
];
const LIVE_TRACK = TRACK.filter((p) => !p.on_ground).slice(0, 60).map((p, i) => [19.44 + i * 0.011, -99.1 - i * 0.042, p.altitude_ft, p.phase]);
const MONTHS = Array.from({ length: 12 }, (_, i) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 11 + i);
  const flights = [0, 0, 2, 5, 9, 7, 12, 15, 11, 18, 22, 14][i];
  return { month: d.toISOString().slice(0, 7), flights, block_minutes: flights * 74, distance_nm: flights * 290, average_score: flights ? 88 + (i % 5) : null, pilots: Math.min(6, flights) };
});
const RANKING = [
  ['Ana Torres', 1002, 1820, 24, 7100, 94.2, -142, -61],
  [PROFILE.display_name, 1001, 1510, 19, 5600, 91.8, -188, -95],
  ['Luis Ramírez', 1003, 1230, 15, 4400, 86.5, -236, -120],
  ['Sofía Méndez', 1004, 640, 8, 2300, 89.0, -205, -88],
].map(([name, number, block, flights, dist, score, vs, best], i) => ({
  user_id: i === 1 ? USER_ID : id(700 + i), name, number, country_code: 'MX', flights, block_minutes: block, distance_nm: dist,
  average_score: score, average_landing_vs_fpm: vs, best_landing_vs_fpm: best, last_30_days_minutes: Math.round(block / 4), last_flight_at: minsAgo(60 * (i + 1) * 9),
}));
const STATS = {
  airlines: [MXL.id],
  months: 12,
  totals: { flights: 66, block_minutes: 5200, flight_minutes: 4300, distance_nm: 19400, fuel_used_kg: 310000, average_score: 90.6, average_landing_vs_fpm: -191, pilots: 4, airports: 7 },
  last_30_days: { flights: 14, block_minutes: 1040, distance_nm: 4100, average_score: 91.2, pilots: 4 },
  monthly: MONTHS,
  top_routes: [
    { origin: 'MMMX', destination: 'MMGL', origin_city: 'Ciudad de México', destination_city: 'Guadalajara', flights: 21, block_minutes: 1470, average_score: 92.1 },
    { origin: 'MMGL', destination: 'MMMX', origin_city: 'Guadalajara', destination_city: 'Ciudad de México', flights: 17, block_minutes: 1190, average_score: 90.4 },
    { origin: 'MMMX', destination: 'MMMY', origin_city: 'Ciudad de México', destination_city: 'Monterrey', flights: 12, block_minutes: 1080, average_score: 88.7 },
    { origin: 'MMMX', destination: 'MMUN', origin_city: 'Ciudad de México', destination_city: 'Cancún', flights: 9, block_minutes: 1170, average_score: 91.0 },
  ],
  aircraft_types: [
    { icao: 'B738', model: 'Boeing 737-800', flights: 41, block_minutes: 3300, average_landing_vs_fpm: -183 },
    { icao: 'A20N', model: 'Airbus A320neo', flights: 25, block_minutes: 1900, average_landing_vs_fpm: -204 },
  ],
  landings: [
    { bucket: 'butter', label: '0 a −100', flights: 9 }, { bucket: 'soft', label: '−100 a −200', flights: 27 }, { bucket: 'normal', label: '−200 a −300', flights: 19 },
    { bucket: 'firm', label: '−300 a −400', flights: 7 }, { bucket: 'hard', label: '−400 a −600', flights: 3 }, { bucket: 'very_hard', label: 'más de −600', flights: 1 },
  ],
  ranking: RANKING,
  common_findings: [
    { code: 'taxi_speed', label: 'Rodaje rápido', count: 11 },
    { code: 'landing_firm', label: 'Aterrizaje firme', count: 7 },
    { code: 'speed_below_fl100', label: '250 nudos bajo 10,000 ft', count: 5 },
    { code: 'bank_excess', label: 'Alabeo excesivo', count: 2 },
  ],
};
const OPS = {
  airlines: [MXL.id],
  departures: [
    { flight_id: id(1600), airline_icao: 'MXL', callsign: 'MXL500', flight_number: '500', pilot: { id: id(701), name: 'Ana Torres', number: 1002 }, origin: 'MMMX', destination: 'MMGL', aircraft_type: 'B738', aircraft_registration: 'XA-MXA', network: 'IVAO', scheduled_departure_at: minsAgo(45), booked_at: minsAgo(300), booking_expires_at: minsAgo(-600), has_ofp: true, state: 'late' },
    { flight_id: id(1601), airline_icao: 'MXL', callsign: 'MXL612', flight_number: '612', pilot: { id: id(702), name: 'Luis Ramírez', number: 1003 }, origin: 'MMGL', destination: 'MMMX', aircraft_type: 'A20N', aircraft_registration: 'XA-MXF', network: 'OFFLINE', scheduled_departure_at: null, booked_at: minsAgo(1300), booking_expires_at: minsAgo(-100), has_ofp: false, state: 'expiring' },
  ],
  pirep_queue: [
    { id: PIREP_ID, callsign: 'MXL106', flight_number: '106', pilot: { id: USER_ID, name: PROFILE.display_name, number: 1001 }, origin: 'MMMX', destination: 'MMAA', arrival: 'MMAA', diverted: false, score: 90, has_critical: false, critical_labels: [], block_minutes: 54, landing_vs_fpm: -294, pilot_comment: true, created_at: minsAgo(26 * 60) },
  ],
  fleet: AIRCRAFT.map((a, i) => ({ id: a.id, airline_icao: 'MXL', registration: a.registration, fleet_number: null, aircraft_type: 'B738', status: a.status ?? 'available', current_airport: ['MMMX', 'MMGL', 'MMMY', 'MMMX'][i % 4], base_airport: 'MMMX', away_from_base: i % 4 === 1 || i % 4 === 2, total_minutes: 3000 + i * 410, cycles: 40 + i * 6, last_flight_at: minsAgo(i * 300 + 60), usage: i === 1 ? 'flying' : i === 2 ? 'booked' : null, usage_callsign: i === 1 ? 'MXL106' : i === 2 ? 'MXL500' : null, usage_pilot: i === 1 ? PROFILE.display_name : i === 2 ? 'Ana Torres' : null })),
  counts: { flights_completed_24h: 5, bookings_expired_24h: 1, pireps_reviewed_7d: 12 },
};
const PERFORMANCE = {
  days: 90,
  pilots: RANKING.map((r, i) => ({
    user_id: r.user_id, name: r.name, number: r.number, airlines: ['MXL'], member_since: minsAgo(60 * 24 * 200), flights: 6 + i, accepted: 5 + i, rejected: i === 2 ? 1 : 0, pending: 1,
    block_minutes: r.block_minutes / 3, average_score: r.average_score, previous_average_score: r.average_score - 3 + i * 2, average_landing_vs_fpm: r.average_landing_vs_fpm,
    critical_findings: i === 2 ? 1 : 0, top_findings: i === 0 ? [] : ['Rodaje rápido', 'Aterrizaje firme'].slice(0, i), total_block_minutes: r.block_minutes, last_flight_at: r.last_flight_at,
  })),
};
const LANDING_VS = [-142, -188, -96, -251, -173, -305, -120, -212, -164, -431, -199, -145, -87, -233, -176, -158, -268, -131, -190, -214];
const LANDING_STATS = {
  user_id: USER_ID,
  pilot: { id: USER_ID, name: PROFILE.display_name, number: 1001 },
  summary: {
    landings: 20, average_vs_fpm: -194, median_vs_fpm: -181, best_vs_fpm: -87, worst_vs_fpm: -431, stddev_vs_fpm: 76, average_g: 1.21, max_g: 1.58,
    average_pitch_deg: 4.3, average_bank_deg: 1.4, max_bank_deg: 4.2, average_ias_kt: 141, average_crosswind_kt: 6.8, max_crosswind_kt: 17,
    bounce_rate: 0.05, firm_rate: 0.1, hard_rate: 0.05, within_limits_rate: 0.85, average_score: 91.8, last_10_average_vs_fpm: -173, previous_10_average_vs_fpm: -215,
  },
  buckets: [
    { bucket: 'butter', label: '0 a −100', flights: 2 }, { bucket: 'soft', label: '−100 a −200', flights: 11 }, { bucket: 'normal', label: '−200 a −300', flights: 5 },
    { bucket: 'firm', label: '−300 a −400', flights: 1 }, { bucket: 'hard', label: '−400 a −600', flights: 1 }, { bucket: 'very_hard', label: 'más de −600', flights: 0 },
  ],
  recent: LANDING_VS.map((vs, i) => ({
    id: i === 0 ? PIREP_ID : id(1700 + i), at: minsAgo(60 * 24 * i + 90), callsign: `MXL${100 + i * 7}`, origin: i % 2 ? 'MMGL' : 'MMMX', arrival: i % 2 ? 'MMMX' : 'MMGL',
    aircraft_type: i % 3 ? 'B738' : 'A20N', status: i < 2 ? 'pending' : 'accepted', vs_fpm: vs, g_force: Math.round((1.1 + Math.abs(vs) / 1200) * 100) / 100,
    pitch_deg: 3.5 + (i % 4) * 0.4, bank_deg: ((i % 5) - 2) * 0.9, bounces: vs < -400 ? 1 : 0, ias_kt: 136 + (i % 6), flaps_deg: 30, headwind_kt: 8 + (i % 7), crosswind_kt: ((i % 9) - 4) * 2,
    score: vs < -400 ? 70 : vs < -300 ? 90 : 100, within_limits: vs > -300, findings: vs < -400 ? ['landing_firm', 'landing_bounce'] : vs < -300 ? ['landing_firm'] : [],
  })),
};

const RULE_DEFS = [
  ['landing_hard', 'Aterrizaje duro', 'Velocidad vertical al tocar pista más fuerte que el umbral.', 'fpm', 20, 600, false],
  ['landing_firm', 'Aterrizaje firme', 'Velocidad vertical al tocar pista más fuerte que el umbral (sin llegar a duro).', 'fpm', 5, 400, false],
  ['taxi_speed', 'Rodaje rápido', 'Velocidad sobre el suelo mayor que el umbral durante el rodaje.', 'kt', 5, 30, false],
  ['sim_paused', 'Simulador en pausa', 'El simulador estuvo en pausa durante el vuelo (informativo).', null, 0, null, false],
  ['diversion', 'Desvío', 'Llegó a un aeropuerto distinto al destino.', null, 0, null, true],
  ['crash', 'Choque', 'El simulador registró un choque.', null, 100, null, true],
];
const SCORING_RULES = RULE_DEFS.map(([code, label, description, unit, penalty, threshold, critical], i) => ({
  airline_id: MXL.id,
  rule_code: code,
  enabled: code !== 'sim_paused',
  penalty,
  threshold,
  critical,
  updated_at: now,
  updated_by: null,
  definition: { code, label, description, threshold_unit: unit, default_enabled: true, default_penalty: penalty, default_threshold: threshold, default_critical: critical, sort_order: i * 10 },
}));

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
      return [{ airline_id: eqParam(url, 'airline_id'), max_active_bookings: 3, booking_expiry_hours: 24, require_aircraft_at_origin: false, require_type_rating: true, auto_approve_pireps: false, pirep_min_score: 80, public_tracking: true, delay_tolerance_minutes: 30, updated_at: now, updated_by: null }];
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
    case 'pireps': {
      const one = eqParam(url, 'id');
      if (one) return PIREPS.filter((p) => p.id === one);
      const status = eqParam(url, 'status');
      return status ? PIREPS.filter((p) => p.status === status) : PIREPS;
    }
    case 'flight_track_points':
      return TRACK;
    case 'flight_events':
      return EVENTS;
    case 'pilot_statistics':
      return [{ airline_id: MXL.id, user_id: USER_ID, pireps_total: 3, pireps_accepted: 1, pireps_pending: 1, pireps_rejected: 1, block_minutes: 128, flight_minutes: 104, distance_nm: 642, fuel_used_kg: 5210, average_score: 100, average_landing_vs_fpm: -162, best_landing_vs_fpm: -162, last_flight_at: now }];
    case 'pirep_scoring_rules':
      return SCORING_RULES;
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
      json: { scope: 'organization', airlines_total: 5, airlines_active: 5, pilots_active_members: 3, pending_requests: 2, profiles_total: 6, bookings_active: 4, my_bookings_active: 2, pireps_pending_review: 1, my_pireps_pending: 1, my_block_minutes: 128, my_flights_accepted: 1 },
    });
  }
  const RPC = {
    get_live_flights: LIVE,
    get_live_flight_track: LIVE_TRACK,
    get_airline_statistics: STATS,
    get_operations_overview: OPS,
    get_pilot_performance: PERFORMANCE,
    get_pilot_landing_stats: LANDING_STATS,
  };
  const rpcName = url.pathname.startsWith('/rest/v1/rpc/') ? url.pathname.slice('/rest/v1/rpc/'.length) : null;
  if (rpcName && rpcName in RPC) return route.fulfill({ status: 200, headers: CORS, json: RPC[rpcName] });
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

// Las pruebas no piden teselas a OpenStreetMap (su política de uso no permite
// tráfico automatizado): se responde con una tesela neutra generada aquí.
function placeholderTile() {
  const size = 256;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const edge = x === 0 || y === 0;
      const v = edge ? 205 : 232;
      raw.fill(v, y * (size * 3 + 1) + 1 + x * 3, y * (size * 3 + 1) + 4 + x * 3);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    let c = ~0;
    for (const b of body) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(~c >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const TILE_PNG = placeholderTile();

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
  await page.route(/tile\.openstreetmap\.org\//, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG }));
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
await shoot('23-pireps', 'pireps', { waitFor: 'MXL350' });
await shoot('24-pireps-review', 'pireps', {
  airlineId: MXL.id,
  waitFor: 'MXL106',
  action: async (page) => {
    await page.getByRole('tab', { name: /Por revisar/ }).click();
    await page.getByText('MXL106').first().waitFor();
  },
});
await shoot('25-pirep-detail', `pireps/${PIREP_ID}`, {
  waitFor: 'Rodaje rápido',
  action: async (page) => {
    // Atribución de OpenStreetMap visible y enlazada a la licencia (ODbL).
    const credit = page.locator('.leaflet-control-attribution a[href="https://www.openstreetmap.org/copyright"]');
    await credit.waitFor({ state: 'visible' });
    if ((await credit.textContent())?.trim() !== 'OpenStreetMap') throw new Error('Atribución de OpenStreetMap incompleta');
  },
});
await shoot('25b-pirep-analysis-hover', `pireps/${PIREP_ID}`, {
  waitFor: 'Análisis del vuelo',
  action: async (page) => {
    await page.getByRole('radio', { name: 'Por altitud' }).click();
    const chart = page.locator('svg[aria-label^="Perfil de altitud"]');
    await chart.scrollIntoViewIfNeeded();
    const box = await chart.boundingBox();
    if (!box) throw new Error('No se encontró la gráfica');
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.4);
    await page.getByText('En el aire').first().waitFor();
    await page.waitForTimeout(1500);
  },
});
await shoot('25c-pirep-apu-hover', `pireps/${PIREP_ID}`, {
  waitFor: 'Análisis del vuelo',
  action: async (page) => {
    const chart = page.locator('svg[aria-label^="Perfil de altitud"]');
    await chart.scrollIntoViewIfNeeded();
    const box = await chart.boundingBox();
    if (!box) throw new Error('No se encontró la gráfica');
    // Minuto 1.5: APU en marcha, motores apagados.
    await page.mouse.move(box.x + 56 + ((box.width - 72) * 1.5) / 56, box.y + box.height * 0.5);
    await page.getByRole('status').filter({ hasText: 'APU en marcha' }).first().waitFor();
    await page.waitForTimeout(800);
  },
});
await shoot('25d-pirep-attitude-hover', `pireps/${PIREP_ID}`, {
  waitFor: 'Análisis del vuelo',
  action: async (page) => {
    const chart = page.locator('svg[aria-label^="Perfil de altitud"]');
    await chart.scrollIntoViewIfNeeded();
    const legs = await page.locator('[data-testid="angle-leg"]').count();
    if (legs < 2) throw new Error(`Se esperaban ángulos de ascenso y descenso; hay ${legs}`);
    const box = await chart.boundingBox();
    if (!box) throw new Error('No se encontró la gráfica');
    // Minuto 14: alabeo de 38° en el ascenso.
    await page.mouse.move(box.x + 56 + ((box.width - 72) * 14) / 56, box.y + box.height * 0.3);
    await page.getByRole('status').filter({ hasText: 'Alabeo 38°' }).first().waitFor();
    await page.getByRole('status').filter({ hasText: 'Trayectoria' }).first().waitFor();
    await page.waitForTimeout(800);
  },
});
await shoot('26-pirep-detail-mobile', `pireps/${PIREP_ID}`, { viewport: { width: 390, height: 844 }, waitFor: 'Rodaje rápido' });
await shoot('27-pirep-detail-light', `pireps/${PIREP_ID}`, { theme: 'light', waitFor: 'Rodaje rápido' });
await shoot('29-pirep-local-first', `pireps/${PIREP_ID}`, {
  waitFor: 'Análisis del vuelo',
  action: async (page) => {
    // Un clic en el reloj pone la hora local primero.
    await page.getByRole('button', { name: /Hora UTC y local/ }).click();
    const chart = page.locator('svg[aria-label^="Perfil de altitud"]');
    await chart.scrollIntoViewIfNeeded();
    const box = await chart.boundingBox();
    if (!box) throw new Error('No se encontró la gráfica');
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
    await page.getByRole('status').filter({ hasText: 'Z' }).first().waitFor();
    await page.waitForTimeout(800);
  },
});
await shoot('30-settings-time', 'settings', { waitFor: 'Zona horaria' });
await shoot('25e-pirep-wind-shear', `pireps/${PIREP_ID}`, {
  waitFor: 'Análisis del vuelo',
  action: async (page) => {
    const chart = page.locator('svg[aria-label^="Perfil de altitud"]');
    await chart.scrollIntoViewIfNeeded();
    const box = await chart.boundingBox();
    if (!box) throw new Error('No se encontró la gráfica');
    // Minuto 51.2: cizalladura en la aproximación.
    await page.mouse.move(box.x + 56 + ((box.width - 72) * 51.2) / 56, box.y + box.height * 0.45);
    await page.getByRole('status').filter({ hasText: 'Cizalladura' }).first().waitFor();
    await page.getByRole('status').filter({ hasText: 'Viento' }).first().waitFor();
    await page.waitForTimeout(800);
  },
});
await shoot('25f-pirep-waived-finding', `pireps/${PIREP_ID}`, {
  waitFor: 'Anulada por',
  action: async (page) => {
    await page.getByText('Anulada por').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
  },
});
await shoot('31-live-flights', `live?flight=${id(1500)}`, {
  waitFor: 'Vuelos en vivo',
  action: async (page) => {
    await page.getByRole('region', { name: /Detalle del vuelo MXL106/ }).waitFor();
    await page.waitForTimeout(1500);
  },
});
await shoot('32-statistics', 'statistics', { waitFor: 'Ranking de pilotos' });
await shoot('33-statistics-landings', 'statistics', {
  waitFor: 'Ranking de pilotos',
  action: async (page) => {
    await page.getByRole('tab', { name: 'Aterrizajes' }).click();
    await page.getByText('Dentro de parámetros').first().waitFor();
    await page.waitForTimeout(500);
  },
});
await shoot('34-operations', 'operations', { waitFor: 'Operations Center', action: async (page) => page.getByText('MXL221').first().waitFor() });
await shoot('35-operations-pireps', 'operations', {
  waitFor: 'Operations Center',
  action: async (page) => {
    await page.getByRole('tab', { name: /PIREP por revisar/ }).click();
    await page.getByText('Con comentario').first().waitFor();
  },
});
await shoot('28-airline-scoring', `airlines/${MXL.slug}`, { airlineId: MXL.id, waitFor: 'Puntuación de PIREP' });

await browser.close();

for (const r of results) {
  if (!r.ok) console.log(`::error title=FALLA::${r.name}: ${r.detail}`);
}
// Un solo resumen: GitHub limita las anotaciones por paso.
console.log(`::notice title=Revisión visual::${results.filter((r) => r.ok).map((r) => r.name).join(', ')}`);
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} pantallas sin errores`);
process.exit(failed.length ? 1 : 0);
