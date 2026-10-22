-- Pruebas de la Fase 2: catálogos, flota, rutas, importación y logotipos.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(28);

-- -----------------------------------------------------------------------------
-- Escenario
-- -----------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000b1', 'super@p2.test', '{"display_name":"Super"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'admin-a@p2.test', '{"display_name":"Admin A"}'),
  ('00000000-0000-0000-0000-0000000000b3', 'piloto-a@p2.test', '{"display_name":"Piloto A"}'),
  ('00000000-0000-0000-0000-0000000000b4', 'piloto-b@p2.test', '{"display_name":"Piloto B"}');
select private.grant_superadmin('super@p2.test');

insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, 'p2-aerolinea-a', 'Prueba A', 'QQA', true from organizations where slug = 'lam';
insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, 'p2-aerolinea-b', 'Prueba B', 'QQB', true from organizations where slug = 'lam';

create temp table t_ids on commit drop as
select
  (select id from airlines where slug = 'p2-aerolinea-a') as airline_a,
  (select id from airlines where slug = 'p2-aerolinea-b') as airline_b,
  (select id from aircraft_types where icao_code = 'B738') as b738,
  (select id from aircraft_types where icao_code = 'A20N') as a20n;
grant select on t_ids to authenticated;

insert into airline_memberships (airline_id, user_id, roles, status)
select airline_a, '00000000-0000-0000-0000-0000000000b2', '{airline_admin,pilot}', 'active' from t_ids;
insert into airline_memberships (airline_id, user_id, roles, status)
select airline_a, '00000000-0000-0000-0000-0000000000b3', '{pilot}', 'active' from t_ids;
insert into airline_memberships (airline_id, user_id, roles, status)
select airline_b, '00000000-0000-0000-0000-0000000000b4', '{pilot}', 'active' from t_ids;

insert into airports (icao_code, iata_code, name, city, country_code, latitude, longitude, elevation_ft, airport_type) values
  ('MMMX', 'MEX', 'Aeropuerto Internacional de la Ciudad de México', 'Ciudad de México', 'MX', 19.4363, -99.0721, 7316, 'large_airport'),
  ('MMGL', 'GDL', 'Aeropuerto Internacional de Guadalajara', 'Guadalajara', 'MX', 20.5218, -103.3112, 5016, 'large_airport'),
  ('MMMY', 'MTY', 'Aeropuerto Internacional de Monterrey', 'Monterrey', 'MX', 25.7785, -100.1069, 1278, 'large_airport')
on conflict (icao_code) do nothing;

insert into aircraft (airline_id, aircraft_type_id, registration)
select airline_b, b738, 'XA-QQB' from t_ids;

-- -----------------------------------------------------------------------------
-- Catálogos
-- -----------------------------------------------------------------------------
select ok((select count(*) from aircraft_types) >= 25, 'El catálogo inicial de tipos de aeronave existe');
select is(
  (select distance_nm from (select private.great_circle_nm(19.4363, -99.0721, 20.5218, -103.3112)::int as distance_nm) d),
  248, 'La distancia MMMX-MMGL es 248 NM'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b3"}';
select ok((select count(*) from airports) >= 3, 'Un piloto puede consultar aeropuertos');
select throws_ok(
  $$insert into airports (icao_code, name, latitude, longitude) values ('ZZZZ', 'Inventado', 0, 0)$$,
  '42501', null, 'Un piloto no puede crear aeropuertos'
);
select throws_ok(
  $$insert into aircraft_types (icao_code, manufacturer, model, wake_category, engine_type) values ('ZZ1', 'X', 'Y', 'L', 'jet')$$,
  '42501', null, 'Un piloto no puede crear tipos de aeronave'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2"}';
select throws_ok(
  $$insert into airports (icao_code, name, latitude, longitude) values ('ZZZZ', 'Inventado', 0, 0)$$,
  '42501', null, 'Un administrador de aerolínea no puede crear aeropuertos'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b1"}';
select lives_ok(
  $$insert into airports (icao_code, name, latitude, longitude, source) values ('ZZZZ', 'Aeropuerto de prueba', 10, 10, 'manual')$$,
  'El superadministrador puede crear aeropuertos'
);
reset role;

-- -----------------------------------------------------------------------------
-- Flota
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2"}';
select lives_ok(
  $$insert into aircraft (airline_id, aircraft_type_id, registration, fleet_number, base_airport_id)
    select airline_a, b738, 'xa-qqa', '101', (select id from airports where icao_code = 'MMMX') from t_ids$$,
  'El administrador agrega una aeronave a su aerolínea'
);
select is((select registration from aircraft where fleet_number = '101'), 'XA-QQA', 'La matrícula se guarda en mayúsculas');
select throws_ok(
  $$insert into aircraft (airline_id, aircraft_type_id, registration) select airline_b, b738, 'XA-QQZ' from t_ids$$,
  '42501', null, 'El administrador no puede agregar aeronaves a otra aerolínea'
);
select is((select count(*)::int from aircraft), 1, 'El administrador no ve la flota de otra aerolínea');
select throws_ok(
  $$update aircraft set status = 'in_flight' where registration = 'XA-QQA'$$,
  '42501', null, 'Nadie pone una aeronave En vuelo a mano'
);
select lives_ok(
  $$update aircraft set status = 'maintenance' where registration = 'XA-QQA'$$,
  'El administrador puede poner una aeronave en mantenimiento'
);
select throws_ok(
  $$update aircraft set total_minutes = 999 where registration = 'XA-QQA'$$,
  '42501', null, 'Las horas de la aeronave no se editan a mano'
);
select throws_ok(
  $$update aircraft set airline_id = (select airline_b from t_ids) where registration = 'XA-QQA'$$,
  '42501', null, 'Una aeronave no cambia de aerolínea'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b3"}';
select is((select count(*)::int from aircraft), 1, 'El piloto ve la flota de su aerolínea');
select is_empty(
  $$update aircraft set notes = 'hola' where registration = 'XA-QQA' returning id$$,
  'El piloto no puede editar la flota'
);
reset role;

-- -----------------------------------------------------------------------------
-- Rutas
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2"}';
select lives_ok(
  $$insert into routes (airline_id, flight_number, origin_airport_id, destination_airport_id)
    select airline_a, '100', (select id from airports where icao_code = 'MMMX'), (select id from airports where icao_code = 'MMGL') from t_ids$$,
  'El administrador crea una ruta'
);
select is((select distance_nm from routes where flight_number = '100'), 248, 'La distancia de la ruta se calcula en el servidor');
select is((select estimated_minutes::int from routes where flight_number = '100'), 65, 'La duración se estima si no se indica');

select is(
  (import_routes(
    (select airline_a from t_ids),
    '[{"flight_number":"200","origin":"MMMX","destination":"MMMY","aircraft_types":"B738|A20N","departure_time_utc":"14:30","days":"135"},
      {"flight_number":"201","origin":"MMMX","destination":"XXXX","aircraft_types":"B738"},
      {"flight_number":"202","origin":"MMGL","destination":"MMMY","aircraft_types":"B999"}]'::jsonb,
    true
  ) -> 'errors') ->> 0 is not null,
  true,
  'La validación previa reporta errores por fila'
);
select is(
  jsonb_array_length(import_routes(
    (select airline_a from t_ids),
    '[{"flight_number":"200","origin":"MMMX","destination":"MMMY","aircraft_types":"B738|A20N"},
      {"flight_number":"201","origin":"MMMX","destination":"XXXX","aircraft_types":"B738"},
      {"flight_number":"202","origin":"MMGL","destination":"MMMY","aircraft_types":"B999"}]'::jsonb,
    true
  ) -> 'errors'),
  2,
  'Se detectan el aeropuerto y el tipo de aeronave inexistentes'
);
select throws_ok(
  $$select import_routes((select airline_a from t_ids),
    '[{"flight_number":"201","origin":"MMMX","destination":"XXXX","aircraft_types":"B738"}]'::jsonb, false)$$,
  '22023', null, 'Con errores, la importación no guarda nada'
);
select is(
  (import_routes(
    (select airline_a from t_ids),
    '[{"flight_number":"200","origin":"MMMX","destination":"MMMY","aircraft_types":"B738|A20N","departure_time_utc":"14:30","days":"135"},
      {"flight_number":"100","origin":"MMMX","destination":"MMGL","aircraft_types":"A20N"}]'::jsonb,
    false
  ) ->> 'created')::int,
  1,
  'La importación crea las rutas nuevas'
);
select is(
  (select days_of_week::int from routes where flight_number = '200'),
  21, 'Los días 1, 3 y 5 se guardan como máscara 21'
);
select is(
  (select count(*)::int from route_aircraft_types rat join routes r on r.id = rat.route_id where r.flight_number = '100'),
  1, 'La importación reemplaza los tipos de una ruta existente'
);
select throws_ok(
  $$select import_routes((select airline_b from t_ids), '[]'::jsonb, false)$$,
  '42501', null, 'No se pueden importar rutas en otra aerolínea'
);
reset role;

-- -----------------------------------------------------------------------------
-- Logotipos
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000b2"}';
select throws_ok(
  $$insert into storage.objects (bucket_id, name) select 'airline-logos', airline_b::text || '/logo.png' from t_ids$$,
  '42501', null, 'Un administrador no sube logotipos a otra aerolínea'
);
reset role;

select * from finish();
rollback;
