-- Pruebas de la Fase 4: vinculación de dispositivos, sesiones e ingesta ACARS.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(43);

-- -----------------------------------------------------------------------------
-- Escenario: un piloto con un vuelo reservado
-- -----------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000d1', 'piloto@p4.test', '{"display_name":"Piloto Uno"}'),
  ('00000000-0000-0000-0000-0000000000d2', 'otro@p4.test', '{"display_name":"Piloto Dos"}'),
  ('00000000-0000-0000-0000-0000000000d3', 'jefe@p4.test', '{"display_name":"Jefe"}');

insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, 'p4-aerolinea', 'Prueba ACARS', 'QQE', true from organizations where slug = 'lam';

insert into airports (icao_code, iata_code, name, city, country_code, latitude, longitude, elevation_ft, airport_type) values
  ('MMMX', 'MEX', 'Aeropuerto Internacional de la Ciudad de México', 'Ciudad de México', 'MX', 19.4363, -99.0721, 7316, 'large_airport'),
  ('MMGL', 'GDL', 'Aeropuerto Internacional de Guadalajara', 'Guadalajara', 'MX', 20.5218, -103.3112, 5016, 'large_airport')
on conflict (icao_code) do nothing;

create temp table t on commit drop as
select
  (select id from airlines where slug = 'p4-aerolinea') as airline,
  (select id from aircraft_types where icao_code = 'A20N') as a20n,
  (select id from airports where icao_code = 'MMMX') as mmmx,
  (select id from airports where icao_code = 'MMGL') as mmgl,
  encode(extensions.digest('lamd_token_uno', 'sha256'), 'hex') as token1,
  encode(extensions.digest('lamd_token_dos', 'sha256'), 'hex') as token2,
  encode(extensions.digest('secreto', 'sha256'), 'hex') as secret,
  null::text as code,
  null::uuid as flight,
  null::uuid as session,
  null::uuid as device;
grant select on t to authenticated, service_role;

insert into airline_memberships (airline_id, user_id, roles, status)
select airline, '00000000-0000-0000-0000-0000000000d1'::uuid, '{pilot}'::airline_role[], 'active'::membership_status from t union all
select airline, '00000000-0000-0000-0000-0000000000d2'::uuid, '{pilot}'::airline_role[], 'active'::membership_status from t union all
select airline, '00000000-0000-0000-0000-0000000000d3'::uuid, '{ops_chief,pilot}'::airline_role[], 'active'::membership_status from t;
insert into pilot_type_ratings (airline_id, user_id, aircraft_type_id)
select airline, '00000000-0000-0000-0000-0000000000d1', a20n from t;
insert into aircraft (airline_id, aircraft_type_id, registration, current_airport_id)
select airline, a20n, 'XA-QE1', mmmx from t;
insert into routes (airline_id, flight_number, origin_airport_id, destination_airport_id)
select airline, '400', mmmx, mmgl from t;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d1"}';
select book_flight((select id from routes where flight_number = '400'), (select id from aircraft where registration = 'XA-QE1'), 'QQE400');
reset role;
update t set flight = (select id from flights where callsign = 'QQE400');

-- -----------------------------------------------------------------------------
-- Permisos de las funciones de ingesta
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d1"}';
select throws_ok(
  $$select acars_link_start('PC', '1.0', (select secret from t), null)$$,
  '42501', null, 'Una sesión web no llama a la ingesta ACARS'
);
reset role;
set local role anon;
select throws_ok($$select acars_me('x')$$, '42501', null, 'Un visitante no llama a la ingesta ACARS');
reset role;

-- -----------------------------------------------------------------------------
-- Vinculación
-- -----------------------------------------------------------------------------
set local role service_role;
select ok(
  (select (acars_link_start('PC de pruebas', '1.0.0', (select secret from t), 'iphash') ->> 'code') ~ '^[A-Z2-9]{8}$'),
  'El conector recibe un código de 8 caracteres'
);
reset role;
update t set code = (select code from acars_link_codes where device_name = 'PC de pruebas');

set local role service_role;
select is(
  acars_link_poll((select code from t), (select secret from t), (select token1 from t), 'lamd_tok') ->> 'status',
  'pending', 'Antes de confirmar, el conector espera'
);
select throws_ok(
  $$select acars_link_poll((select code from t), repeat('0', 64), (select token1 from t), 'lamd_tok')$$,
  'P0002', null, 'Sin el secreto de consulta no se obtiene el token'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d1"}';
select is(
  approve_acars_link(lower(substr((select code from t), 1, 4) || '-' || substr((select code from t), 5))) ->> 'device_name',
  'PC de pruebas', 'El piloto confirma el código en la web (sin importar guion ni minúsculas)'
);
select throws_ok(
  $$select approve_acars_link((select code from t))$$,
  'P0002', null, 'Un código no se confirma dos veces'
);
reset role;

set local role service_role;
select is(
  acars_link_poll((select code from t), (select secret from t), (select token1 from t), 'lamd_tok') ->> 'status',
  'approved', 'Tras confirmar, el conector recibe su token'
);
select throws_ok(
  $$select acars_link_poll((select code from t), (select secret from t), (select token2 from t), 'lamd_tok')$$,
  'P0001', 'Este código ya se usó', 'Un código consumido no entrega otro token'
);
select throws_ok($$select acars_me(repeat('a', 64))$$, '28000', null, 'Un token desconocido se rechaza');
select is(
  (acars_me((select token1 from t)) -> 'pilot' ->> 'display_name'),
  'Piloto Uno', 'El dispositivo queda ligado al piloto que confirmó'
);
select is(
  jsonb_array_length(acars_me((select token1 from t)) -> 'flights'),
  1, 'El conector ve la reserva activa del piloto'
);
reset role;
update t set device = (select id from acars_devices where token_hash = (select token1 from t));

-- -----------------------------------------------------------------------------
-- Sesión
-- -----------------------------------------------------------------------------
set local role service_role;
select throws_ok(
  $$select acars_session_start((select token1 from t), (select flight from t), 'Airbus A320neo', 'A20N', 'XA-QE1', '1.0.0')$$,
  'P0001', 'Importa el plan de SimBrief en My Flights antes de iniciar ACARS', 'Sin OFP no se inicia ACARS'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d1"}';
insert into simbrief_ofps (flight_id, request_id, origin_icao, destination_icao, aircraft_icao, registration, atc_callsign)
select flight, '1', 'MMMX', 'MMGL', 'A20N', 'XA-QE1', 'QQE400' from t;
reset role;

set local role service_role;
select is(
  (acars_session_start((select token1 from t), (select flight from t), 'Airbus A320neo', 'A20N', 'XA-QE1', '1.0.0') ->> 'resumed')::boolean,
  false, 'Con OFP, el conector inicia la sesión'
);
reset role;
update t set session = (select id from flight_sessions where flight_id = (select flight from t));

select is((select status::text from flights where id = (select flight from t)), 'in_progress', 'El vuelo pasa a En vuelo');
select is((select status::text from aircraft where registration = 'XA-QE1'), 'in_flight', 'La aeronave pasa a En vuelo');

set local role service_role;
select is(
  (acars_session_start((select token1 from t), (select flight from t), null, null, null, '1.0.1') ->> 'resumed')::boolean,
  true, 'Si el conector se reinicia, reanuda la misma sesión'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d1"}';
select throws_ok(
  $$select cancel_booking((select booking_id from flights where id = (select flight from t)))$$,
  'P0001', 'El vuelo ya comenzó; no se puede cancelar', 'No se cancela una reserva con el vuelo en curso'
);
reset role;

-- -----------------------------------------------------------------------------
-- Posición, traza y eventos
-- -----------------------------------------------------------------------------
set local role service_role;
select lives_ok(
  $$select acars_position((select token1 from t), (select session from t), jsonb_build_object(
      'sampled_at', '2026-10-25T12:00:10Z', 'latitude', 19.43, 'longitude', -99.07, 'altitude_ft', 7300, 'agl_ft', 0,
      'ias_kt', 0, 'gs_kt', 12, 'heading_deg', 50, 'vs_fpm', 0, 'on_ground', true, 'phase', 'taxi_out'))$$,
  'Se guarda la posición viva'
);
select lives_ok(
  $$select acars_position((select token1 from t), (select session from t), jsonb_build_object(
      'sampled_at', '2026-10-25T12:00:00Z', 'latitude', 1, 'longitude', 1, 'altitude_ft', 1, 'on_ground', true, 'phase', 'preflight'))$$,
  'Una posición atrasada se acepta sin error'
);
reset role;
select is(
  (select row(latitude, gs_kt, phase)::text from flight_positions_live where flight_id = (select flight from t)),
  '(19.43,12,taxi_out)', 'Una posición atrasada no sobrescribe la más nueva'
);

set local role service_role;
select is(
  (acars_track_batch((select token1 from t), (select session from t), jsonb_build_array(
    jsonb_build_object('seq', 0, 'sampled_at', date_trunc('minute', now()) - interval '8 minutes', 'latitude', 19.43, 'longitude', -99.07, 'altitude_ft', 7300, 'on_ground', true, 'phase', 'taxi_out'),
    jsonb_build_object('seq', 1, 'sampled_at', date_trunc('minute', now()) - interval '450 seconds', 'latitude', 19.44, 'longitude', -99.08, 'altitude_ft', 7300, 'on_ground', true, 'phase', 'taxi_out'),
    jsonb_build_object('seq', 2, 'sampled_at', date_trunc('minute', now()) - interval '7 minutes', 'latitude', 19.45, 'longitude', -99.09, 'altitude_ft', 7600, 'on_ground', false, 'phase', 'takeoff')
  )) ->> 'inserted')::int,
  3, 'Se guarda un lote de traza'
);
select is(
  (acars_track_batch((select token1 from t), (select session from t), jsonb_build_array(
    jsonb_build_object('seq', 1, 'sampled_at', date_trunc('minute', now()) - interval '450 seconds', 'latitude', 19.44, 'longitude', -99.08, 'altitude_ft', 7300, 'on_ground', true, 'phase', 'taxi_out'),
    jsonb_build_object('seq', 2, 'sampled_at', date_trunc('minute', now()) - interval '7 minutes', 'latitude', 19.45, 'longitude', -99.09, 'altitude_ft', 7600, 'on_ground', false, 'phase', 'takeoff')
  )) ->> 'duplicates')::int,
  2, 'Reenviar un lote no duplica puntos'
);
select is(
  (acars_events((select token1 from t), (select session from t), jsonb_build_array(
    jsonb_build_object('id', '10000000-0000-4000-8000-000000000001', 'seq', 0, 'type', 'phase_change', 'phase', 'pushback',
      'occurred_at', date_trunc('minute', now()) - interval '10 minutes', 'data', jsonb_build_object('from', 'engines_started', 'to', 'pushback')),
    jsonb_build_object('id', '10000000-0000-4000-8000-000000000002', 'seq', 1, 'type', 'phase_change', 'phase', 'taxi_out',
      'occurred_at', date_trunc('minute', now()) - interval '9 minutes', 'data', jsonb_build_object('from', 'pushback', 'to', 'taxi_out'))
  )) ->> 'inserted')::int,
  2, 'Se guardan los eventos'
);
select is(
  (acars_events((select token1 from t), (select session from t), jsonb_build_array(
    jsonb_build_object('id', '10000000-0000-4000-8000-000000000002', 'seq', 1, 'type', 'phase_change', 'phase', 'taxi_out',
      'occurred_at', date_trunc('minute', now()) - interval '9 minutes', 'data', jsonb_build_object('from', 'pushback', 'to', 'taxi_out'))
  )) ->> 'duplicates')::int,
  1, 'Reenviar un evento tras perder internet no lo duplica'
);
select throws_ok(
  $$select acars_events((select token1 from t), (select session from t), jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'seq', 9, 'type', 'note', 'phase', 'taxi_out', 'occurred_at', now() + interval '1 hour')))$$,
  '22023', null, 'Se rechazan eventos con el reloj adelantado'
);
reset role;

select is((select phase from flight_sessions where id = (select session from t)), 'taxi_out', 'La sesión sigue la última fase recibida');
select is((select count(*)::int from private.flight_track_points_default), 0, 'La traza va a la partición del mes, no a la de respaldo');

-- -----------------------------------------------------------------------------
-- Lectura desde la web
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d1"}';
select is((select count(*)::int from flight_events), 2, 'El piloto ve los eventos de su vuelo');
select throws_ok(
  $$insert into flight_events (id, flight_id, session_id, user_id, airline_id, seq, type, phase, occurred_at)
    select gen_random_uuid(), flight, session, '00000000-0000-0000-0000-0000000000d1', airline, 50, 'note', 'cruise', now() from t$$,
  '42501', null, 'El piloto no escribe telemetría desde la web'
);
select throws_ok($$select token_hash from acars_devices$$, '42501', null, 'Nadie lee el hash del token');
select is((select count(*)::int from acars_devices), 1, 'El piloto ve su dispositivo');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d2"}';
select is((select count(*)::int from flight_events), 0, 'Otro piloto no ve la telemetría ajena');
select throws_ok($$select revoke_acars_device((select device from t))$$, 'P0002', null, 'Otro piloto no revoca el dispositivo');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d3"}';
select is((select count(*)::int from flight_track_points), 3, 'El jefe de operaciones ve la traza de su aerolínea');
reset role;

-- -----------------------------------------------------------------------------
-- Límite de solicitudes y revocación
-- -----------------------------------------------------------------------------
update acars_devices set rate_count = 240, rate_window_start = now() where id = (select device from t);
set local role service_role;
select throws_ok($$select acars_me((select token1 from t))$$, 'P0001', null, 'Se aplica el límite de solicitudes por minuto');
reset role;
update acars_devices set rate_count = 0 where id = (select device from t);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000d1"}';
select lives_ok($$select revoke_acars_device((select device from t))$$, 'El piloto revoca su dispositivo');
reset role;

set local role service_role;
select throws_ok(
  $$select acars_position((select token1 from t), (select session from t), jsonb_build_object(
      'sampled_at', '2026-10-25T12:05:00Z', 'latitude', 19.5, 'longitude', -99.2, 'altitude_ft', 9000, 'on_ground', false, 'phase', 'climb'))$$,
  '28000', 'Este dispositivo fue revocado; vincúlalo de nuevo', 'Revocar detiene la ingesta en el siguiente envío'
);
reset role;

-- -----------------------------------------------------------------------------
-- Nuevo dispositivo y cierre del vuelo
-- -----------------------------------------------------------------------------
insert into acars_devices (user_id, name, token_hash, token_prefix)
values ('00000000-0000-0000-0000-0000000000d1', 'PC nueva', (select token2 from t), 'lamd_dos');

set local role service_role;
select is(
  acars_session_end((select token2 from t), (select session from t), 'completed', 20.52, -103.31) ->> 'final_airport',
  'MMGL', 'Al cerrar, se identifica el aeropuerto de llegada'
);
select is(
  (acars_session_end((select token2 from t), (select session from t), 'completed', 20.52, -103.31) ->> 'already_closed')::boolean,
  true, 'Repetir el cierre no cambia nada'
);
reset role;

select is(
  (select row(f.status::text, b.status::text, s.status, s.phase)::text
   from flights f join flight_bookings b on b.id = f.booking_id join flight_sessions s on s.flight_id = f.id
   where f.id = (select flight from t)),
  '(completed,completed,completed,flight_completed)', 'Vuelo, reserva y sesión quedan completados'
);
select is(
  (select row(a.status::text, ap.icao_code)::text from aircraft a join airports ap on ap.id = a.current_airport_id where a.registration = 'XA-QE1'),
  '(available,MMGL)', 'La aeronave queda disponible en el aeropuerto de llegada'
);

select ok(
  has_table_privilege('service_role', 'public.flight_positions_live', 'DELETE'),
  'La Edge Function puede borrar la posición viva al cerrar la sesión'
);

select * from finish();
rollback;
