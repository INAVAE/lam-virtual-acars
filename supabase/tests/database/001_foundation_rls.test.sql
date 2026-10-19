-- Pruebas de aislamiento y permisos de la Fase 1.
-- Ejecutar con: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(38);

-- -----------------------------------------------------------------------------
-- Datos de prueba (como postgres: sin auth.uid(), las reglas de rol no aplican)
-- -----------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@lam.test',   '{"display_name":"Admin LAM"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'jefe@lam.test',    '{"display_name":"Jefa Alas"}'),
  ('00000000-0000-0000-0000-0000000000a3', 'pilotox@lam.test', '{"display_name":"Piloto X"}'),
  ('00000000-0000-0000-0000-0000000000a4', 'pilotoy@lam.test', '{"display_name":"Piloto Y"}'),
  ('00000000-0000-0000-0000-0000000000a5', 'n@lam.test',       '{}');

select is(
  (select count(*)::int from profiles where email like '%@lam.test'), 5,
  'Se crea un perfil por cada usuario registrado'
);
select ok(
  (select min(pilot_number) from profiles where email like '%@lam.test') >= 1001,
  'Los números de piloto empiezan en 1001'
);
select is(
  (select display_name from profiles where email = 'n@lam.test'), 'Piloto',
  'Un correo corto sin nombre recibe un nombre por defecto válido'
);
select is(
  (select count(*)::int from airline_settings), (select count(*)::int from airlines),
  'Cada aerolínea tiene su configuración'
);

select private.grant_superadmin('admin@lam.test');
update airlines set icao_code = 'ADS', is_active = true where slug = 'alas-del-sur';
update airlines set icao_code = 'TSX', is_active = true where slug = 'taesa';

insert into airline_memberships (airline_id, user_id, roles, status)
select id, '00000000-0000-0000-0000-0000000000a2', '{airline_admin,pilot}', 'active' from airlines where slug = 'alas-del-sur';
insert into airline_memberships (airline_id, user_id, roles, status)
select id, '00000000-0000-0000-0000-0000000000a3', '{pilot}', 'active' from airlines where slug = 'alas-del-sur';
insert into airline_memberships (airline_id, user_id, roles, status)
select id, '00000000-0000-0000-0000-0000000000a4', '{pilot}', 'active' from airlines where slug = 'taesa';

-- Copia de los ids para usarlos con roles que no ven todas las aerolíneas.
create temp table t_airlines on commit drop as select slug, id from airlines;
grant select on t_airlines to anon, authenticated;

select throws_ok(
  $$update airlines set is_active = true where slug = 'fedex-virtual'$$,
  '23514', null,
  'Una aerolínea no se activa sin código ICAO'
);

-- -----------------------------------------------------------------------------
-- Visitante
-- -----------------------------------------------------------------------------
set local role anon;
select is((select count(*)::int from airlines), 2, 'Visitante ve solo aerolíneas activas');
select throws_ok('select * from profiles', '42501', null, 'Visitante no puede leer perfiles');
select throws_ok('select * from airline_memberships', '42501', null, 'Visitante no puede leer membresías');
select throws_ok('select get_dashboard_summary()', '42501', null, 'Visitante no puede pedir el resumen');
reset role;

-- -----------------------------------------------------------------------------
-- Piloto X (piloto activo de Alas del Sur)
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a3"}';

select is((select count(*)::int from airline_memberships), 1, 'Piloto ve solo su propia membresía');
select is((select count(*)::int from airline_settings), 1, 'Piloto ve configuración solo de su aerolínea');
select is((select count(*)::int from profiles), 1, 'Piloto ve solo su propio perfil');
select is((select count(*)::int from audit_logs), 0, 'Piloto no ve la auditoría');
select is((select count(*)::int from organization_members), 0, 'Piloto no ve superadministradores');

select lives_ok(
  $$update airline_memberships set roles = '{airline_admin,pilot}' where user_id = '00000000-0000-0000-0000-0000000000a3'$$,
  'Intentar subir sus propios roles no produce cambios'
);
select throws_ok(
  $$insert into airline_memberships (airline_id, user_id, roles, status)
    select id, '00000000-0000-0000-0000-0000000000a3', '{airline_admin}', 'pending' from airlines where slug = 'taesa'$$,
  '42501', null,
  'Piloto no puede solicitar ingreso como administrador'
);
select throws_ok(
  $$insert into airline_memberships (airline_id, user_id, roles, status)
    select id, '00000000-0000-0000-0000-0000000000a3', '{pilot}', 'active' from airlines where slug = 'taesa'$$,
  '42501', null,
  'Piloto no puede darse de alta como activo'
);
select throws_ok(
  $$insert into airline_memberships (airline_id, user_id, roles, status)
    select id, '00000000-0000-0000-0000-0000000000a3', '{pilot}', 'pending'
    from t_airlines where slug = 'fedex-virtual'$$,
  '42501', null,
  'No se puede solicitar ingreso a una aerolínea inactiva'
);
select lives_ok(
  $$insert into airline_memberships (airline_id, user_id, roles, status)
    select id, '00000000-0000-0000-0000-0000000000a3', '{pilot}', 'pending' from airlines where slug = 'taesa'$$,
  'Piloto puede solicitar ingreso a una aerolínea activa'
);
select throws_ok(
  $$update profiles set account_status = 'suspended' where id = '00000000-0000-0000-0000-0000000000a3'$$,
  '42501', null,
  'Piloto no puede cambiar su estado de cuenta'
);
select lives_ok(
  $$update profiles set display_name = 'Capitán X', country_code = 'MX' where id = '00000000-0000-0000-0000-0000000000a3'$$,
  'Piloto puede editar sus datos personales'
);
select throws_ok(
  $$update profiles set primary_airline_id = (select id from airlines where slug = 'taesa')
    where id = '00000000-0000-0000-0000-0000000000a3'$$,
  '23514', null,
  'La aerolínea principal requiere membresía activa'
);
select lives_ok(
  $$update profiles set primary_airline_id = (select id from airlines where slug = 'alas-del-sur')
    where id = '00000000-0000-0000-0000-0000000000a3'$$,
  'Piloto puede elegir como principal una aerolínea donde está activo'
);
select throws_ok(
  $$insert into organization_members (organization_id, user_id, role)
    select id, '00000000-0000-0000-0000-0000000000a3', 'superadmin' from organizations$$,
  '42501', null,
  'Piloto no puede hacerse superadministrador'
);
select throws_ok(
  $$select get_dashboard_summary((select id from airlines where slug = 'taesa'))$$,
  '42501', null,
  'Piloto no puede pedir el resumen de otra aerolínea'
);
select is(get_dashboard_summary() ->> 'scope', 'member', 'El resumen de un piloto es de sus aerolíneas');
reset role;

select is(
  (select roles from airline_memberships m join airlines a on a.id = m.airline_id
   where m.user_id = '00000000-0000-0000-0000-0000000000a3' and a.slug = 'alas-del-sur'),
  '{pilot}'::airline_role[],
  'Los roles del piloto siguen intactos'
);

-- -----------------------------------------------------------------------------
-- Administradora de Alas del Sur
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a2"}';

select is((select count(*)::int from airline_memberships), 2, 'Administradora ve solo membresías de su aerolínea');
select is((select count(*)::int from profiles), 2, 'Administradora ve perfiles de su aerolínea');
select throws_ok(
  $$update airline_memberships set roles = '{airline_admin,pilot}'
    where user_id = '00000000-0000-0000-0000-0000000000a3'$$,
  '42501', null,
  'Administradora de aerolínea no puede nombrar otros administradores'
);
select lives_ok(
  $$update airline_memberships set status = 'suspended'
    where user_id = '00000000-0000-0000-0000-0000000000a3'$$,
  'Administradora puede suspender a un piloto de su aerolínea'
);
select throws_ok(
  $$update airlines set icao_code = 'ZZZ' where slug = 'alas-del-sur'$$,
  '42501', null,
  'Administradora no puede cambiar el código ICAO'
);
select lives_ok(
  $$update airlines set brand_primary_color = '#123456' where slug = 'alas-del-sur'$$,
  'Administradora puede cambiar la identidad visual'
);
select ok((select count(*) from audit_logs) > 0, 'Administradora ve la auditoría de su aerolínea');
reset role;

select is(
  (select primary_airline_id from profiles where id = '00000000-0000-0000-0000-0000000000a3'),
  null,
  'Suspender la membresía limpia la aerolínea principal'
);
select is(
  (select decided_by from airline_memberships m join airlines a on a.id = m.airline_id
   where m.user_id = '00000000-0000-0000-0000-0000000000a3' and a.slug = 'alas-del-sur'),
  '00000000-0000-0000-0000-0000000000a2'::uuid,
  'El cambio de estado registra quién decidió'
);

-- -----------------------------------------------------------------------------
-- Superadministrador
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a1"}';

select is((select count(*)::int from airlines), 4, 'Superadministrador ve todas las aerolíneas');
select is(get_dashboard_summary() ->> 'scope', 'organization', 'El resumen del superadministrador es consolidado');
reset role;

select * from finish();
rollback;
