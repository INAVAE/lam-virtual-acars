-- Fase 6: mapa en vivo, estadísticas, Operations Center y rendimiento de pilotos.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(24);

-- Personas: dos pilotos (A en vuelo, B con historial), un jefe de operaciones (C) y alguien ajeno (D).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000006a1', 'a@f6.test', '{"display_name":"Piloto A"}'),
  ('00000000-0000-0000-0000-0000000006b2', 'b@f6.test', '{"display_name":"Piloto B"}'),
  ('00000000-0000-0000-0000-0000000006c3', 'c@f6.test', '{"display_name":"Jefe C"}'),
  ('00000000-0000-0000-0000-0000000006d4', 'd@f6.test', '{"display_name":"Ajeno D"}');

insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, 'fase6-aerolinea', 'Prueba Fase 6', 'QQS', true from organizations where slug = 'lam';
insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, 'fase6-otra', 'Otra Fase 6', 'QQT', true from organizations where slug = 'lam';

insert into airports (icao_code, iata_code, name, city, country_code, latitude, longitude, elevation_ft, airport_type) values
  ('MMMX', 'MEX', 'Aeropuerto Internacional de la Ciudad de México', 'Ciudad de México', 'MX', 19.4363, -99.0721, 7316, 'large_airport'),
  ('MMGL', 'GDL', 'Aeropuerto Internacional de Guadalajara', 'Guadalajara', 'MX', 20.5218, -103.3112, 5016, 'large_airport'),
  ('MMMY', 'MTY', 'Aeropuerto Internacional de Monterrey', 'Monterrey', 'MX', 25.7785, -100.1069, 1278, 'large_airport')
on conflict (icao_code) do nothing;

create temp table t on commit drop as
select
  (select id from airlines where slug = 'fase6-aerolinea') as airline,
  (select id from airlines where slug = 'fase6-otra') as other,
  (select id from aircraft_types where icao_code = 'A20N') as a20n,
  (select id from airports where icao_code = 'MMMX') as mmmx,
  (select id from airports where icao_code = 'MMGL') as mmgl,
  (select id from airports where icao_code = 'MMMY') as mmmy,
  gen_random_uuid() as flight_a, gen_random_uuid() as session_a,
  gen_random_uuid() as flight_b1, gen_random_uuid() as session_b1,
  gen_random_uuid() as flight_b2, gen_random_uuid() as session_b2,
  gen_random_uuid() as flight_b3, gen_random_uuid() as booking_b3,
  gen_random_uuid() as device;
grant select on t to authenticated;

insert into airline_memberships (airline_id, user_id, roles, status)
select airline, u.id, u.roles::airline_role[], 'active'::membership_status
  from t, (values
    ('00000000-0000-0000-0000-0000000006a1'::uuid, '{pilot}'),
    ('00000000-0000-0000-0000-0000000006b2'::uuid, '{pilot}'),
    ('00000000-0000-0000-0000-0000000006c3'::uuid, '{ops_chief}')
  ) as u(id, roles);
insert into airline_memberships (airline_id, user_id, roles, status)
select other, '00000000-0000-0000-0000-0000000006d4', '{pilot}'::airline_role[], 'active'::membership_status from t;

insert into aircraft (airline_id, aircraft_type_id, registration, base_airport_id, current_airport_id)
select airline, a20n, r.reg, mmmx, r.cur from t,
  lateral (values ('XA-QS1', t.mmmx), ('XA-QS2', t.mmgl), ('XA-QS3', t.mmmx)) as r(reg, cur);

insert into acars_devices (id, user_id, name, token_hash, token_prefix)
select device, '00000000-0000-0000-0000-0000000006a1', 'PC A', encode(extensions.digest('lamd_f6', 'sha256'), 'hex'), 'lamd_f6' from t;

-- Vuelos: A en curso; B con uno aceptado y otro pendiente; B3 reservado sin iniciar (salida atrasada).
insert into flights (id, airline_id, user_id, aircraft_id, aircraft_type_id, aircraft_registration, airline_icao, flight_number,
                     callsign, origin_airport_id, destination_airport_id, planned_distance_nm, planned_minutes,
                     scheduled_departure_at, operation_type, network, status, started_at, completed_at)
select f.id, airline, f.uid, (select id from aircraft where registration = f.reg), a20n, f.reg, 'QQS', f.num, f.cs,
       f.o, f.d, 250, 70, f.sched, 'passenger', 'IVAO', f.st::flight_status, f.started, f.completed
  from t, lateral (values
    (t.flight_a, '00000000-0000-0000-0000-0000000006a1'::uuid, 'XA-QS1', '901', 'QQS901', t.mmmx, t.mmgl, null::timestamptz, 'in_progress', now() - interval '40 minutes', null::timestamptz),
    (t.flight_b1, '00000000-0000-0000-0000-0000000006b2'::uuid, 'XA-QS2', '902', 'QQS902', t.mmmx, t.mmgl, null, 'completed', now() - interval '3 days', now() - interval '3 days'),
    (t.flight_b2, '00000000-0000-0000-0000-0000000006b2'::uuid, 'XA-QS2', '903', 'QQS903', t.mmgl, t.mmmx, null, 'completed', now() - interval '2 hours', now() - interval '1 hour'),
    (t.flight_b3, '00000000-0000-0000-0000-0000000006b2'::uuid, 'XA-QS3', '904', 'QQS904', t.mmmx, t.mmmy, now() - interval '1 hour', 'scheduled', null, null)
  ) as f(id, uid, reg, num, cs, o, d, sched, st, started, completed);

insert into flight_bookings (id, airline_id, user_id, aircraft_id, status, expires_at)
select booking_b3, airline, '00000000-0000-0000-0000-0000000006b2', (select id from aircraft where registration = 'XA-QS3'), 'active', now() + interval '2 hours' from t;
update flights set booking_id = (select booking_b3 from t) where id = (select flight_b3 from t);

insert into flight_sessions (id, flight_id, device_id, user_id, airline_id, status, phase, started_at, last_contact_at, ended_at)
select s.id, s.f, device, s.uid, airline, s.st, s.ph, s.started, s.contact, s.ended
  from t, lateral (values
    (t.session_a, t.flight_a, '00000000-0000-0000-0000-0000000006a1'::uuid, 'active', 'approach', now() - interval '40 minutes', now() - interval '5 minutes', null::timestamptz),
    (t.session_b1, t.flight_b1, '00000000-0000-0000-0000-0000000006b2'::uuid, 'completed', 'taxi_in', now() - interval '3 days', now() - interval '3 days', now() - interval '3 days'),
    (t.session_b2, t.flight_b2, '00000000-0000-0000-0000-0000000006b2'::uuid, 'completed', 'taxi_in', now() - interval '2 hours', now() - interval '1 hour', now() - interval '1 hour')
  ) as s(id, f, uid, st, ph, started, contact, ended);

-- Posición viva de A en aproximación, lejos del destino (posible desvío), y su traza.
insert into flight_positions_live (flight_id, session_id, user_id, airline_id, sampled_at, latitude, longitude, altitude_ft, ias_kt, gs_kt, heading_deg, vs_fpm, on_ground, phase)
select flight_a, session_a, '00000000-0000-0000-0000-0000000006a1', airline, now() - interval '5 minutes', 19.9, -101.0, 9000, 210, 260, 280, -900, false, 'approach' from t;
insert into flight_track_points (flight_id, session_id, user_id, airline_id, seq, sampled_at, latitude, longitude, altitude_ft, gs_kt, ias_kt, vs_fpm, heading_deg, on_ground, phase)
select flight_a, session_a, '00000000-0000-0000-0000-0000000006a1', airline, g, now() - make_interval(mins => 40 - g * 10),
       19.44 + g * 0.1, -99.07 - g * 0.5, 7316 + g * 5000, 250, 220, 0, 280, false, 'climb'
  from t, generate_series(0, 2) g;
insert into flight_events (id, flight_id, session_id, user_id, airline_id, seq, type, phase, occurred_at, data)
select gen_random_uuid(), flight_a, session_a, '00000000-0000-0000-0000-0000000006a1', airline, e.seq, e.type, e.phase, now() - e.ago, e.data
  from t, (values
    (0, 'note', 'climb', interval '30 minutes', '{"kind":"attitude","axis":"bank","peak_deg":38}'::jsonb),
    (1, 'sim_paused', 'cruise', interval '20 minutes', '{}'::jsonb)
  ) as e(seq, type, phase, ago, data);

-- PIREP de B: uno aceptado hace 3 días y uno pendiente con falta grave.
insert into pireps (flight_id, session_id, airline_id, user_id, aircraft_type_id, aircraft_registration, callsign, flight_number,
                    origin_airport_id, destination_airport_id, arrival_airport_id, block_on_at, block_minutes, distance_nm,
                    landing_vs_fpm, score, findings, has_critical, status, reviewed_at)
select p.f, p.s, airline, '00000000-0000-0000-0000-0000000006b2', a20n, 'XA-QS2', p.cs, p.num, p.o, p.d, p.d, p.on_at, 75, 250,
       p.vs, p.score, p.findings, p.critical, p.st::pirep_status, p.reviewed
  from t, lateral (values
    (t.flight_b1, t.session_b1, 'QQS902', '902', t.mmmx, t.mmgl, now() - interval '40 days', -180, 95,
     '[{"code":"taxi_speed","label":"Rodaje rápido","penalty":5,"critical":false}]'::jsonb, false, 'accepted', now() - interval '2 days'),
    (t.flight_b2, t.session_b2, 'QQS903', '903', t.mmgl, t.mmmx, now() - interval '1 hour', -650, 60,
     '[{"code":"landing_hard","label":"Aterrizaje duro","penalty":20,"critical":false},{"code":"diversion","label":"Desvío","penalty":0,"critical":true}]'::jsonb,
     true, 'pending', null::timestamptz)
  ) as p(f, s, cs, num, o, d, on_at, vs, score, findings, critical, st, reviewed);

-- ---------------------------------------------------------------------------
-- Mapa en vivo
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006b2"}';
create temp table live_b on commit drop as select get_live_flights(null) as j;
select is((select jsonb_array_length(j) from live_b), 1, 'Un piloto ve los vuelos en curso de su aerolínea');
select results_eq(
  $$select j -> 0 ->> 'callsign', (j -> 0 ->> 'is_mine')::boolean, j -> 0 -> 'pilot' ->> 'name', j -> 0 -> 'destination' ->> 'icao', j -> 0 ->> 'phase' from live_b$$,
  $$values ('QQS901'::text, false, 'Piloto A'::text, 'MMGL'::text, 'approach'::text)$$,
  'El vuelo trae callsign, piloto, destino y fase'
);
select ok((select (j -> 0 -> 'position' ->> 'altitude_ft')::int = 9000 and (j -> 0 ->> 'remaining_nm')::int > 25 from live_b),
  'El vuelo trae su posición y la distancia restante');
select ok((select j -> 0 -> 'alerts' = 'null'::jsonb from live_b), 'Un piloto no recibe las alertas de operación');
select is(jsonb_array_length(get_live_flight_track((select flight_a from t))), 3, 'Un miembro ve la traza del vuelo en curso');
select is(get_live_flight_track((select flight_b1 from t)), '[]'::jsonb, 'Un vuelo terminado no expone su traza');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006a1"}';
select ok((select (get_live_flights(null) -> 0 ->> 'is_mine')::boolean), 'El piloto reconoce su propio vuelo');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006d4"}';
select is(jsonb_array_length(get_live_flights(null)), 0, 'Alguien de otra aerolínea no ve estos vuelos');
select throws_ok(
  format('select get_live_flights(%L)', (select airline from t)), '42501', null,
  'Pedir una aerolínea ajena falla'
);
select throws_ok(
  format('select get_live_flight_track(%L)', (select flight_a from t)), '42501', null,
  'La traza de un vuelo ajeno no se puede leer'
);

-- Alertas para el staff
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006c3"}';
create temp table live_c on commit drop as
select jsonb_agg(a ->> 'code' order by a ->> 'code') as codes
  from jsonb_array_elements(get_live_flights((select airline from t)) -> 0 -> 'alerts') a;
select is(
  (select codes from live_c),
  '["attitude", "diversion_risk", "no_signal", "paused"]'::jsonb,
  'El jefe de operaciones ve sin señal, pausa, posible desvío y el exceso de alabeo'
);

-- ---------------------------------------------------------------------------
-- Estadísticas (miembros)
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006a1"}';
create temp table stats on commit drop as select get_airline_statistics((select airline from t), 6) as j;
select results_eq(
  $$select (j -> 'totals' ->> 'flights')::int, (j -> 'totals' ->> 'block_minutes')::int, (j -> 'totals' ->> 'pilots')::int, (j -> 'totals' ->> 'airports')::int from stats$$,
  $$values (1, 75, 1, 2)$$,
  'Los totales cuentan solo los PIREP aceptados'
);
select is((select jsonb_array_length(j -> 'monthly') from stats), 6, 'La serie mensual trae todos los meses pedidos');
select results_eq(
  $$select j -> 'ranking' -> 0 ->> 'name', (j -> 'ranking' -> 0 ->> 'flights')::int, (j -> 'ranking' -> 0 ->> 'best_landing_vs_fpm')::int from stats$$,
  $$values ('Piloto B'::text, 1, -180)$$,
  'Cualquier piloto ve el ranking de la aerolínea'
);
select is(
  (select (x ->> 'flights')::int from stats, jsonb_array_elements(j -> 'landings') x where x ->> 'bucket' = 'soft'),
  1, 'Un aterrizaje de −180 fpm cae en el grupo de −100 a −200'
);
select results_eq(
  $$select j -> 'top_routes' -> 0 ->> 'origin', j -> 'top_routes' -> 0 ->> 'destination' from stats$$,
  $$values ('MMMX'::text, 'MMGL'::text)$$,
  'Las rutas más voladas salen de los PIREP aceptados'
);
select is(
  (select jsonb_agg(x ->> 'code' order by x ->> 'code') from stats, jsonb_array_elements(j -> 'common_findings') x),
  '["landing_hard", "taxi_speed"]'::jsonb,
  'Las faltas frecuentes ignoran las informativas'
);

-- ---------------------------------------------------------------------------
-- Operations Center y rendimiento (staff)
-- ---------------------------------------------------------------------------
select throws_ok('select get_operations_overview(null)', '42501', null, 'Un piloto no abre el Operations Center');
select throws_ok('select get_pilot_performance(null, 90)', '42501', null, 'Un piloto no ve el rendimiento de los demás');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000006c3"}';
create temp table ops on commit drop as select get_operations_overview(null) as j;
select results_eq(
  $$select j -> 'departures' -> 0 ->> 'callsign', j -> 'departures' -> 0 ->> 'state', (j -> 'departures' -> 0 ->> 'has_ofp')::boolean from ops$$,
  $$values ('QQS904'::text, 'late'::text, false)$$,
  'Las salidas muestran el vuelo atrasado y sin OFP'
);
select results_eq(
  $$select j -> 'pirep_queue' -> 0 ->> 'callsign', (j -> 'pirep_queue' -> 0 ->> 'has_critical')::boolean, j -> 'pirep_queue' -> 0 -> 'critical_labels' from ops$$,
  $$values ('QQS903'::text, true, '["Desvío"]'::jsonb)$$,
  'La cola de PIREP trae las faltas graves'
);
select results_eq(
  $$select x ->> 'registration', x ->> 'usage', x ->> 'usage_callsign', (x ->> 'away_from_base')::boolean
      from ops, jsonb_array_elements(j -> 'fleet') x order by 1$$,
  $$values ('XA-QS1'::text, 'flying'::text, 'QQS901'::text, false), ('XA-QS2', null, null, true), ('XA-QS3', 'booked', 'QQS904', false)$$,
  'La flota indica qué aeronave vuela, cuál está reservada y cuál está fuera de base'
);
select results_eq(
  $$select x ->> 'name', (x ->> 'flights')::int, (x ->> 'critical_findings')::int, x -> 'top_findings' ->> 0
      from jsonb_array_elements(get_pilot_performance(null, 30) -> 'pilots') x order by 1$$,
  $$values ('Piloto A'::text, 0, 0, null::text), ('Piloto B', 1, 1, 'Aterrizaje duro')$$,
  'El rendimiento cubre a todos los pilotos y solo el periodo pedido'
);
select is(
  (get_dashboard_summary((select airline from t)) ->> 'live_flights')::int,
  1, 'El dashboard cuenta los vuelos en el aire'
);

reset role;
select * from finish();
rollback;
