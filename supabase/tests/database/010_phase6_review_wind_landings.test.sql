-- Pruebas de la Fase 6 (2.ª parte): viento, salida directa, anulación de faltas, archivo y estadísticas de aterrizaje.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(31);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000b1', 'piloto@viento.test', '{"display_name":"Piloto Viento"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'jefe@viento.test', '{"display_name":"Jefe Viento"}'),
  ('00000000-0000-0000-0000-0000000000b3', 'super@viento.test', '{"display_name":"Super Viento"}'),
  ('00000000-0000-0000-0000-0000000000b4', 'ajeno@viento.test', '{"display_name":"Ajeno Viento"}');

insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, 'viento-aerolinea', 'Prueba Viento', 'QQW', true from organizations where slug = 'lam';
insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, 'viento-otra', 'Prueba Viento Otra', 'QQX', true from organizations where slug = 'lam';
insert into organization_members (organization_id, user_id, role)
select id, '00000000-0000-0000-0000-0000000000b3', 'superadmin' from organizations where slug = 'lam';

insert into airports (icao_code, iata_code, name, city, country_code, latitude, longitude, elevation_ft, airport_type) values
  ('MMMX', 'MEX', 'Aeropuerto Internacional de la Ciudad de México', 'Ciudad de México', 'MX', 19.4363, -99.0721, 7316, 'large_airport'),
  ('MMGL', 'GDL', 'Aeropuerto Internacional de Guadalajara', 'Guadalajara', 'MX', 20.5218, -103.3112, 5016, 'large_airport')
on conflict (icao_code) do nothing;

create temp table t on commit drop as
select
  (select id from airlines where slug = 'viento-aerolinea') as airline,
  (select id from aircraft_types where icao_code = 'A20N') as a20n,
  (select id from airports where icao_code = 'MMMX') as mmmx,
  (select id from airports where icao_code = 'MMGL') as mmgl,
  encode(extensions.digest('lamd_token_viento', 'sha256'), 'hex') as token,
  null::uuid as flight,
  gen_random_uuid() as session,
  null::uuid as pirep;
grant select on t to authenticated, service_role;

insert into airline_memberships (airline_id, user_id, roles, status)
select airline, '00000000-0000-0000-0000-0000000000b1'::uuid, '{pilot}'::airline_role[], 'active'::membership_status from t union all
select airline, '00000000-0000-0000-0000-0000000000b2'::uuid, '{ops_chief,pilot}'::airline_role[], 'active'::membership_status from t union all
select (select id from airlines where slug = 'viento-otra'), '00000000-0000-0000-0000-0000000000b4'::uuid, '{pilot}'::airline_role[], 'active'::membership_status;
insert into pilot_type_ratings (airline_id, user_id, aircraft_type_id)
select airline, '00000000-0000-0000-0000-0000000000b1', a20n from t;
insert into aircraft (airline_id, aircraft_type_id, registration, current_airport_id)
select airline, a20n, 'XA-QW1', mmmx from t;
insert into routes (airline_id, flight_number, origin_airport_id, destination_airport_id)
select airline, '900', mmmx, mmgl from t;
insert into acars_devices (user_id, name, token_hash, token_prefix)
select '00000000-0000-0000-0000-0000000000b1', 'PC Viento', token, 'lamd_vi' from t;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1"}';
select book_flight((select id from routes where flight_number = '900' and airline_id = (select airline from t)),
                   (select id from aircraft where registration = 'XA-QW1'), 'QQW900');
reset role;
update t set flight = (select id from flights where callsign = 'QQW900');
update flights set status = 'in_progress' where id = (select flight from t);
insert into flight_sessions (id, flight_id, device_id, user_id, airline_id, started_at)
select session, flight, (select id from acars_devices where name = 'PC Viento'), '00000000-0000-0000-0000-0000000000b1', airline, now() - interval '2 hours' from t;

-- Traza: rodaje (25 kt, luego 18 kt al entrar a la pista), salida directa acelerando
-- a 36 kt en rodaje, despegue con viento de cabeza y aproximación con cizalladura.
create temp table pts on commit drop as
select * from (values
  (0, 110, 'taxi_out', true, 7316, 15, 270, 0, 270, 10),
  (1, 108, 'taxi_out', true, 7316, 25, 270, 0, 270, 10),
  (2, 106, 'taxi_out', true, 7316, 18, 270, 0, 270, 10),
  (3, 105.95, 'taxi_out', true, 7316, 28, 270, 0, 270, 10),
  (4, 105.9, 'taxi_out', true, 7316, 36, 270, 0, 270, 10),
  (5, 105.85, 'takeoff', true, 7316, 90, 270, 0, 270, 12),
  (6, 105, 'initial_climb', false, 8500, 160, 270, 2000, 270, 14),
  (7, 90, 'cruise', false, 34000, 450, 280, 0, 300, 85),
  (8, 45, 'approach', false, 7000, 150, 100, -700, 100, 20),
  (9, 44.5, 'approach', false, 6500, 145, 100, -700, 100, 2),
  (10, 44, 'approach', false, 6000, 140, 100, -700, 190, 10),
  (11, 42, 'taxi_in', true, 5016, 12, 100, 0, 100, 18)
) as v(seq, ago_min, phase, on_ground, alt, gs, hdg, vs, wind_dir, wind_kt);
grant select on pts to service_role;

set local role service_role;
select is(
  (acars_track_batch((select token from t), (select session from t), (
    select jsonb_agg(jsonb_build_object(
      'seq', p.seq, 'sampled_at', now() - make_interval(secs => (p.ago_min * 60)::double precision),
      'latitude', 19.4 + p.seq * 0.1, 'longitude', -99.1 - p.seq * 0.3, 'altitude_ft', p.alt,
      'gs_kt', p.gs, 'ias_kt', p.gs, 'vs_fpm', p.vs, 'heading_deg', p.hdg, 'on_ground', p.on_ground,
      'phase', p.phase, 'fuel_kg', 5000 - p.seq * 100, 'wind_dir_deg', p.wind_dir, 'wind_kt', p.wind_kt) order by p.seq)
    from pts p)) ->> 'inserted')::integer,
  12, 'La traza con viento se guarda'
);
select is(
  acars_position((select token from t), (select session from t), jsonb_build_object(
    'sampled_at', now() - interval '41 minutes', 'latitude', 20.5, 'longitude', -103.3, 'altitude_ft', 5016, 'agl_ft', 0,
    'ias_kt', 10, 'gs_kt', 10, 'heading_deg', 100, 'vs_fpm', 0, 'on_ground', true, 'phase', 'taxi_in',
    'wind_dir_deg', 95.4, 'wind_kt', 17.6)) ->> 'ok',
  'true', 'La posición viva acepta el viento'
);
reset role;
select results_eq(
  $$select wind_dir_deg::int, wind_kt::int from flight_positions_live where flight_id = (select flight from t)$$,
  $$values (95, 18)$$,
  'La posición viva guarda dirección y velocidad del viento'
);

insert into flight_events (id, flight_id, session_id, user_id, airline_id, seq, type, phase, occurred_at, data)
select gen_random_uuid(), flight, session, '00000000-0000-0000-0000-0000000000b1', airline, e.seq, e.type, e.phase,
       now() - make_interval(secs => (e.ago * 60)::double precision), e.data
from t, (values
  (0, 'block_off', 'pushback', 112.0, '{"fuel_kg":5100}'::jsonb),
  (1, 'takeoff', 'initial_climb', 105.1, '{"fuel_kg":4500}'::jsonb),
  (2, 'touchdown', 'landing', 43.0, '{"vs_fpm":-455,"g_force":1.3,"pitch_deg":4.1,"bank_deg":-1.2,"ias_kt":138,"fuel_kg":3900}'::jsonb),
  (3, 'block_on', 'taxi_in', 40.0, '{"fuel_kg":3850}'::jsonb)
) as e(seq, type, phase, ago, data);

set local role service_role;
select is(
  acars_session_end((select token from t), (select session from t), 'completed', 20.52, -103.31) -> 'pirep' ->> 'status',
  'pending', 'El vuelo genera su PIREP'
);
reset role;
update t set pirep = (select id from pireps where session_id = (select session from t));

-- Rodaje: la aceleración de la salida directa (28 y 36 kt) no cuenta.
select is((select (metrics ->> 'max_taxi_gs_kt')::int from pireps where id = (select pirep from t)), 25,
  'El rodaje rápido ignora la aceleración en la pista de una salida directa');
select ok(not exists (select 1 from pireps p, jsonb_array_elements(p.findings) f where p.id = (select pirep from t) and f ->> 'code' = 'taxi_speed'),
  'Sin falta de rodaje rápido');

-- Viento
create temp table w on commit drop as select metrics -> 'wind' as w from pireps where id = (select pirep from t);
grant select on w to authenticated;
select results_eq(
  $$select (w -> 'takeoff' ->> 'kt')::int, (w -> 'takeoff' ->> 'headwind_kt')::numeric, (w -> 'takeoff' ->> 'crosswind_kt')::numeric from w$$,
  $$values (14, 14.0::numeric, 0.0::numeric)$$,
  'Viento en el despegue: 14 kt de frente'
);
select results_eq(
  $$select (w -> 'max' ->> 'kt')::int, (w -> 'max' ->> 'altitude_ft')::int from w$$,
  $$values (85, 34000)$$,
  'Viento máximo del vuelo'
);
select is((select (w -> 'shear' ->> 'events')::int from w), 1, 'Una cizalladura en la aproximación');
select ok((select abs((w -> 'shear' ->> 'max_change_kt')::numeric) >= 15 from w), 'La cizalladura cambia 15 kt o más el viento de cabeza');
select is((select w -> 'shear' ->> 'phase' from w), 'approach', 'La cizalladura ocurrió en la aproximación');

-- Faltas: aterrizaje firme (−455 fpm)
select is((select score::int from pireps where id = (select pirep from t)), 95, 'Aterrizaje firme resta 5');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1"}';
select throws_ok(
  $$select waive_pirep_finding((select pirep from t), 'landing_firm', 'Yo lo digo')$$,
  '42501', null, 'El piloto no anula sus propias faltas'
);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2"}';
select throws_ok(
  $$select waive_pirep_finding((select pirep from t), 'landing_firm', '  ')$$,
  '22023', null, 'Anular exige motivo'
);
select throws_ok(
  $$select waive_pirep_finding((select pirep from t), 'crash', 'No aplica')$$,
  '22023', null, 'Solo se anulan faltas que el PIREP tiene'
);
select is(
  (waive_pirep_finding((select pirep from t), 'landing_firm', 'Pista con pendiente: el piloto lo explicó')).score::int,
  100, 'Anular la falta devuelve los 5 puntos'
);
select results_eq(
  $$select (f ->> 'waived')::boolean, f ->> 'waived_by_name', f ->> 'waived_reason'
      from pireps p, jsonb_array_elements(p.findings) f where p.id = (select pirep from t) and f ->> 'code' = 'landing_firm'$$,
  $$values (true, 'Jefe Viento'::text, 'Pista con pendiente: el piloto lo explicó'::text)$$,
  'La falta queda marcada como anulada, con quién y por qué'
);
select is(
  (waive_pirep_finding((select pirep from t), 'landing_firm', null, false)).score::int,
  95, 'Restaurar la falta vuelve a restar'
);
select lives_ok(
  $$select waive_pirep_finding((select pirep from t), 'landing_firm', 'Pista con pendiente')$$,
  'Se vuelve a anular'
);

-- Estadísticas de aterrizaje
select results_eq(
  $$select (s -> 'summary' ->> 'landings')::int, (s -> 'summary' ->> 'average_vs_fpm')::int,
           (s -> 'summary' ->> 'within_limits_rate')::numeric, (s -> 'recent' -> 0 ->> 'within_limits')::boolean
      from (select get_pilot_landing_stats('00000000-0000-0000-0000-0000000000b1') as s) x$$,
  $$values (1, -455, 1.000::numeric, true)$$,
  'Estadísticas de aterrizaje: una toma dentro de parámetros (la falta se anuló)'
);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b4"}';
select throws_ok(
  $$select get_pilot_landing_stats('00000000-0000-0000-0000-0000000000b1')$$,
  '42501', null, 'Un piloto de otra aerolínea no ve las estadísticas'
);

-- Aceptar y archivar: se restan las horas de la aeronave
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2"}';
select lives_ok($$select review_pirep((select pirep from t), 'accepted', null)$$, 'El jefe acepta el PIREP');
select throws_ok(
  $$select waive_pirep_finding((select pirep from t), 'landing_firm', null, false)$$,
  '55000', null, 'Las faltas solo se cambian en revisión'
);
reset role;
create temp table before_archive on commit drop as select total_minutes, cycles from aircraft where registration = 'XA-QW1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1"}';
select throws_ok($$select archive_pirep((select pirep from t), 'Quiero borrarlo')$$, '42501', null, 'El piloto no archiva');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2"}';
select is((archive_pirep((select pirep from t), 'Vuelo duplicado')).status::text, 'archived', 'El jefe de operaciones archiva el PIREP');
reset role;
select results_eq(
  $$select a.total_minutes + (select block_minutes from pireps where id = (select pirep from t)), a.cycles + 1
      from aircraft a where registration = 'XA-QW1'$$,
  $$select total_minutes, cycles from before_archive$$,
  'Al archivarlo se restan sus horas y su ciclo'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1"}';
select is((select count(*)::int from pireps where id = (select pirep from t)), 0, 'El piloto ya no ve el PIREP archivado');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2"}';
select throws_ok($$select restore_pirep((select pirep from t))$$, '42501', null, 'Solo el superadministrador restaura');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b3"}';
select is((select status::text from pireps where id = (select pirep from t)), 'archived', 'El superadministrador ve el archivado');
select is((restore_pirep((select pirep from t))).status::text, 'accepted', 'Restaurado a su estado anterior');
reset role;
select results_eq(
  $$select total_minutes, cycles from before_archive$$,
  $$select total_minutes, cycles from aircraft where registration = 'XA-QW1'$$,
  'Al restaurarlo vuelven sus horas y su ciclo'
);

select * from finish();
rollback;
