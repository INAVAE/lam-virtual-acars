-- Fase 7: figura del avión por categoría y traza completa del vuelo en curso.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(16);

-- Categoría por omisión
select results_eq(
  $$select private.default_map_category(x.icao, x.wake, x.engine, x.pax)
      from (values (1, 'C172', 'L', 'piston', 3), (2, 'C208', 'L', 'turboprop', 9), (3, 'AT76', 'M', 'turboprop', 72),
                   (4, 'C750', 'M', 'jet', 12), (5, 'E190', 'M', 'jet', 100), (6, 'B738', 'M', 'jet', 189),
                   (7, 'B77W', 'H', 'jet', 396), (8, 'B748', 'H', 'jet', 467), (9, 'A388', 'J', 'jet', 853)) as x(n, icao, wake, engine, pax)
     order by x.n$$,
  $$values ('light'), ('light'), ('turboprop'), ('business_jet'), ('regional_jet'), ('narrowbody'), ('widebody'), ('jumbo'), ('jumbo')$$,
  'La categoría sale del motor, la estela, el designador y los pasajeros'
);
select results_eq(
  $$select icao_code, map_category from aircraft_types where icao_code in ('A388', 'B77W', 'B738', 'AT76') order by icao_code$$,
  $$values ('A388'::text, 'jumbo'::text), ('AT76', 'turboprop'), ('B738', 'narrowbody'), ('B77W', 'widebody')$$,
  'El catálogo existente quedó con su figura'
);
insert into aircraft_types (icao_code, manufacturer, model, wake_category, engine_type, max_passengers)
values ('C172', 'Cessna', '172 Skyhawk', 'L', 'piston', 3);
select is((select map_category from aircraft_types where icao_code = 'C172'), 'light', 'Un tipo nuevo recibe su figura automáticamente');
update aircraft_types set map_category = 'business_jet' where icao_code = 'C172';
select is((select map_category from aircraft_types where icao_code = 'C172'), 'business_jet', 'La figura se puede cambiar a mano');
select throws_ok(
  $$update aircraft_types set map_category = 'zeppelin' where icao_code = 'C172'$$, '23514', null,
  'Solo se aceptan las categorías conocidas'
);

-- Personas y vuelo en curso
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000007a1', 'a@f7.test', '{"display_name":"Piloto A7"}'),
  ('00000000-0000-0000-0000-0000000007b2', 'b@f7.test', '{"display_name":"Piloto B7"}'),
  ('00000000-0000-0000-0000-0000000007d4', 'd@f7.test', '{"display_name":"Ajeno D7"}');
insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, 'fase7-aerolinea', 'Prueba Fase 7', 'QQV', true from organizations where slug = 'lam';
insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, 'fase7-otra', 'Otra Fase 7', 'QQW', true from organizations where slug = 'lam';
insert into airports (icao_code, iata_code, name, city, country_code, latitude, longitude, elevation_ft, airport_type) values
  ('MMMX', 'MEX', 'Aeropuerto Internacional de la Ciudad de México', 'Ciudad de México', 'MX', 19.4363, -99.0721, 7316, 'large_airport'),
  ('MMGL', 'GDL', 'Aeropuerto Internacional de Guadalajara', 'Guadalajara', 'MX', 20.5218, -103.3112, 5016, 'large_airport')
on conflict (icao_code) do nothing;

create temp table t on commit drop as
select
  (select id from airlines where slug = 'fase7-aerolinea') as airline,
  (select id from airlines where slug = 'fase7-otra') as other,
  (select id from aircraft_types where icao_code = 'B77W') as b77w,
  (select id from airports where icao_code = 'MMMX') as mmmx,
  (select id from airports where icao_code = 'MMGL') as mmgl,
  gen_random_uuid() as flight_a, gen_random_uuid() as session_a, gen_random_uuid() as device;
grant select on t to authenticated;

insert into airline_memberships (airline_id, user_id, roles, status)
select airline, u.id, '{pilot}'::airline_role[], 'active'::membership_status
  from t, (values ('00000000-0000-0000-0000-0000000007a1'::uuid), ('00000000-0000-0000-0000-0000000007b2'::uuid)) as u(id);
insert into airline_memberships (airline_id, user_id, roles, status)
select other, '00000000-0000-0000-0000-0000000007d4', '{pilot}'::airline_role[], 'active'::membership_status from t;
insert into aircraft (airline_id, aircraft_type_id, registration, base_airport_id, current_airport_id)
select airline, b77w, 'XA-QV1', mmmx, mmmx from t;
insert into acars_devices (id, user_id, name, token_hash, token_prefix)
select device, '00000000-0000-0000-0000-0000000007a1', 'PC A7', encode(extensions.digest('lamd_f7', 'sha256'), 'hex'), 'lamd_f7' from t;
insert into flights (id, airline_id, user_id, aircraft_id, aircraft_type_id, aircraft_registration, airline_icao, flight_number,
                     callsign, origin_airport_id, destination_airport_id, planned_distance_nm, planned_minutes,
                     operation_type, network, status, started_at)
select flight_a, airline, '00000000-0000-0000-0000-0000000007a1', (select id from aircraft where registration = 'XA-QV1'), b77w, 'XA-QV1',
       'QQV', '701', 'QQV701', mmmx, mmgl, 250, 70, 'passenger', 'IVAO', 'in_progress', now() - interval '30 minutes' from t;
insert into flight_sessions (id, flight_id, device_id, user_id, airline_id, status, phase, started_at, last_contact_at)
select session_a, flight_a, device, '00000000-0000-0000-0000-0000000007a1', airline, 'active', 'cruise', now() - interval '30 minutes', now() from t;
insert into flight_positions_live (flight_id, session_id, user_id, airline_id, sampled_at, latitude, longitude, altitude_ft, ias_kt, gs_kt, heading_deg, vs_fpm, on_ground, phase)
select flight_a, session_a, '00000000-0000-0000-0000-0000000007a1', airline, now(), 20.0, -101.0, 33000, 270, 450, 285, 0, false, 'cruise' from t;
insert into flight_track_points (flight_id, session_id, user_id, airline_id, seq, sampled_at, latitude, longitude, altitude_ft, gs_kt, ias_kt, vs_fpm, heading_deg, on_ground, phase, wind_dir_deg, wind_kt, fuel_kg)
select flight_a, session_a, '00000000-0000-0000-0000-0000000007a1', airline, g, now() - make_interval(mins => 30 - g * 5),
       19.44 + g * 0.1, -99.07 - g * 0.4, 7316 + g * 5000, 250 + g, 220, 1500, 285, g = 0, case when g = 0 then 'taxi_out' else 'climb' end,
       270, 20 + g, 60000 - g * 300
  from t, generate_series(0, 4) g;
insert into flight_events (id, flight_id, session_id, user_id, airline_id, seq, type, phase, occurred_at, data)
select gen_random_uuid(), flight_a, session_a, '00000000-0000-0000-0000-0000000007a1', airline, e.seq, e.type, e.phase, now() - e.ago, e.data
  from t, (values
    (0, 'block_off', 'pushback', interval '29 minutes', '{"fuel_kg":60100,"title":"x"}'::jsonb),
    (1, 'takeoff', 'initial_climb', interval '25 minutes', '{"ias_kt":160}'::jsonb),
    (2, 'connection_lost', 'climb', interval '20 minutes', '{}'::jsonb)
  ) as e(seq, type, phase, ago, data);

-- Lectura como miembro de la aerolínea
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000007b2"}';
select is((select get_live_flights(null) -> 0 ->> 'map_category'), 'widebody', 'El vuelo en vivo trae la figura de su tipo');

create temp table tr on commit drop as select get_live_flight_trace((select flight_a from t)) as j;
select ok((select (j ->> 'active')::boolean from tr), 'La traza indica que el vuelo sigue en curso');
select is((select jsonb_array_length(j -> 'points') from tr), 5, 'Trae todos los puntos de la traza');
select is(
  (select jsonb_build_array(j #> '{points,4,0}', j #> '{points,4,2}', j #> '{points,4,4}', j #> '{points,4,5}', j #> '{points,4,10}',
          j #> '{points,4,11}', j #> '{points,4,12}', j #> '{points,4,13}') from tr),
  '[4, 19.84000, 27316, 254, "climb", 270, 24, 58800]'::jsonb,
  'Cada punto viene compacto: secuencia, hora, posición, velocidades, fase, viento y combustible'
);
select is((select (j -> 'points' -> 0 ->> 9)::int from tr), 1, 'El punto en tierra se marca con 1');
select is((select jsonb_array_length(j -> 'events') from tr), 2, 'Solo trae los eventos que se dibujan');
select ok((select not (j -> 'events' -> 0 -> 'data' ? 'title') from tr), 'Los eventos no exponen textos internos');
select is(
  (select jsonb_array_length(j -> 'points') || '/' || jsonb_array_length(j -> 'events')
     from (select get_live_flight_trace((select flight_a from t), 2, 0) as j) x),
  '2/1', 'Se puede pedir solo lo nuevo después de una secuencia'
);
select is(
  get_live_flight_trace(gen_random_uuid()) ->> 'active', 'false', 'Un vuelo que no está en curso responde inactivo'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000007d4"}';
select throws_ok(
  format('select get_live_flight_trace(%L)', (select flight_a from t)), '42501', null,
  'La traza de un vuelo de otra aerolínea no se puede leer'
);

reset role;
select ok(has_column_privilege('authenticated', 'public.aircraft_types', 'map_category', 'UPDATE'),
  'La figura del mapa se puede editar desde la web (el RLS la limita al superadministrador)');

select * from finish();
rollback;
