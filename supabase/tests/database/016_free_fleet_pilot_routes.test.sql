-- Flota libre, habilitaciones opcionales y rutas registradas por pilotos.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(33);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000f101', 'staff@libre.test', '{"display_name":"Staff Libre"}'),
  ('00000000-0000-0000-0000-00000000f102', 'p2@libre.test', '{"display_name":"Piloto Dos"}'),
  ('00000000-0000-0000-0000-00000000f103', 'p3@libre.test', '{"display_name":"Piloto Tres"}'),
  ('00000000-0000-0000-0000-00000000f104', 'ajeno@libre.test', '{"display_name":"Ajeno"}');
insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, 'libre-aerolinea', 'Prueba Libre', 'QFL', true from organizations where slug = 'lam';
insert into airports (icao_code, iata_code, name, city, country_code, latitude, longitude, elevation_ft, airport_type) values
  ('MMMX', 'MEX', 'Aeropuerto Internacional de la Ciudad de México', 'Ciudad de México', 'MX', 19.4363, -99.0721, 7316, 'large_airport'),
  ('MMGL', 'GDL', 'Aeropuerto Internacional de Guadalajara', 'Guadalajara', 'MX', 20.5218, -103.3112, 5016, 'large_airport'),
  ('MMMY', 'MTY', 'Aeropuerto Internacional de Monterrey', 'Monterrey', 'MX', 25.7785, -100.1069, 1278, 'large_airport')
on conflict (icao_code) do nothing;

create temp table t on commit drop as
select (select id from airlines where slug = 'libre-aerolinea') as airline,
       (select id from aircraft_types where icao_code = 'A20N') as a20n,
       (select id from aircraft_types where icao_code = 'B738') as b738,
       (select id from airports where icao_code = 'MMMX') as mmmx,
       (select id from airports where icao_code = 'MMGL') as mmgl,
       (select id from airports where icao_code = 'MMMY') as mmmy;

insert into airline_memberships (airline_id, user_id, roles, status)
select airline, '00000000-0000-0000-0000-00000000f101'::uuid, '{airline_admin,pilot}'::airline_role[], 'active'::membership_status from t union all
select airline, '00000000-0000-0000-0000-00000000f102', '{pilot}', 'active' from t union all
select airline, '00000000-0000-0000-0000-00000000f103', '{pilot}', 'active' from t;

insert into aircraft (airline_id, aircraft_type_id, registration, operation_type, current_airport_id, status)
select airline, a20n, 'XA-FL1', 'passenger', mmmx, 'available'::aircraft_status from t union all
select airline, b738, 'XA-FL2', 'passenger', mmgl, 'maintenance' from t;
insert into routes (airline_id, flight_number, origin_airport_id, destination_airport_id)
select airline, '300', mmmx, mmgl from t;

alter table t add column fl1 uuid, add column fl2 uuid, add column r300 uuid, add column r400 uuid, add column r500 uuid;
update t set fl1 = (select id from aircraft where registration = 'XA-FL1'),
             fl2 = (select id from aircraft where registration = 'XA-FL2'),
             r300 = (select id from routes where airline_id = t.airline and flight_number = '300');
grant select, update on t to authenticated;

-- -----------------------------------------------------------------------------
-- Ajustes y rutas del staff
-- -----------------------------------------------------------------------------
select is(
  (select control_fleet_availability::text || '/' || pilots_register_routes || '/' || require_type_rating
     from airline_settings where airline_id = (select airline from t)),
  'true/true/true', 'Una aerolínea nueva controla la flota, deja registrar rutas y exige habilitación'
);
select isnt((select activated_at from routes where id = (select r300 from t)), null, 'La ruta del staff nace activa');

-- -----------------------------------------------------------------------------
-- Flota controlada (como antes)
-- -----------------------------------------------------------------------------
select is(private.booking_block_reason('00000000-0000-0000-0000-00000000f102', (select r300 from t), (select fl1 from t)),
  'no_rating', 'Con habilitación exigida, sin habilitación no se reserva');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f101"}';
update airline_settings set require_type_rating = false where airline_id = (select airline from t);
reset role;
select is(private.booking_block_reason('00000000-0000-0000-0000-00000000f102', (select r300 from t), (select fl1 from t)),
  null, 'Sin habilitación exigida, cualquier piloto reserva cualquier tipo');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f102"}';
select lives_ok($$select book_flight((select r300 from t), (select fl1 from t), 'QFL300')$$, 'El piloto 2 reserva XA-FL1');
reset role;
select is((select status::text from aircraft where id = (select fl1 from t)), 'assigned', 'Con la flota controlada, la aeronave queda Asignada');
select is(private.booking_block_reason('00000000-0000-0000-0000-00000000f103', (select r300 from t), (select fl1 from t)),
  'aircraft_unavailable', 'Con la flota controlada, otra persona no reserva una aeronave asignada');
select is(private.booking_block_reason('00000000-0000-0000-0000-00000000f103', (select r300 from t), (select fl2 from t)),
  'aircraft_unavailable', 'Con la flota controlada, una aeronave en mantenimiento no se reserva');
select is(private.program_aircraft_block_reason('00000000-0000-0000-0000-00000000f103', (select airline from t), (select fl2 from t), '{}', (select mmmx from t)),
  'aircraft_unavailable', 'Tours y eventos siguen la misma regla');

-- -----------------------------------------------------------------------------
-- Flota libre
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f101"}';
update airline_settings set control_fleet_availability = false, require_aircraft_at_origin = true where airline_id = (select airline from t);
reset role;

select is(private.booking_block_reason('00000000-0000-0000-0000-00000000f103', (select r300 from t), (select fl1 from t)),
  null, 'Con la flota libre, una aeronave reservada por otro piloto se puede reservar');
select is(private.booking_block_reason('00000000-0000-0000-0000-00000000f103', (select r300 from t), (select fl2 from t)),
  null, 'Con la flota libre se ignoran el estado y la regla de aeronave en el origen');
select is(private.program_aircraft_block_reason('00000000-0000-0000-0000-00000000f103', (select airline from t), (select fl2 from t), '{}', (select mmmx from t)),
  null, 'Tours y eventos también usan la flota libre');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f103"}';
select lives_ok($$select book_flight((select r300 from t), (select fl1 from t), 'QFL301')$$, 'El piloto 3 reserva la misma matrícula que el piloto 2');
reset role;
select is((select count(*)::int from flight_bookings where aircraft_id = (select fl1 from t) and status = 'active'), 2,
  'La misma aeronave tiene dos reservas activas');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f101"}';
select results_eq(
  $$select count(*)::int, max((x ->> 'active_bookings')::int)
      from jsonb_array_elements(get_operations_overview((select airline from t)) -> 'fleet') x
     where x ->> 'registration' = 'XA-FL1'$$,
  $$values (1, 2)$$,
  'El Operations Center muestra la aeronave una vez, con sus dos reservas activas'
);
reset role;

-- El piloto 3 cancela y reserva XA-FL2 (en mantenimiento): su estado no cambia.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f103"}';
select cancel_booking((select id from flight_bookings where user_id = '00000000-0000-0000-0000-00000000f103' and status = 'active'));
select lives_ok($$select book_flight((select r300 from t), (select fl2 from t), 'QFL302')$$, 'Con la flota libre se reserva una aeronave en mantenimiento');
reset role;
select is((select status::text from aircraft where id = (select fl2 from t)), 'maintenance', 'Con la flota libre, el sistema no cambia el estado de la aeronave');

-- -----------------------------------------------------------------------------
-- Rutas registradas por pilotos
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f102"}';
update t set r400 = register_route((select airline from t), ' 400 ', (select mmmx from t), (select mmmy from t), 'passenger', null);
update t set r500 = register_route((select airline from t), '500', (select mmmx from t), (select mmgl from t));
select throws_ok($$select register_route((select airline from t), '300', (select mmgl from t), (select mmmy from t))$$,
  '23505', 'El número de vuelo 300 ya existe en la aerolínea (MMMX–MMGL)', 'El número de vuelo no se repite en la aerolínea');
select throws_ok($$select register_route((select airline from t), 'AB12', (select mmgl from t), (select mmmy from t))$$,
  'P0001', null, 'El número de vuelo se valida');
select throws_ok($$select register_route((select airline from t), '600', (select mmgl from t), (select mmgl from t))$$,
  'P0001', 'El origen y el destino deben ser distintos', 'Origen y destino distintos');
reset role;

select results_eq(
  $$select activated_at is null, registered_by, distance_nm > 0, estimated_minutes between 10 and 1440 from routes where id = (select r400 from t)$$,
  $$values (true, '00000000-0000-0000-0000-00000000f102'::uuid, true, true)$$,
  'La ruta del piloto nace pendiente, con su autor, distancia y duración calculadas'
);
select is(private.booking_block_reason('00000000-0000-0000-0000-00000000f103', (select r400 from t), (select fl1 from t)),
  null, 'Una ruta pendiente se puede reservar');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f104"}';
select throws_ok($$select register_route((select airline from t), '700', (select mmgl from t), (select mmmy from t))$$,
  '42501', null, 'Quien no es miembro no registra rutas');
select throws_ok($$select * from get_route_type_usage((select airline from t))$$, '42501', null, 'Quien no es miembro no ve los tipos volados');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f101"}';
update airline_settings set pilots_register_routes = false where airline_id = (select airline from t);
select lives_ok($$select register_route((select airline from t), '800', (select mmgl from t), (select mmmy from t))$$,
  'Con el registro cerrado, el staff todavía registra rutas');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f102"}';
select throws_ok($$select register_route((select airline from t), '900', (select mmgl from t), (select mmmy from t))$$,
  'P0001', 'Esta aerolínea no permite que los pilotos registren rutas', 'Con el registro cerrado, un piloto no registra rutas');

-- Borrar: solo su autor, mientras esté pendiente.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f103"}';
delete from routes where id = (select r500 from t);
reset role;
select ok(exists (select 1 from routes where id = (select r500 from t)), 'Un piloto no borra la ruta pendiente de otro');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f102"}';
delete from routes where id = (select r500 from t);
reset role;
select ok(not exists (select 1 from routes where id = (select r500 from t)), 'El autor borra su ruta pendiente');

-- -----------------------------------------------------------------------------
-- Activación con el primer PIREP aceptado que llegó al destino
-- -----------------------------------------------------------------------------
create temp table v on commit drop as
select n, gen_random_uuid() as flight, gen_random_uuid() as session, arrival
  from (values (1, (select mmgl from t)), (2, (select mmmy from t))) as x(n, arrival);
insert into flights (id, airline_id, user_id, route_id, aircraft_type_id, aircraft_registration, airline_icao, flight_number, callsign,
                     origin_airport_id, destination_airport_id, planned_distance_nm, planned_minutes, operation_type, network, status, started_at, completed_at)
select v.flight, t.airline, '00000000-0000-0000-0000-00000000f102', t.r400, t.a20n, 'XA-FL1', 'QFL', '400', 'QFL40' || v.n,
       t.mmmx, t.mmmy, 380, 80, 'passenger', 'IVAO', 'completed', now() - interval '3 hours', now() - interval '1 hour'
  from t, v;
insert into flight_sessions (id, flight_id, user_id, airline_id, status, phase, started_at, ended_at)
select v.session, v.flight, '00000000-0000-0000-0000-00000000f102', t.airline, 'completed', 'flight_completed', now() - interval '3 hours', now() - interval '1 hour'
  from t, v;
-- Vuelo 1: se desvió a MMGL y lo aceptan. Vuelo 2: llegó a MMMY, en revisión.
insert into pireps (flight_id, session_id, airline_id, user_id, aircraft_type_id, aircraft_registration, callsign, flight_number,
                    origin_airport_id, destination_airport_id, arrival_airport_id, diverted, block_on_at, block_minutes, distance_nm, score, status, reviewed_at)
select v.flight, v.session, t.airline, '00000000-0000-0000-0000-00000000f102', t.a20n, 'XA-FL1', 'QFL40' || v.n, '400',
       t.mmmx, t.mmmy, v.arrival, v.arrival <> t.mmmy, now() - interval '1 hour', 90, 380, 95,
       case when v.n = 1 then 'accepted' else 'pending' end::pirep_status, case when v.n = 1 then now() end
  from t, v;
select is((select activated_at from routes where id = (select r400 from t)), null, 'Un PIREP aceptado que se desvió no activa la ruta');
select is((select activated_at from routes where id = (select r400 from t)), null, 'Un PIREP en revisión no activa la ruta');
update pireps set status = 'accepted', reviewed_at = now() where session_id = (select session from v where n = 2);
select results_eq(
  $$select r.activated_at is not null, r.activated_pirep_id = p.id from routes r, pireps p
     where r.id = (select r400 from t) and p.session_id = (select session from v where n = 2)$$,
  $$values (true, true)$$,
  'El primer PIREP aceptado que llegó al destino activa la ruta'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f103"}';
select results_eq(
  $$select icao_code, flights from get_route_type_usage((select airline from t)) where route_id = (select r400 from t)$$,
  $$values ('A20N'::text, 2)$$,
  'Los miembros ven con qué tipos se ha volado cada ruta'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f101"}';
select is(
  (import_routes((select airline from t), '[{"flight_number":"910","origin":"MMGL","destination":"MMMY","aircraft_types":""}]'::jsonb, false) ->> 'created')::int,
  1, 'La importación CSV acepta rutas sin tipos de aeronave'
);
reset role;

select * from finish();
rollback;
