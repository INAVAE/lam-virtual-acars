-- Pruebas de actitud: reglas de alabeo y cabeceo excesivos y actitud anormal (upset).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(9);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a7', 'piloto@actitud.test', '{"display_name":"Piloto Actitud"}');

insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, 'actitud-aerolinea', 'Prueba Actitud', 'QQA', true from organizations where slug = 'lam';

insert into airports (icao_code, iata_code, name, city, country_code, latitude, longitude, elevation_ft, airport_type) values
  ('MMMX', 'MEX', 'Aeropuerto Internacional de la Ciudad de México', 'Ciudad de México', 'MX', 19.4363, -99.0721, 7316, 'large_airport'),
  ('MMGL', 'GDL', 'Aeropuerto Internacional de Guadalajara', 'Guadalajara', 'MX', 20.5218, -103.3112, 5016, 'large_airport')
on conflict (icao_code) do nothing;

create temp table t on commit drop as
select
  (select id from airlines where slug = 'actitud-aerolinea') as airline,
  (select id from aircraft_types where icao_code = 'A20N') as a20n,
  (select id from airports where icao_code = 'MMMX') as mmmx,
  (select id from airports where icao_code = 'MMGL') as mmgl,
  encode(extensions.digest('lamd_token_actitud', 'sha256'), 'hex') as token,
  null::uuid as flight,
  gen_random_uuid() as session;
grant select on t to authenticated, service_role;

insert into airline_memberships (airline_id, user_id, roles, status)
select airline, '00000000-0000-0000-0000-0000000000a7', '{pilot}'::airline_role[], 'active'::membership_status from t;
insert into pilot_type_ratings (airline_id, user_id, aircraft_type_id)
select airline, '00000000-0000-0000-0000-0000000000a7', a20n from t;
insert into aircraft (airline_id, aircraft_type_id, registration, current_airport_id)
select airline, a20n, 'XA-QA1', mmmx from t;
insert into routes (airline_id, flight_number, origin_airport_id, destination_airport_id)
select airline, '800', mmmx, mmgl from t;
insert into acars_devices (user_id, name, token_hash, token_prefix)
select '00000000-0000-0000-0000-0000000000a7', 'PC Actitud', token, 'lamd_ac' from t;

-- Reglas
select is(
  (select count(*)::integer from pirep_scoring_rules
    where rule_code in ('bank_excess', 'pitch_up_excess', 'pitch_down_excess', 'attitude_upset') and enabled),
  4 * (select count(*)::integer from airlines),
  'Las cuatro reglas de actitud llegan activas a todas las aerolíneas'
);
select results_eq(
  $$select rule_code, threshold, penalty::int, critical from pirep_scoring_rules
     where airline_id = (select airline from t)
       and rule_code in ('bank_excess', 'pitch_up_excess', 'pitch_down_excess', 'attitude_upset')
     order by rule_code$$,
  $$values ('attitude_upset'::text, null::numeric, 15, true), ('bank_excess', 35, 5, false),
           ('pitch_down_excess', 7.5, 5, false), ('pitch_up_excess', 20, 5, false)$$,
  'Una aerolínea nueva recibe los umbrales recomendados'
);

-- Reserva y sesión activa
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a7"}';
select book_flight((select id from routes where flight_number = '800' and airline_id = (select airline from t)),
                   (select id from aircraft where registration = 'XA-QA1'), 'QQA800');
reset role;
update t set flight = (select id from flights where callsign = 'QQA800');
update flights set status = 'in_progress' where id = (select flight from t);
insert into flight_sessions (id, flight_id, device_id, user_id, airline_id, started_at)
select session, flight, (select id from acars_devices where name = 'PC Actitud'), '00000000-0000-0000-0000-0000000000a7', airline, now() - interval '2 hours' from t;

-- Eventos: dos alabeos (uno a la izquierda), un cabeceo arriba y uno abajo, todos bajo el umbral de upset.
insert into flight_events (id, flight_id, session_id, user_id, airline_id, seq, type, phase, occurred_at, data)
select gen_random_uuid(), flight, session, '00000000-0000-0000-0000-0000000000a7', airline, e.seq, e.type, e.phase, now() - e.ago, e.data
from t, (values
  (0, 'block_off', 'pushback', interval '105 minutes', '{"fuel_kg":6000}'::jsonb),
  (1, 'takeoff', 'initial_climb', interval '95 minutes', '{"fuel_kg":5850}'::jsonb),
  (2, 'note', 'initial_climb', interval '94 minutes', '{"kind":"attitude","axis":"pitch_up","peak_deg":22.4,"seconds":6}'::jsonb),
  (3, 'note', 'climb', interval '90 minutes', '{"kind":"attitude","axis":"bank","peak_deg":38.2,"seconds":4}'::jsonb),
  (4, 'note', 'descent', interval '60 minutes', '{"kind":"attitude","axis":"bank","peak_deg":-41,"seconds":3}'::jsonb),
  (5, 'note', 'descent', interval '55 minutes', '{"kind":"attitude","axis":"pitch_down","peak_deg":-8.4,"seconds":5}'::jsonb),
  (6, 'note', 'descent', interval '50 minutes', '{"kind":"apu","state":"start"}'::jsonb),
  (7, 'touchdown', 'landing', interval '40 minutes', '{"vs_fpm":-210,"fuel_kg":1000}'::jsonb),
  (8, 'block_on', 'taxi_in', interval '35 minutes', '{"fuel_kg":950}'::jsonb)
) as e(seq, type, phase, ago, data);

set local role service_role;
select is(
  acars_session_end((select token from t), (select session from t), 'completed', 20.52, -103.31) -> 'pirep' ->> 'status',
  'pending', 'El vuelo genera su PIREP'
);
reset role;

select results_eq(
  $$select x ->> 'code', (x ->> 'value')::numeric, (x ->> 'threshold')::numeric, x ->> 'unit', (x ->> 'penalty')::int
      from pireps p, jsonb_array_elements(p.findings) x
     where p.session_id = (select session from t) and x ->> 'code' like '%excess'
     order by x ->> 'code'$$,
  $$values ('bank_excess'::text, 41::numeric, 35::numeric, '°'::text, 5),
           ('pitch_down_excess', -8.4, 7.5, '°', 5),
           ('pitch_up_excess', 22.4, 20, '°', 5)$$,
  'Alabeo de 41°, cabeceo de +22.4° y de −8.4° pasan sus umbrales'
);
select is(
  (select score::int from pireps where session_id = (select session from t)),
  85, 'Cada exceso resta 5 puntos'
);
select is(
  (select has_critical from pireps where session_id = (select session from t)),
  false, 'Sin actitud anormal, ningún hallazgo es crítico'
);
select results_eq(
  $$select (metrics -> 'attitude' ->> 'excursions')::int, (metrics -> 'attitude' ->> 'max_bank_deg')::numeric,
           (metrics -> 'attitude' ->> 'max_pitch_up_deg')::numeric, (metrics -> 'attitude' ->> 'min_pitch_down_deg')::numeric
      from pireps where session_id = (select session from t)$$,
  $$values (4, 41::numeric, 22.4::numeric, -8.4::numeric)$$,
  'El PIREP resume las excursiones de actitud'
);

-- Mismo vuelo con un alabeo de 52°: actitud anormal, crítica.
delete from pireps where session_id = (select session from t);
insert into flight_events (id, flight_id, session_id, user_id, airline_id, seq, type, phase, occurred_at, data)
select gen_random_uuid(), flight, session, '00000000-0000-0000-0000-0000000000a7', airline, 9, 'note', 'approach',
       now() - interval '45 minutes', '{"kind":"attitude","axis":"bank","peak_deg":52,"seconds":7}'::jsonb
from t;
select ok(private.build_pirep((select session from t)) is not null, 'El PIREP se regenera');
select results_eq(
  $$select p.has_critical, p.score::int,
           exists (select 1 from jsonb_array_elements(p.findings) x where x ->> 'code' = 'attitude_upset' and (x ->> 'critical')::boolean)
      from pireps p where p.session_id = (select session from t)$$,
  $$values (true, 70, true)$$,
  'Un alabeo de 52° es actitud anormal: crítico y −15'
);

select * from finish();
rollback;
