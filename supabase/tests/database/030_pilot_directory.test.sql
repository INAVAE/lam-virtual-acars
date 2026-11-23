-- Directorio de pilotos: cualquier piloto activo ve a los pilotos de todas las
-- aerolíneas (y quién aún no ha sido aprobado), sin correos. El perfil se abre
-- desde ahí e incluye los tours del piloto con su avance.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(14);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000d01', 'uno@dir.test', '{"display_name":"Piloto Uno"}'),
  ('00000000-0000-0000-0000-000000000d02', 'dos@dir.test', '{"display_name":"Piloto Dos"}'),
  ('00000000-0000-0000-0000-000000000d03', 'tres@dir.test', '{"display_name":"Piloto Tres"}'),
  ('00000000-0000-0000-0000-000000000d04', 'cuatro@dir.test', '{"display_name":"Piloto Cuatro"}'),
  ('00000000-0000-0000-0000-000000000d05', 'admin@dir.test', '{"display_name":"Admin Dir"}');
insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, x.slug, x.name, x.icao, true from organizations, (values ('dir-uno', 'Directorio Uno', 'QDA'), ('dir-dos', 'Directorio Dos', 'QDB')) x(slug, name, icao)
 where organizations.slug = 'lam';
insert into airports (icao_code, iata_code, name, city, country_code, latitude, longitude, elevation_ft, airport_type) values
  ('MMMX', 'MEX', 'Aeropuerto Internacional de la Ciudad de México', 'Ciudad de México', 'MX', 19.4363, -99.0721, 7316, 'large_airport'),
  ('MMGL', 'GDL', 'Aeropuerto Internacional de Guadalajara', 'Guadalajara', 'MX', 20.5218, -103.3112, 5016, 'large_airport'),
  ('MMMY', 'MTY', 'Aeropuerto Internacional de Monterrey', 'Monterrey', 'MX', 25.7785, -100.1069, 1278, 'large_airport')
on conflict (icao_code) do nothing;

create temp table t (a1 uuid, a2 uuid, n2 int, n3 int, n4 int, tour uuid) on commit drop;
insert into t (a1, a2, n2, n3, n4)
select (select id from airlines where slug = 'dir-uno'), (select id from airlines where slug = 'dir-dos'),
       (select pilot_number from profiles where id = '00000000-0000-0000-0000-000000000d02'),
       (select pilot_number from profiles where id = '00000000-0000-0000-0000-000000000d03'),
       (select pilot_number from profiles where id = '00000000-0000-0000-0000-000000000d04');
grant select, update on t to authenticated;

-- Uno en la aerolínea Uno; Dos en la Dos; Tres solo con solicitud pendiente; Cuatro sin aerolínea.
insert into airline_memberships (airline_id, user_id, roles, status)
select a1, '00000000-0000-0000-0000-000000000d01'::uuid, '{pilot}'::airline_role[], 'active'::membership_status from t union all
select a2, '00000000-0000-0000-0000-000000000d02', '{pilot}', 'active' from t union all
select a1, '00000000-0000-0000-0000-000000000d03', '{pilot}', 'pending' from t union all
select a2, '00000000-0000-0000-0000-000000000d05', '{airline_admin}', 'active' from t;
update profiles set ivao_vid = '700002' where id = '00000000-0000-0000-0000-000000000d02';

-- Un tour de la aerolínea Dos con dos legs; Dos está inscrito.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000d05"}';
update t set tour = save_tour(null, jsonb_build_object('airline_id', (select a2 from t), 'code', 'DIR-01', 'name', 'Directorio', 'ordered_legs', false),
  jsonb_build_array(
    jsonb_build_object('origin_airport_id', (select id from airports where icao_code = 'MMMX'), 'destination_airport_id', (select id from airports where icao_code = 'MMGL')),
    jsonb_build_object('origin_airport_id', (select id from airports where icao_code = 'MMGL'), 'destination_airport_id', (select id from airports where icao_code = 'MMMY'))));
reset role;
update tours set status = 'published' where id = (select tour from t);
insert into tour_enrollments (tour_id, user_id, airline_id, status)
select tour, '00000000-0000-0000-0000-000000000d02', a2, 'approved' from t;

set local role authenticated;

-- Piloto activo
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000d01"}';
select is(
  (select x ->> 'airline_icao' from jsonb_array_elements(get_pilot_directory()) x where x ->> 'user_id' = '00000000-0000-0000-0000-000000000d02'),
  'QDB', 'Un piloto ve a los pilotos de otra aerolínea, con su aerolínea');
select is(
  (select x ->> 'ivao_vid' from jsonb_array_elements(get_pilot_directory()) x where x ->> 'user_id' = '00000000-0000-0000-0000-000000000d02'),
  '700002', 'Con su VID de IVAO');
select is(
  (select x ->> 'status' from jsonb_array_elements(get_pilot_directory()) x where x ->> 'user_id' = '00000000-0000-0000-0000-000000000d03'),
  'pending', 'Y ve quién aún no ha sido aprobado');
select ok(
  not exists (select 1 from jsonb_array_elements(get_pilot_directory()) x where x ? 'email'),
  'El directorio no muestra correos');
select ok(
  not exists (select 1 from jsonb_array_elements(get_pilot_directory()) x where x ->> 'user_id' = '00000000-0000-0000-0000-000000000d04'),
  'Quien no ha solicitado ingreso no aparece');
select is((select get_pilot_profile(n2) -> 'profile' ->> 'display_name' from t), 'Piloto Dos', 'Abre el perfil de un piloto de otra aerolínea');
select is((select get_pilot_profile(n2) -> 'profile' ->> 'email' from t), null, 'Sin su correo');
select is((select get_pilot_profile(n3) -> 'memberships' -> 0 ->> 'status' from t), 'pending', 'En el perfil se ve la solicitud pendiente');
select throws_ok($$select get_pilot_profile(n4) from t$$, '42501', null, 'No el de quien no tiene aerolínea');
select results_eq(
  $$select x ->> 'code', (x ->> 'legs')::int, (x ->> 'accepted')::int, x ->> 'enrollment_status'
      from t, jsonb_array_elements(get_pilot_profile(t.n2) -> 'tours') x$$,
  $$values ('DIR-01'::text, 2, 0, 'approved'::text)$$,
  'El perfil muestra el tour en curso con sus legs completados y totales');

-- Solicitud pendiente y sin aerolínea: no ven el directorio
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000d03"}';
select throws_ok($$select get_pilot_directory()$$, '42501', null, 'Con la solicitud pendiente aún no ve el directorio');
select is((select get_pilot_profile(n3) -> 'memberships' -> 0 ->> 'status' from t), 'pending', 'Pero sí el estado de su solicitud en su perfil');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000d04"}';
select throws_ok($$select get_pilot_directory()$$, '42501', null, 'Sin aerolínea tampoco');
select throws_ok($$select get_pilot_profile(n2) from t$$, '42501', null, 'Ni el perfil de otros');
reset role;

select * from finish();
rollback;
