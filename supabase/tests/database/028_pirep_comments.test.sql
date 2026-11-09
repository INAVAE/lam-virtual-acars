-- El piloto y el staff comentan un PIREP en cualquier momento (aunque ya esté revisado).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(12);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000bc3', 'c@pc.test', '{"display_name":"Admin C"}'),
  ('00000000-0000-0000-0000-000000000bd4', 'd@pc.test', '{"display_name":"Piloto D"}'),
  ('00000000-0000-0000-0000-000000000be5', 'e@pc.test', '{"display_name":"Piloto E"}');
insert into airlines (organization_id, slug, name, icao_code, is_active, network)
select id, 'com-p', 'Comentarios P', 'QCP', true, 'IVAO' from organizations where slug = 'lam';
insert into airports (icao_code, iata_code, name, city, country_code, latitude, longitude, elevation_ft, airport_type) values
  ('MMMX', 'MEX', 'Aeropuerto Internacional de la Ciudad de México', 'Ciudad de México', 'MX', 19.4363, -99.0721, 7316, 'large_airport'),
  ('MMGL', 'GDL', 'Aeropuerto Internacional de Guadalajara', 'Guadalajara', 'MX', 20.5218, -103.3112, 5016, 'large_airport')
on conflict (icao_code) do nothing;
create temp table t (x uuid, pirep uuid) on commit drop;
insert into t (x) select id from airlines where slug = 'com-p';
grant select on t to authenticated;
insert into airline_memberships (airline_id, user_id, roles, status)
select t.x, m.uid, m.roles::airline_role[], 'active'::membership_status
  from t, (values ('00000000-0000-0000-0000-000000000bc3'::uuid, '{airline_admin}'), ('00000000-0000-0000-0000-000000000bd4'::uuid, '{pilot}'),
                  ('00000000-0000-0000-0000-000000000be5'::uuid, '{pilot}')) as m(uid, roles);
insert into aircraft (airline_id, aircraft_type_id, registration, base_airport_id, current_airport_id)
select x, (select id from aircraft_types where icao_code = 'B738'), 'XA-PC1', (select id from airports where icao_code = 'MMMX'), (select id from airports where icao_code = 'MMMX') from t;

-- Un vuelo terminado con PIREP ya aceptado.
with b as (
  insert into flight_bookings (airline_id, user_id, route_id, aircraft_id, expires_at, status, closed_at)
  select x, '00000000-0000-0000-0000-000000000bd4', null, (select id from aircraft where registration = 'XA-PC1'), now() + interval '1 day', 'completed', now() from t
  returning id, airline_id, aircraft_id
), f as (
  insert into flights (booking_id, airline_id, user_id, aircraft_id, aircraft_type_id, aircraft_registration, airline_icao, flight_number, callsign,
                       origin_airport_id, destination_airport_id, planned_distance_nm, planned_minutes, scheduled_departure_at, operation_type, network,
                       status, started_at, completed_at)
  select b.id, b.airline_id, '00000000-0000-0000-0000-000000000bd4', b.aircraft_id, (select id from aircraft_types where icao_code = 'B738'), 'XA-PC1', 'QCP', '900', 'QCP900',
         (select id from airports where icao_code = 'MMMX'), (select id from airports where icao_code = 'MMGL'), 250, 70, now(), 'passenger', 'IVAO',
         'completed', now() - interval '1 hour', now()
    from b returning id, airline_id, user_id, aircraft_type_id, origin_airport_id, destination_airport_id
), s as (
  insert into flight_sessions (flight_id, user_id, airline_id, status, phase, ended_at)
  select id, user_id, airline_id, 'completed', 'taxi_in', now() from f returning id, flight_id
)
insert into pireps (flight_id, session_id, airline_id, user_id, aircraft_type_id, aircraft_registration, callsign, flight_number,
                    origin_airport_id, destination_airport_id, arrival_airport_id, block_on_at, block_minutes, distance_nm, score, status, reviewed_at)
select f.id, s.id, f.airline_id, f.user_id, f.aircraft_type_id, 'XA-PC1', 'QCP900', '900', f.origin_airport_id, f.destination_airport_id,
       f.destination_airport_id, now(), 60, 250, 95, 'accepted', now()
  from f join s on s.flight_id = f.id;
update t set pirep = (select id from pireps where callsign = 'QCP900');

-- METAR guardado con el vuelo (lo escribe la Edge Function con la clave secreta).
insert into flight_weather (flight_id, role, icao, event_at, observed_at, metar)
select flight_id, 'departure', 'MMMX', now() - interval '1 hour', now() - interval '70 minutes', '{"raw":"MMMX 090400Z 00000KT P6SM SKC 18/05 A3020"}'::jsonb
  from pireps where callsign = 'QCP900';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000bd4"}';
select is((select metar ->> 'raw' from flight_weather where role = 'departure' and icao = 'MMMX' and flight_id = (select flight_id from pireps where id = (select pirep from t))),
  'MMMX 090400Z 00000KT P6SM SKC 18/05 A3020', 'El piloto ve el METAR de salida de su vuelo');
select throws_ok($$insert into flight_weather (flight_id, role, icao, event_at) select flight_id, 'arrival', 'MMGL', now() from pireps limit 1$$,
  '42501', null, 'Nadie escribe el METAR desde la web');
select throws_ok(format($$select comment_pirep(%L, 'Cambio tardío')$$, (select pirep from t)), '55000', null,
  'El comentario inicial solo se edita mientras está pendiente');
select is(add_pirep_comment((select pirep from t), '  El motor 2 falló por el simulador  ') ->> 'author_role', 'pilot',
  'Con el PIREP ya aceptado, el piloto agrega un comentario');
select throws_ok(format($$select add_pirep_comment(%L, '   ')$$, (select pirep from t)), '22023', null, 'No se envían comentarios vacíos');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000bc3"}';
select is(add_pirep_comment((select pirep from t), 'Enterado, gracias.') ->> 'author_role', 'staff', 'El staff responde');
select results_eq(
  $$select author_role, body from pirep_comments where pirep_id = (select pirep from t) order by created_at, author_role$$,
  $$values ('pilot'::text, 'El motor 2 falló por el simulador'::text), ('staff', 'Enterado, gracias.')$$,
  'La conversación queda en orden y sin espacios de más'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000be5"}';
select is((select count(*)::int from pirep_comments where pirep_id = (select pirep from t)), 0, 'Otro piloto no ve la conversación');
select is((select count(*)::int from flight_weather), 0, 'Ni el METAR de vuelos ajenos');
select throws_ok(format($$select add_pirep_comment(%L, 'Hola')$$, (select pirep from t)), '42501', null, 'Ni comenta en PIREP ajenos');
select throws_ok(format($$insert into pirep_comments (pirep_id, author_name, author_role, body) values (%L, 'X', 'staff', 'y')$$, (select pirep from t)),
  '42501', null, 'Nadie escribe directo en la tabla');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000bd4"}';
select is((select count(*)::int from pirep_comments where pirep_id = (select pirep from t)), 2, 'El piloto ve toda la conversación');

select * from finish();
rollback;
