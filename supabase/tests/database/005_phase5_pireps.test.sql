-- Pruebas de la Fase 5: generación, puntuación, revisión y estadísticas de PIREP.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(44);

-- -----------------------------------------------------------------------------
-- Escenario: piloto, otro piloto, jefe de operaciones y administrador
-- -----------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000e1', 'piloto@p5.test', '{"display_name":"Piloto P5"}'),
  ('00000000-0000-0000-0000-0000000000e2', 'otro@p5.test', '{"display_name":"Otro P5"}'),
  ('00000000-0000-0000-0000-0000000000e3', 'jefe@p5.test', '{"display_name":"Jefe P5"}'),
  ('00000000-0000-0000-0000-0000000000e4', 'admin@p5.test', '{"display_name":"Admin P5"}');

insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, 'p5-aerolinea', 'Prueba PIREP', 'QQP', true from organizations where slug = 'lam';

insert into airports (icao_code, iata_code, name, city, country_code, latitude, longitude, elevation_ft, airport_type) values
  ('MMMX', 'MEX', 'Aeropuerto Internacional de la Ciudad de México', 'Ciudad de México', 'MX', 19.4363, -99.0721, 7316, 'large_airport'),
  ('MMGL', 'GDL', 'Aeropuerto Internacional de Guadalajara', 'Guadalajara', 'MX', 20.5218, -103.3112, 5016, 'large_airport')
on conflict (icao_code) do nothing;

create temp table t on commit drop as
select
  (select id from airlines where slug = 'p5-aerolinea') as airline,
  (select id from aircraft_types where icao_code = 'A20N') as a20n,
  (select id from airports where icao_code = 'MMMX') as mmmx,
  (select id from airports where icao_code = 'MMGL') as mmgl,
  encode(extensions.digest('lamd_token_p5', 'sha256'), 'hex') as token,
  null::uuid as aircraft,
  null::uuid as pirep1,
  null::uuid as pirep2,
  null::uuid as pirep3;
grant select on t to authenticated, service_role;

insert into airline_memberships (airline_id, user_id, roles, status)
select airline, '00000000-0000-0000-0000-0000000000e1'::uuid, '{pilot}'::airline_role[], 'active'::membership_status from t union all
select airline, '00000000-0000-0000-0000-0000000000e2'::uuid, '{pilot}'::airline_role[], 'active'::membership_status from t union all
select airline, '00000000-0000-0000-0000-0000000000e3'::uuid, '{ops_chief,pilot}'::airline_role[], 'active'::membership_status from t union all
select airline, '00000000-0000-0000-0000-0000000000e4'::uuid, '{airline_admin}'::airline_role[], 'active'::membership_status from t;
insert into pilot_type_ratings (airline_id, user_id, aircraft_type_id)
select airline, '00000000-0000-0000-0000-0000000000e1', a20n from t;
insert into aircraft (airline_id, aircraft_type_id, registration, current_airport_id)
select airline, a20n, 'XA-QP1', mmmx from t;
update t set aircraft = (select id from aircraft where registration = 'XA-QP1');
insert into routes (airline_id, flight_number, origin_airport_id, destination_airport_id)
select airline, '500', mmmx, mmgl from t union all
select airline, '501', mmgl, mmmx from t;
insert into acars_devices (user_id, name, token_hash, token_prefix)
select '00000000-0000-0000-0000-0000000000e1', 'PC P5', token, 'lamd_p5' from t;

-- Un vuelo simulado: reserva como el piloto, sesión activa con eventos y traza.
create function pg_temp.fly(
  p_route text, p_callsign text, p_vs integer, p_bounces integer, p_taxi_gs integer,
  p_ias_low integer, p_engines_at_start boolean, p_takeoff boolean
) returns uuid
language plpgsql
as $$
declare
  v_flight public.flights;
  v_session uuid := gen_random_uuid();
  v_t0 timestamptz := now() - interval '3 hours';
  v_seq integer := 0;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1"}', true);
  perform public.book_flight((select id from public.routes where flight_number = p_route and airline_id = (select airline from t)),
                             (select aircraft from t), p_callsign);
  perform set_config('role', 'postgres', true);
  select * into v_flight from public.flights where callsign = p_callsign;
  update public.flights set status = 'in_progress', started_at = v_t0 where id = v_flight.id;
  update public.aircraft set status = 'in_flight' where id = v_flight.aircraft_id;

  insert into public.flight_sessions (id, flight_id, device_id, user_id, airline_id, started_at, sim_aircraft_icao)
  values (v_session, v_flight.id, (select id from public.acars_devices where name = 'PC P5'), v_flight.user_id, v_flight.airline_id, v_t0, 'A20N');

  insert into public.flight_events (id, flight_id, session_id, user_id, airline_id, seq, type, phase, occurred_at, data)
  select gen_random_uuid(), v_flight.id, v_session, v_flight.user_id, v_flight.airline_id, row_number() over () - 1, e.type, e.phase, e.at, e.data
  from (values
    ('phase_change', case when p_engines_at_start then 'engines_started' else 'preflight' end, v_t0,
       case when p_engines_at_start then '{"from":"aircraft_connected","to":"engines_started","reason":"connected_on_ground"}'::jsonb
            else '{"from":"aircraft_connected","to":"preflight"}'::jsonb end),
    ('block_off', 'pushback', v_t0 + interval '5 minutes', '{"fuel_kg":6000}'::jsonb),
    ('takeoff', 'initial_climb', v_t0 + interval '15 minutes', '{"ias_kt":150,"flaps_deg":5}'::jsonb),
    ('touchdown', 'landing', v_t0 + interval '60 minutes',
       jsonb_build_object('vs_fpm', p_vs, 'g_force', 1.2, 'pitch_deg', 4.1, 'bank_deg', 1.0, 'bounces', p_bounces, 'flaps_deg', 30)),
    ('block_on', 'taxi_in', v_t0 + interval '65 minutes', '{"fuel_kg":4000}'::jsonb)
  ) as e(type, phase, at, data)
  where p_takeoff or e.type not in ('takeoff', 'touchdown');

  insert into public.flight_track_points (flight_id, seq, sampled_at, session_id, user_id, airline_id,
    latitude, longitude, altitude_ft, gs_kt, ias_kt, vs_fpm, heading_deg, on_ground, phase)
  values
    (v_flight.id, 0, v_t0 + interval '8 minutes', v_session, v_flight.user_id, v_flight.airline_id, 19.43, -99.07, 7316, p_taxi_gs, p_taxi_gs, 0, 270, true, 'taxi_out'),
    (v_flight.id, 1, v_t0 + interval '20 minutes', v_session, v_flight.user_id, v_flight.airline_id, 19.60, -99.60, 9500, 280, p_ias_low, 2000, 280, false, 'climb'),
    (v_flight.id, 2, v_t0 + interval '35 minutes', v_session, v_flight.user_id, v_flight.airline_id, 20.00, -101.00, 34000, 450, 280, 0, 280, false, 'cruise'),
    (v_flight.id, 3, v_t0 + interval '62 minutes', v_session, v_flight.user_id, v_flight.airline_id, 20.52, -103.30, 5016, 15, 15, 0, 100, true, 'taxi_in');
  return v_session;
end;
$$;

-- -----------------------------------------------------------------------------
-- Catálogo y reglas por aerolínea
-- -----------------------------------------------------------------------------
select is(
  (select count(*)::integer from pirep_scoring_rules where airline_id = (select airline from t)),
  (select count(*)::integer from pirep_rule_definitions),
  'Una aerolínea nueva recibe todas las reglas con sus valores por omisión'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1"}';
select is(
  (select count(*)::integer from pirep_scoring_rules where airline_id = (select airline from t)),
  (select count(*)::integer from pirep_rule_definitions),
  'El piloto ve las reglas de su aerolínea'
);
with u as (update pirep_scoring_rules set penalty = 0 where airline_id = (select airline from t) and rule_code = 'landing_hard' returning 1)
select is((select count(*)::integer from u), 0, 'El piloto no cambia las reglas');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e3"}';
with u as (update pirep_scoring_rules set penalty = 0 where airline_id = (select airline from t) and rule_code = 'landing_hard' returning 1)
select is((select count(*)::integer from u), 0, 'El jefe de operaciones revisa pero no configura la puntuación');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e4"}';
with u as (update pirep_scoring_rules set penalty = 25 where airline_id = (select airline from t) and rule_code = 'landing_hard' returning 1)
select is((select count(*)::integer from u), 1, 'El administrador de la aerolínea ajusta una regla');
select throws_ok(
  $$update pirep_scoring_rules set penalty = 150 where airline_id = (select airline from t) and rule_code = 'landing_hard'$$,
  '23514', null, 'La penalización va de 0 a 100'
);
select throws_ok(
  $$update pirep_scoring_rules set rule_code = 'crash' where airline_id = (select airline from t) and rule_code = 'stall'$$,
  '42501', null, 'Solo se cambian penalización, umbral, activación y gravedad'
);
reset role;

-- -----------------------------------------------------------------------------
-- Vuelo 1: limpio, sin aprobación automática
-- -----------------------------------------------------------------------------
select pg_temp.fly('500', 'QQP500', -180, 0, 20, 250, false, true) as s1 \gset

set local role service_role;
select is(
  acars_session_end((select token from t), :'s1', 'completed', 20.52, -103.31) -> 'pirep' ->> 'status',
  'pending', 'Al cerrar un vuelo completado se genera su PIREP, pendiente de revisión'
);
select is(
  (acars_session_end((select token from t), :'s1', 'completed', 20.52, -103.31) -> 'pirep' ->> 'score')::integer,
  100, 'El reintento del cierre devuelve el mismo PIREP'
);
reset role;
update t set pirep1 = (select id from pireps where session_id = :'s1');

select is(private.build_pirep(:'s1'), (select pirep1 from t), 'Generar de nuevo no duplica el PIREP');
select results_eq(
  $$select score::integer, jsonb_array_length(findings), block_minutes, flight_minutes, fuel_used_kg, diverted, landing_vs_fpm
      from pireps where id = (select pirep1 from t)$$,
  $$values (100, 0, 60, 45, 2000, false, -180)$$,
  'Vuelo limpio: 100 puntos, block 60 min, vuelo 45 min, 2,000 kg de combustible, sin desvío'
);
select ok(
  (select distance_nm between 200 and 300 from pireps where id = (select pirep1 from t)),
  'La distancia sale de la traza'
);
select is(
  (select metrics -> 'touchdown' ->> 'flaps_deg' from pireps where id = (select pirep1 from t)),
  '30', 'El PIREP guarda los datos del aterrizaje que envió el conector'
);

-- Visibilidad
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1"}';
select is((select count(*)::integer from pireps), 1, 'El piloto ve su PIREP');
select throws_ok(
  $$update pireps set score = 100 where id = (select pirep1 from t)$$,
  '42501', null, 'El piloto no edita su PIREP'
);
select throws_ok(
  $$select review_pirep((select pirep1 from t), 'accepted')$$,
  '42501', null, 'Un piloto no revisa PIREPs'
);
select is(
  (comment_pirep((select pirep1 from t), '  Viento cruzado en final  ')).pilot_comment,
  'Viento cruzado en final', 'El piloto comenta su PIREP pendiente'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e2"}';
select is((select count(*)::integer from pireps), 0, 'Otro piloto no ve PIREPs ajenos');
select throws_ok(
  $$select comment_pirep((select pirep1 from t), 'hola')$$,
  '42501', null, 'Otro piloto no comenta un PIREP ajeno'
);
reset role;

-- Revisión
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e3"}';
select is((select count(*)::integer from pireps), 1, 'El jefe de operaciones ve los PIREP de su aerolínea');
select throws_ok(
  $$select review_pirep((select pirep1 from t), 'rejected', '   ')$$,
  '22023', 'Escribe el motivo del rechazo', 'Rechazar exige un motivo'
);
select is(
  (review_pirep((select pirep1 from t), 'accepted', 'Buen vuelo')).status::text,
  'accepted', 'El jefe de operaciones acepta el PIREP'
);
select throws_ok(
  $$select review_pirep((select pirep1 from t), 'rejected', 'tarde')$$,
  '55000', 'Este PIREP ya fue revisado', 'Un PIREP revisado no se vuelve a decidir'
);
reset role;

select results_eq(
  $$select total_minutes, cycles from aircraft where id = (select aircraft from t)$$,
  $$values (60, 1)$$,
  'Al aceptar, la aeronave suma el block time y un ciclo'
);
select is(
  (select reviewed_by from pireps where id = (select pirep1 from t)),
  '00000000-0000-0000-0000-0000000000e3'::uuid, 'Queda registrado quién revisó'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1"}';
select throws_ok(
  $$select comment_pirep((select pirep1 from t), 'otro comentario')$$,
  '55000', null, 'Tras la revisión ya no se comenta'
);
select results_eq(
  $$select pireps_accepted, block_minutes, flight_minutes, average_landing_vs_fpm from pilot_statistics
     where airline_id = (select airline from t)$$,
  $$values (1, 60, 45, -180)$$,
  'Las estadísticas del piloto salen de sus PIREP aceptados'
);
select is(
  (get_dashboard_summary((select airline from t)) ->> 'my_block_minutes')::integer,
  60, 'El dashboard muestra las horas del piloto'
);
reset role;

-- -----------------------------------------------------------------------------
-- Vuelo 2: aprobación automática activada, pero con faltas y desvío
-- -----------------------------------------------------------------------------
update airline_settings set auto_approve_pireps = true, pirep_min_score = 80 where airline_id = (select airline from t);

select pg_temp.fly('501', 'QQP501', -700, 1, 40, 290, true, true) as s2 \gset
set local role service_role;
-- Regresa al origen (MMGL): es un desvío.
select acars_session_end((select token from t), :'s2', 'completed', 20.52, -103.31);
reset role;
update t set pirep2 = (select id from pireps where session_id = :'s2');

select results_eq(
  $$select status::text, score::integer, has_critical, diverted, auto_approved from pireps where id = (select pirep2 from t)$$,
  $$values ('pending', 55, true, true, false)$$,
  'Duro (25), rebote, rodaje rápido, 250 kt y motores encendidos restan 45; el desvío lo manda a revisión'
);
select set_eq(
  $$select f ->> 'code' from pireps p, jsonb_array_elements(p.findings) f where p.id = (select pirep2 from t)$$,
  array['landing_hard', 'landing_bounce', 'taxi_speed', 'speed_below_fl100', 'engines_at_start', 'diversion'],
  'Cada falta queda en el PIREP; un aterrizaje duro no cuenta además como firme'
);
select is(
  (select f ->> 'value' from pireps p, jsonb_array_elements(p.findings) f where p.id = (select pirep2 from t) and f ->> 'code' = 'taxi_speed'),
  '40', 'La falta guarda el valor medido'
);
select results_eq(
  $$select total_minutes, cycles from aircraft where id = (select aircraft from t)$$,
  $$values (60, 1)$$,
  'Un PIREP pendiente no suma horas a la aeronave'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e3"}';
select is(
  (get_dashboard_summary((select airline from t)) ->> 'pireps_pending_review')::integer,
  1, 'El dashboard del staff cuenta los PIREP por revisar'
);
select is(
  (review_pirep((select pirep2 from t), 'rejected', 'Desvío sin justificar')).status::text,
  'rejected', 'El jefe de operaciones rechaza con motivo'
);
reset role;
select results_eq(
  $$select total_minutes, cycles from aircraft where id = (select aircraft from t)$$,
  $$values (60, 1)$$,
  'Un PIREP rechazado no suma horas'
);

-- -----------------------------------------------------------------------------
-- Vuelo 3: limpio con aprobación automática
-- -----------------------------------------------------------------------------
select pg_temp.fly('501', 'QQP502', -250, 0, 20, 240, false, true) as s3 \gset
set local role service_role;
select is(
  acars_session_end((select token from t), :'s3', 'completed', 19.43, -99.07) -> 'pirep' ->> 'status',
  'accepted', 'Con aprobación automática, un vuelo con buen puntaje y sin faltas graves se acepta solo'
);
reset role;
update t set pirep3 = (select id from pireps where session_id = :'s3');
select results_eq(
  $$select auto_approved, reviewed_by is null, reviewed_at is not null from pireps where id = (select pirep3 from t)$$,
  $$values (true, true, true)$$,
  'La aprobación automática no tiene revisor'
);
select results_eq(
  $$select total_minutes, cycles from aircraft where id = (select aircraft from t)$$,
  $$values (120, 2)$$,
  'La aprobación automática también suma horas y ciclo'
);

-- -----------------------------------------------------------------------------
-- Vuelo 4: cerrado sin despegar
-- -----------------------------------------------------------------------------
select pg_temp.fly('500', 'QQP503', 0, 0, 10, 0, false, false) as s4 \gset
set local role service_role;
select acars_session_end((select token from t), :'s4', 'completed', 19.43, -99.07);
reset role;
select results_eq(
  $$select status::text, has_critical, flight_minutes is null, landing_at is null from pireps where flight_id = (select id from flights where callsign = 'QQP503')$$,
  $$values ('pending', true, true, true)$$,
  'Terminar sin despegar ni aterrizar genera un PIREP marcado como vuelo incompleto'
);

-- Un vuelo abandonado no genera PIREP
select pg_temp.fly('500', 'QQP504', -200, 0, 10, 200, false, true) as s5 \gset
set local role service_role;
select is(
  acars_session_end((select token from t), :'s5', 'aborted', 19.43, -99.07) ->> 'pirep',
  null, 'Un vuelo abandonado no genera PIREP'
);
reset role;
select is((select count(*)::integer from pireps where session_id = :'s5'), 0, 'No queda PIREP del abandono');

-- Respaldo
select is(private.build_missing_pireps(), 0, 'La tarea de respaldo no encuentra sesiones completadas sin PIREP');

-- Permisos de funciones internas
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e4"}';
select throws_ok($$select private.build_pirep((select pirep1 from t))$$, '42501', null, 'Nadie genera PIREPs desde el navegador');
select throws_ok(
  $$insert into pireps (flight_id) values (gen_random_uuid())$$,
  '42501', null, 'Nadie inserta PIREPs desde el navegador'
);
reset role;

select * from finish();
rollback;
