-- Pruebas del combustible: traza con fuel_kg, resumen en el PIREP, plan de SimBrief y regla de reserva.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(12);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', 'piloto@fuel.test', '{"display_name":"Piloto Fuel"}');

insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, 'fuel-aerolinea', 'Prueba Combustible', 'QQF', true from organizations where slug = 'lam';

insert into airports (icao_code, iata_code, name, city, country_code, latitude, longitude, elevation_ft, airport_type) values
  ('MMMX', 'MEX', 'Aeropuerto Internacional de la Ciudad de México', 'Ciudad de México', 'MX', 19.4363, -99.0721, 7316, 'large_airport'),
  ('MMGL', 'GDL', 'Aeropuerto Internacional de Guadalajara', 'Guadalajara', 'MX', 20.5218, -103.3112, 5016, 'large_airport')
on conflict (icao_code) do nothing;

create temp table t on commit drop as
select
  (select id from airlines where slug = 'fuel-aerolinea') as airline,
  (select id from aircraft_types where icao_code = 'A20N') as a20n,
  (select id from airports where icao_code = 'MMMX') as mmmx,
  (select id from airports where icao_code = 'MMGL') as mmgl,
  encode(extensions.digest('lamd_token_fuel', 'sha256'), 'hex') as token,
  null::uuid as flight,
  gen_random_uuid() as session;
grant select on t to authenticated, service_role;

insert into airline_memberships (airline_id, user_id, roles, status)
select airline, '00000000-0000-0000-0000-0000000000f1', '{pilot}'::airline_role[], 'active'::membership_status from t;
insert into pilot_type_ratings (airline_id, user_id, aircraft_type_id)
select airline, '00000000-0000-0000-0000-0000000000f1', a20n from t;
insert into aircraft (airline_id, aircraft_type_id, registration, current_airport_id)
select airline, a20n, 'XA-QF1', mmmx from t;
insert into routes (airline_id, flight_number, origin_airport_id, destination_airport_id)
select airline, '700', mmmx, mmgl from t;
insert into acars_devices (user_id, name, token_hash, token_prefix)
select '00000000-0000-0000-0000-0000000000f1', 'PC Fuel', token, 'lamd_fu' from t;

-- La regla nueva llega desactivada a todas las aerolíneas.
select is(
  (select count(*)::integer from pirep_scoring_rules where rule_code = 'landing_below_reserve' and enabled),
  0, 'La regla de reserva está desactivada por omisión en todas las aerolíneas'
);
select is(
  (select count(*)::integer from pirep_scoring_rules where rule_code = 'landing_below_reserve' and airline_id = (select airline from t)),
  1, 'Una aerolínea nueva también recibe la regla de reserva'
);
update pirep_scoring_rules set enabled = true where airline_id = (select airline from t) and rule_code = 'landing_below_reserve';

-- Reserva, plan y sesión activa
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1"}';
select book_flight((select id from routes where flight_number = '700' and airline_id = (select airline from t)),
                   (select id from aircraft where registration = 'XA-QF1'), 'QQF700');
reset role;
update t set flight = (select id from flights where callsign = 'QQF700');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1"}';
insert into simbrief_ofps (flight_id, request_id, origin_icao, destination_icao, aircraft_icao, registration, atc_callsign,
                           fuel_units, block_fuel, trip_fuel, reserve_fuel)
select flight, '9', 'MMMX', 'MMGL', 'A20N', 'XA-QF1', 'QQF700', 'kg', 6000, 1700, 1100 from t;
reset role;
update flights set status = 'in_progress' where id = (select flight from t);
insert into flight_sessions (id, flight_id, device_id, user_id, airline_id, started_at)
select session, flight, (select id from acars_devices where name = 'PC Fuel'), '00000000-0000-0000-0000-0000000000f1', airline, now() - interval '2 hours' from t;

-- El conector envía el combustible en la traza.
set local role service_role;
select is(
  (acars_track_batch((select token from t), (select session from t), jsonb_build_array(
    jsonb_build_object('seq', 0, 'sampled_at', now() - interval '110 minutes', 'latitude', 19.43, 'longitude', -99.07, 'altitude_ft', 7316,
                       'gs_kt', 0, 'ias_kt', 0, 'vs_fpm', 0, 'heading_deg', 270, 'on_ground', true, 'phase', 'preflight', 'fuel_kg', 6000.4),
    jsonb_build_object('seq', 1, 'sampled_at', now() - interval '100 minutes', 'latitude', 19.44, 'longitude', -99.08, 'altitude_ft', 7316,
                       'gs_kt', 15, 'ias_kt', 15, 'vs_fpm', 0, 'heading_deg', 270, 'on_ground', true, 'phase', 'taxi_out', 'fuel_kg', 5900),
    jsonb_build_object('seq', 2, 'sampled_at', now() - interval '80 minutes', 'latitude', 19.8, 'longitude', -100.5, 'altitude_ft', 20000,
                       'gs_kt', 380, 'ias_kt', 280, 'vs_fpm', 2000, 'heading_deg', 280, 'on_ground', false, 'phase', 'climb', 'fuel_kg', 5000),
    jsonb_build_object('seq', 3, 'sampled_at', now() - interval '60 minutes', 'latitude', 20.1, 'longitude', -102.0, 'altitude_ft', 34000,
                       'gs_kt', 450, 'ias_kt', 270, 'vs_fpm', 0, 'heading_deg', 280, 'on_ground', false, 'phase', 'cruise', 'fuel_kg', 3000),
    jsonb_build_object('seq', 4, 'sampled_at', now() - interval '42 minutes', 'latitude', 20.5, 'longitude', -103.3, 'altitude_ft', 5100,
                       'gs_kt', 140, 'ias_kt', 138, 'vs_fpm', -700, 'heading_deg', 280, 'on_ground', false, 'phase', 'approach', 'fuel_kg', 1100),
    jsonb_build_object('seq', 5, 'sampled_at', now() - interval '36 minutes', 'latitude', 20.52, 'longitude', -103.31, 'altitude_ft', 5016,
                       'gs_kt', 10, 'ias_kt', 10, 'vs_fpm', 0, 'heading_deg', 100, 'on_ground', true, 'phase', 'taxi_in', 'fuel_kg', 950)
  )) ->> 'inserted')::integer,
  6, 'La traza con combustible se guarda'
);
reset role;
select is(
  (select fuel_kg from flight_track_points where flight_id = (select flight from t) and seq = 0),
  6000, 'El combustible se guarda en kg enteros'
);

-- Eventos del vuelo (como los enviaría el conector)
insert into flight_events (id, flight_id, session_id, user_id, airline_id, seq, type, phase, occurred_at, data)
select gen_random_uuid(), flight, session, '00000000-0000-0000-0000-0000000000f1', airline, e.seq, e.type, e.phase, now() - e.ago, e.data
from t, (values
  (0, 'block_off', 'pushback', interval '105 minutes', '{"fuel_kg":6000}'::jsonb),
  (1, 'takeoff', 'initial_climb', interval '95 minutes', '{"fuel_kg":5850}'::jsonb),
  (2, 'touchdown', 'landing', interval '40 minutes', '{"vs_fpm":-210,"fuel_kg":1000}'::jsonb),
  (3, 'block_on', 'taxi_in', interval '35 minutes', '{"fuel_kg":950}'::jsonb)
) as e(seq, type, phase, ago, data);

set local role service_role;
select is(
  acars_session_end((select token from t), (select session from t), 'completed', 20.52, -103.31) -> 'pirep' ->> 'status',
  'pending', 'El vuelo genera su PIREP'
);
reset role;

create temp table fuel on commit drop as
select metrics -> 'fuel' as f, findings, score from pireps where session_id = (select session from t);

select results_eq(
  $$select (f ->> 'block_off_kg')::int, (f ->> 'takeoff_kg')::int, (f ->> 'landing_kg')::int, (f ->> 'block_on_kg')::int from fuel$$,
  $$values (6000, 5850, 1000, 950)$$,
  'Niveles en calzos fuera, despegue, aterrizaje y calzos puestos'
);
select results_eq(
  $$select (f ->> 'taxi_out_kg')::int, (f ->> 'trip_kg')::int, (f ->> 'taxi_in_kg')::int, (f ->> 'used_kg')::int, (f ->> 'samples')::int from fuel$$,
  $$values (150, 4850, 50, 5050, 6)$$,
  'Consumo en rodaje de salida, en viaje, en rodaje de llegada y total'
);
select results_eq(
  $$select (f -> 'stages' -> 'taxi_out' ->> 'kg')::int, (f -> 'stages' -> 'climb' ->> 'kg')::int, (f -> 'stages' -> 'cruise' ->> 'kg')::int,
           (f -> 'stages' -> 'descent' ->> 'kg')::int, (f -> 'stages' -> 'taxi_in' ->> 'kg')::int from fuel$$,
  $$values (100, 900, 2000, 1900, 150)$$,
  'Consumo por etapa a partir de la traza'
);
select is(
  (select (f -> 'stages' -> 'cruise' ->> 'kg_per_hour')::int from fuel),
  6000, 'Flujo promedio por etapa en kg/h'
);
select results_eq(
  $$select (f -> 'plan' ->> 'block_kg')::int, (f -> 'plan' ->> 'trip_kg')::int, (f -> 'plan' ->> 'reserve_kg')::int, f -> 'plan' ->> 'units' from fuel$$,
  $$values (6000, 1700, 1100, 'kg'::text)$$,
  'El PIREP guarda el plan de combustible de SimBrief'
);
select results_eq(
  $$select x ->> 'code', (x ->> 'value')::int, (x ->> 'threshold')::int, x ->> 'unit', (x ->> 'penalty')::int
      from fuel, jsonb_array_elements(findings) x where x ->> 'code' = 'landing_below_reserve'$$,
  $$values ('landing_below_reserve'::text, 1000, 1100, 'kg'::text, 10)$$,
  'Aterrizar con 1,000 kg y reserva de 1,100 kg resta 10 puntos'
);
select is((select score::int from fuel), 90, 'El puntaje refleja la regla de reserva');

select * from finish();
rollback;
