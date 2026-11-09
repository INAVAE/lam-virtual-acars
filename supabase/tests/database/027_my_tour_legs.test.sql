-- Solo cuenta para el tour el vuelo reservado desde el tour; un vuelo normal con
-- la misma ruta no. get_my_tour_legs avisa qué legs le faltan al piloto.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(11);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000ac3', 'c@mtl.test', '{"display_name":"Admin C"}'),
  ('00000000-0000-0000-0000-000000000ad4', 'd@mtl.test', '{"display_name":"Piloto D"}'),
  ('00000000-0000-0000-0000-000000000ae5', 'e@mtl.test', '{"display_name":"Piloto E"}');
insert into airlines (organization_id, slug, name, icao_code, is_active, network)
select id, 'tour-n', 'Tour N', 'QTN', true, 'IVAO' from organizations where slug = 'lam';
insert into airports (icao_code, iata_code, name, city, country_code, latitude, longitude, elevation_ft, airport_type) values
  ('MMMX', 'MEX', 'Aeropuerto Internacional de la Ciudad de México', 'Ciudad de México', 'MX', 19.4363, -99.0721, 7316, 'large_airport'),
  ('MMGL', 'GDL', 'Aeropuerto Internacional de Guadalajara', 'Guadalajara', 'MX', 20.5218, -103.3112, 5016, 'large_airport'),
  ('MMMY', 'MTY', 'Aeropuerto Internacional de Monterrey', 'Monterrey', 'MX', 25.7785, -100.1069, 1278, 'large_airport')
on conflict (icao_code) do nothing;

create temp table t (x uuid, b738 bigint, mmmx bigint, mmgl bigint, mmmy bigint, tour uuid, enr uuid, leg1 uuid, leg2 uuid, flight uuid) on commit drop;
insert into t (x, b738, mmmx, mmgl, mmmy)
select (select id from airlines where slug = 'tour-n'), (select id from aircraft_types where icao_code = 'B738'),
       (select id from airports where icao_code = 'MMMX'), (select id from airports where icao_code = 'MMGL'), (select id from airports where icao_code = 'MMMY');
grant select, update on t to authenticated;
insert into airline_memberships (airline_id, user_id, roles, status)
select t.x, m.uid, m.roles::airline_role[], 'active'::membership_status
  from t, (values ('00000000-0000-0000-0000-000000000ac3'::uuid, '{airline_admin}'), ('00000000-0000-0000-0000-000000000ad4'::uuid, '{pilot}'),
                  ('00000000-0000-0000-0000-000000000ae5'::uuid, '{pilot}')) as m(uid, roles);
insert into aircraft (airline_id, aircraft_type_id, registration, base_airport_id, current_airport_id)
select x, b738, 'XA-TN1', mmmx, mmmx from t;
insert into pilot_type_ratings (airline_id, user_id, aircraft_type_id)
select x, '00000000-0000-0000-0000-000000000ad4'::uuid, b738 from t;

create function pg_temp.finish(p_flight uuid) returns void language sql as $$
  update flights set status = 'completed', started_at = now() - interval '1 hour', completed_at = now() where id = p_flight;
  update flight_bookings set status = 'completed', closed_at = now() where id = (select booking_id from flights where id = p_flight);
  update aircraft set status = 'available' where id = (select aircraft_id from flights where id = p_flight);
  insert into flight_sessions (flight_id, user_id, airline_id, status, phase, ended_at)
  select id, user_id, airline_id, 'completed', 'taxi_in', now() from flights where id = p_flight;
  insert into pireps (flight_id, session_id, airline_id, user_id, aircraft_type_id, aircraft_registration, callsign, flight_number,
                      origin_airport_id, destination_airport_id, arrival_airport_id, block_on_at, block_minutes, distance_nm, score, status, reviewed_at)
  select f.id, s.id, f.airline_id, f.user_id, f.aircraft_type_id, f.aircraft_registration, f.callsign, f.flight_number,
         f.origin_airport_id, f.destination_airport_id, f.destination_airport_id, now(), 60, f.planned_distance_nm, 95, 'accepted', now()
    from flights f join flight_sessions s on s.flight_id = f.id where f.id = p_flight;
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000ac3"}';
update t set tour = save_tour(null, jsonb_build_object('airline_id', (select x from t), 'code', 'MTL-01', 'name', 'Norte', 'ordered_legs', false,
  'aircraft_type_ids', jsonb_build_array((select b738 from t))),
  jsonb_build_array(jsonb_build_object('origin_airport_id', (select mmmx from t), 'destination_airport_id', (select mmgl from t)),
                    jsonb_build_object('origin_airport_id', (select mmgl from t), 'destination_airport_id', (select mmmy from t))));
select submit_tour((select tour from t));
update t set leg1 = (select id from tour_legs where tour_id = t.tour and leg_number = 1),
             leg2 = (select id from tour_legs where tour_id = t.tour and leg_number = 2);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000ad4"}';
select is(jsonb_array_length(get_my_tour_legs()), 0, 'Sin inscripción no hay legs pendientes');
update t set enr = (enroll_tour(tour, x) ->> 'enrollment_id')::uuid;
select is(jsonb_array_length(get_my_tour_legs()), 0, 'Con la inscripción pendiente tampoco');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000ac3"}';
select review_tour_enrollment((select enr from t), true);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000ad4"}';
select results_eq(
  $$select x ->> 'code', (x ->> 'leg_number')::int, x ->> 'origin_icao', x ->> 'destination_icao', x ->> 'state' from jsonb_array_elements(get_my_tour_legs()) x$$,
  $$values ('MTL-01'::text, 1, 'MMMX'::text, 'MMGL'::text, 'open'::text), ('MTL-01', 2, 'MMGL', 'MMMY', 'open')$$,
  'Inscrito, ve los legs que le faltan con su ruta'
);

-- Vuelo normal MMMX-MMGL (como Flight Booking), sin tour: no cuenta.
reset role;
with b as (
  insert into flight_bookings (airline_id, user_id, route_id, aircraft_id, expires_at)
  select x, '00000000-0000-0000-0000-000000000ad4', null, (select id from aircraft where registration = 'XA-TN1'), now() + interval '1 day' from t
  returning id, airline_id, aircraft_id
)
insert into flights (booking_id, airline_id, user_id, aircraft_id, aircraft_type_id, aircraft_registration, airline_icao, flight_number, callsign,
                     origin_airport_id, destination_airport_id, planned_distance_nm, planned_minutes, scheduled_departure_at, operation_type, network)
select b.id, b.airline_id, '00000000-0000-0000-0000-000000000ad4', b.aircraft_id, (select b738 from t), 'XA-TN1', 'QTN', '501', 'QTN501',
       (select mmmx from t), (select mmgl from t), 250, 70, now(), 'passenger', 'IVAO'
  from b;
update t set flight = (select id from flights where callsign = 'QTN501');
select pg_temp.finish((select flight from t));
set local role authenticated;
select is(get_tour((select tour from t)) -> 'my_legs' -> 0 ->> 'state', 'open', 'Un vuelo normal con la misma ruta no cuenta para el tour');
select is(jsonb_array_length(get_my_tour_legs()), 2, 'Y el leg sigue pendiente');

-- Reservado desde el tour: sí cuenta.
update t set flight = (book_tour_leg(enr, leg1, (select id from aircraft where registration = 'XA-TN1'), 'QTN501', '501') ->> 'flight_id')::uuid;
select is((select x ->> 'state' from jsonb_array_elements(get_my_tour_legs()) x where (x ->> 'leg_number')::int = 1), 'booked',
  'Reservado desde el tour, el leg aparece como reservado');
reset role;
select pg_temp.finish((select flight from t));
set local role authenticated;
select is(get_tour((select tour from t)) -> 'my_legs' -> 0 ->> 'state', 'accepted', 'El vuelo reservado desde el tour cuenta para el tour');

select results_eq(
  $$select x.value -> 'tour' ->> 'code', (x.value -> 'tour' ->> 'leg')::int, (x.value -> 'tour' ->> 'legs')::int
      from jsonb_each(get_pirep_programs(array(select id from pireps where user_id = '00000000-0000-0000-0000-000000000ad4'))) x$$,
  $$values ('MTL-01'::text, 1, 2)$$,
  'El PIREP del leg dice su tour y su leg; el del vuelo normal no aparece'
);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000ac3"}';
select is((select count(*)::int from jsonb_each(get_pirep_programs(array(select pirep_id from (select p.id as pirep_id from pireps p) q)))), 1, 'El staff de la aerolínea lo ve también');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000ae5"}';
select is(jsonb_array_length(get_my_tour_legs()), 0, 'Cada piloto ve solo sus legs');
reset role;
create temp table ids as select id from pireps;
grant select on ids to authenticated;
set local role authenticated;
select is(get_pirep_programs(array(select id from ids)), '{}'::jsonb, 'Otro piloto no ve el tour de PIREP ajenos');

select * from finish();
rollback;
