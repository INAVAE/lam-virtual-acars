-- Vuelo directo: reserva sin ruta registrada, con o sin registrar la ruta.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(16);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000fd01', 'admin@directo.test', '{"display_name":"Admin Directo"}'),
  ('00000000-0000-0000-0000-00000000fd02', 'p1@directo.test', '{"display_name":"Piloto Directo"}'),
  ('00000000-0000-0000-0000-00000000fd03', 'ajeno@directo.test', '{"display_name":"Ajeno"}');
insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, 'directo-aerolinea', 'Prueba Directo', 'QDR', true from organizations where slug = 'lam';
insert into airports (icao_code, iata_code, name, city, country_code, latitude, longitude, elevation_ft, airport_type) values
  ('MMMX', 'MEX', 'Aeropuerto Internacional de la Ciudad de México', 'Ciudad de México', 'MX', 19.4363, -99.0721, 7316, 'large_airport'),
  ('MMGL', 'GDL', 'Aeropuerto Internacional de Guadalajara', 'Guadalajara', 'MX', 20.5218, -103.3112, 5016, 'large_airport')
on conflict (icao_code) do nothing;

create temp table t on commit drop as
select (select id from airlines where slug = 'directo-aerolinea') as airline,
       (select id from aircraft_types where icao_code = 'B738') as b738,
       (select id from airports where icao_code = 'MMMX') as mmmx,
       (select id from airports where icao_code = 'MMGL') as mmgl;
insert into airline_memberships (airline_id, user_id, roles, status)
select airline, '00000000-0000-0000-0000-00000000fd01'::uuid, '{airline_admin,pilot}'::airline_role[], 'active'::membership_status from t union all
select airline, '00000000-0000-0000-0000-00000000fd02', '{pilot}', 'active' from t;
insert into aircraft (airline_id, aircraft_type_id, registration, operation_type, current_airport_id, status)
select airline, b738, r, 'passenger', mmmx, 'available'::aircraft_status from t, (values ('XA-DR1'), ('XA-DR2'), ('XA-DR3')) x(r);
update airline_settings set require_type_rating = false, max_active_bookings = 3 where airline_id = (select airline from t);
alter table t add column dr1 uuid, add column dr2 uuid, add column dr3 uuid;
update t set dr1 = (select id from aircraft where registration = 'XA-DR1'), dr2 = (select id from aircraft where registration = 'XA-DR2'),
             dr3 = (select id from aircraft where registration = 'XA-DR3');
grant select on t to authenticated;

select is((select allow_direct_flights from airline_settings where airline_id = (select airline from t)), true,
  'Una aerolínea nueva permite vuelos directos');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fd02"}';

select is((select count(*)::int from direct_aircraft_options((select airline from t), (select mmmx from t)) where block_reason is null), 3,
  'El piloto ve las aeronaves disponibles para un vuelo directo');

-- Sin registrar la ruta
create temp table b1 on commit drop as
select book_direct_flight(airline, ' 2201 ', mmmx, mmgl, dr1, 'qdr2201', false) as r from t;
select results_eq(
  $$select f.route_id is null, f.flight_number, f.callsign, f.origin_airport_id = t.mmmx, f.destination_airport_id = t.mmgl,
           f.planned_distance_nm between 200 and 300, f.status::text
      from flights f, t, b1 where f.id = (b1.r ->> 'flight_id')::uuid$$,
  $$values (true, '2201'::text, 'QDR2201'::text, true, true, true, 'scheduled'::text)$$,
  'Vuelo directo sin ruta: número, callsign, aeropuertos y distancia calculada'
);
select is((select count(*)::int from routes where airline_id = (select airline from t)), 0, 'Sin registrar no se crea ninguna ruta');
select is((select route_id from flight_bookings where id = (select (r ->> 'booking_id')::uuid from b1)), null, 'La reserva tampoco tiene ruta');
select ok((select block_reason from direct_aircraft_options((select airline from t), (select mmmx from t)) where aircraft_id = (select dr1 from t)) is not null,
  'La aeronave reservada queda ocupada');

-- Registrando la ruta
create temp table b2 on commit drop as
select book_direct_flight(airline, '2202', mmgl, mmmx, dr2, 'QDR2202', true) as r from t;
select results_eq(
  $$select r.flight_number, r.activated_at is null, r.registered_by::text, f.route_id = r.id, (b2.r ->> 'route_registered')::boolean
      from b2, flights f join routes r on r.id = f.route_id where f.id = (b2.r ->> 'flight_id')::uuid$$,
  $$values ('2202'::text, true, '00000000-0000-0000-0000-00000000fd02'::text, true, true)$$,
  'Con registro: la ruta queda pendiente, a nombre del piloto, y el vuelo la usa'
);

-- Errores
select throws_ok($$select book_direct_flight(airline, '2203', mmmx, mmmx, dr1, 'QDR2203') from t$$, '22023', null,
  'Origen y destino iguales');
select throws_ok($$select book_direct_flight(airline, 'ABC', mmmx, mmgl, dr1, 'QDR2203') from t$$, '22023', null,
  'Número de vuelo inválido');
select throws_ok($$select book_direct_flight(airline, '2204', mmmx, mmgl, dr1, 'QDR2204') from t$$, 'P0001', null,
  'La aeronave ocupada no se vuelve a reservar');
select throws_ok($$select book_direct_flight(airline, '2202', mmmx, mmgl, dr3, 'QDR2202', true) from t$$,
  '23505', null, 'Con registro, el número de vuelo no puede repetir una ruta existente');
select is((select count(*)::int from routes where airline_id = (select airline from t)), 1,
  'Si la reserva con registro falla, no queda ninguna ruta suelta');

-- La aerolínea lo apaga
reset role;
update airline_settings set allow_direct_flights = false where airline_id = (select airline from t);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fd02"}';
select throws_ok($$select book_direct_flight(airline, '2205', mmmx, mmgl, dr3, 'QDR2205') from t$$, 'P0001', null,
  'Con vuelos directos apagados, el piloto no puede');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fd01"}';
select lives_ok($$select book_direct_flight(airline, '2205', mmmx, mmgl, dr3, 'QDR2205') from t$$,
  'El administrador de la aerolínea sí reserva vuelos directos aunque estén apagados');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fd03"}';
select throws_ok($$select book_direct_flight(airline, '2206', mmmx, mmgl, dr1, 'QDR2206') from t$$, '42501', null,
  'Quien no es miembro no reserva');
select is((select count(*)::int from direct_aircraft_options((select airline from t), null)), 0,
  'Quien no es miembro no ve aeronaves');
reset role;

select * from finish();
rollback;
