-- Cuentas de la plataforma: lista para el superadministrador y revocar el acceso.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(15);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000fa01', 'super@cuentas2.test', '{"display_name":"Super Cuentas"}'),
  ('00000000-0000-0000-0000-00000000fa02', 'piloto@cuentas2.test', '{"display_name":"Piloto Con Reserva"}'),
  ('00000000-0000-0000-0000-00000000fa03', 'nuevo@cuentas2.test', '{"display_name":"Sin Aerolinea"}'),
  ('00000000-0000-0000-0000-00000000fa04', 'super2@cuentas2.test', '{"display_name":"Otro Super"}');
insert into organization_members (organization_id, user_id, role)
select id, u::uuid, 'superadmin' from organizations, (values ('00000000-0000-0000-0000-00000000fa01'), ('00000000-0000-0000-0000-00000000fa04')) x(u)
 where slug = 'lam';
insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, 'cuentas-aerolinea', 'Prueba Cuentas', 'QCU', true from organizations where slug = 'lam';
insert into airports (icao_code, iata_code, name, city, country_code, latitude, longitude, elevation_ft, airport_type) values
  ('MMMX', 'MEX', 'Aeropuerto Internacional de la Ciudad de México', 'Ciudad de México', 'MX', 19.4363, -99.0721, 7316, 'large_airport'),
  ('MMGL', 'GDL', 'Aeropuerto Internacional de Guadalajara', 'Guadalajara', 'MX', 20.5218, -103.3112, 5016, 'large_airport')
on conflict (icao_code) do nothing;

create temp table t on commit drop as
select (select id from airlines where slug = 'cuentas-aerolinea') as airline,
       (select id from aircraft_types where icao_code = 'B738') as b738,
       (select id from airports where icao_code = 'MMMX') as mmmx,
       (select id from airports where icao_code = 'MMGL') as mmgl;
insert into airline_memberships (airline_id, user_id, roles, status)
select airline, '00000000-0000-0000-0000-00000000fa02'::uuid, '{pilot}'::airline_role[], 'active'::membership_status from t;
insert into aircraft (airline_id, aircraft_type_id, registration, operation_type, current_airport_id, status)
select airline, b738, 'XA-CU1', 'passenger', mmmx, 'available'::aircraft_status from t;
update airline_settings set require_type_rating = false where airline_id = (select airline from t);
grant select on t to authenticated;

-- El piloto reserva un vuelo directo.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fa02"}';
select lives_ok($$select book_direct_flight(airline, '3101', mmmx, mmgl, (select id from aircraft where registration = 'XA-CU1'), 'QCU3101') from t$$,
  'El piloto tiene una reserva activa');
select throws_ok($$select * from list_platform_accounts()$$, '42501', null, 'Un piloto no ve la lista de cuentas');
select throws_ok($$select set_account_access('00000000-0000-0000-0000-00000000fa03', false)$$, '42501', null, 'Un piloto no revoca accesos');

-- Superadministrador
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fa01"}';
select is((select jsonb_array_length(memberships) from list_platform_accounts() where email = 'nuevo@cuentas2.test'), 0,
  'La cuenta que aún no pide aerolínea aparece, sin aerolíneas');
select is((select memberships -> 0 ->> 'status' from list_platform_accounts() where email = 'piloto@cuentas2.test'), 'active',
  'La cuenta con aerolínea muestra su membresía');
select is((select is_superadmin from list_platform_accounts() where email = 'super2@cuentas2.test'), true, 'Marca a los superadministradores');

select throws_ok($$select set_account_access('00000000-0000-0000-0000-00000000fa01', false)$$, 'P0001', null,
  'Nadie se revoca a sí mismo');
select throws_ok($$select set_account_access('00000000-0000-0000-0000-00000000fa04', false)$$, 'P0001', null,
  'A otro superadministrador primero se le quita el rol');

select is((select (set_account_access('00000000-0000-0000-0000-00000000fa02', false, 'Cuenta compartida') ->> 'bookings_cancelled')::int), 1,
  'Revocar cancela la reserva sin iniciar');
reset role;
select results_eq(
  $$select account_status::text, suspension_note, suspended_by::text from profiles where id = '00000000-0000-0000-0000-00000000fa02'$$,
  $$values ('suspended'::text, 'Cuenta compartida'::text, '00000000-0000-0000-0000-00000000fa01'::text)$$,
  'La cuenta queda suspendida con su motivo y quién la revocó'
);
select is((select status::text from aircraft where registration = 'XA-CU1'), 'available', 'La aeronave queda libre');
select ok(exists (select 1 from audit_logs where entity_type = 'profiles' and entity_id = '00000000-0000-0000-0000-00000000fa02'),
  'El cambio queda en la bitácora');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fa02"}';
select is(private.is_airline_member((select airline from t)), false, 'Con el acceso revocado deja de contar como miembro');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fa01"}';
select lives_ok($$select set_account_access('00000000-0000-0000-0000-00000000fa02', true)$$, 'El superadministrador restaura el acceso');
reset role;
select results_eq(
  $$select account_status::text, suspended_at is null, suspension_note is null from profiles where id = '00000000-0000-0000-0000-00000000fa02'$$,
  $$values ('active'::text, true, true)$$,
  'Restaurado: activa y sin datos de la revocación'
);

select * from finish();
rollback;
