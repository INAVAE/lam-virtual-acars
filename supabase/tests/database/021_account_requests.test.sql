-- Cuentas de piloto con aprobación previa.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(18);

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('00000000-0000-0000-0000-00000000fe01', 'super@cuentas.test', '{"display_name":"Super Cuentas"}', now()),
  ('00000000-0000-0000-0000-00000000fe02', 'piloto@cuentas.test', '{"display_name":"Piloto Cuentas"}', now());
insert into organization_members (organization_id, user_id, role)
select id, '00000000-0000-0000-0000-00000000fe01', 'superadmin' from organizations where slug = 'lam';

-- -----------------------------------------------------------------------------
-- Solicitar sin sesión
-- -----------------------------------------------------------------------------
set local role anon;
select lives_ok($$select request_pilot_account('  Nuevo@Correo.TEST ', 'Nuevo Piloto', null, 'Vuelo en IVAO', ' 123456 ')$$,
  'Cualquiera sin sesión solicita una cuenta');
select lives_ok($$select request_pilot_account('nuevo@correo.test', 'Otra vez')$$,
  'Repetir con el mismo correo responde igual (sin revelar nada)');
select lives_ok($$select request_pilot_account('piloto@cuentas.test', 'Ya existo')$$,
  'Un correo con cuenta también responde igual');
select throws_ok($$select request_pilot_account('no-es-correo', 'Alguien')$$, '22023', null, 'Correo inválido');
select throws_ok($$select request_pilot_account('a@b.test', 'Alguien', null, null, 'ABC')$$, '22023', null, 'VID de IVAO inválido');
select throws_ok($$select * from account_requests$$, '42501', null, 'Sin sesión no se leen las solicitudes');
reset role;

select results_eq(
  $$select email, display_name, ivao_vid, status from account_requests order by created_at$$,
  $$values ('nuevo@correo.test'::text, 'Nuevo Piloto'::text, '123456'::text, 'pending'::text)$$,
  'Una sola solicitud, con el correo normalizado'
);

-- -----------------------------------------------------------------------------
-- Candado de Supabase Auth: sin solicitud aprobada no se crea el usuario
-- -----------------------------------------------------------------------------
set local lam.enforce_signup_guard = 'on';
select throws_ok(
  $$insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000fe09', 'nuevo@correo.test')$$,
  '42501', null, 'Supabase Auth no crea al usuario mientras la solicitud esté pendiente'
);
select throws_ok(
  $$insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000fe08', 'cualquiera@otro.test')$$,
  '42501', null, 'Ni a quien no solicitó (registro directo por la API)'
);
reset lam.enforce_signup_guard;

-- -----------------------------------------------------------------------------
-- Revisar
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fe02"}';
select is((select count(*)::int from account_requests), 0, 'Un piloto no ve solicitudes');
select throws_ok($$select approve_account_request((select id from account_requests limit 1))$$, '42501', null,
  'Un piloto no aprueba');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fe01"}';
select is((select count(*)::int from account_requests where status = 'pending'), 1, 'El superadministrador ve la pendiente');
select is((select approve_account_request(id) ->> 'email' from account_requests where email = 'nuevo@correo.test'), 'nuevo@correo.test',
  'La aprueba y obtiene el correo para invitar');
select throws_ok($$select create_account_invitation('piloto@cuentas.test', 'Ya existe')$$, 'P0001', null,
  'No se invita a un correo con cuenta activa');
select lives_ok($$select create_account_invitation('Invitado@Correo.test', 'Invitado Directo')$$,
  'Invitación directa sin formulario');
reset role;

set local lam.enforce_signup_guard = 'on';
select lives_ok(
  $$insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-00000000fe09', 'nuevo@correo.test', '{"display_name":"Nuevo Piloto"}')$$,
  'Con la solicitud aprobada, Supabase Auth crea al usuario (la invitación)'
);
reset lam.enforce_signup_guard;
select is((select user_id::text from account_requests where email = 'nuevo@correo.test'), '00000000-0000-0000-0000-00000000fe09',
  'La solicitud queda ligada al perfil nuevo');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fe01"}';
select throws_ok($$select reject_account_request((select id from account_requests where email = 'nuevo@correo.test'))$$, 'P0001', null,
  'Una solicitud ya convertida en cuenta no se rechaza');
reset role;

select * from finish();
rollback;
