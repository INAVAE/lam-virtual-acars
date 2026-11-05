-- Centro de ayuda: reporte de incidencias.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000f301', 'piloto@inc.test', '{"display_name":"Piloto Incidencias"}'),
  ('00000000-0000-0000-0000-00000000f302', 'jefe@inc.test', '{"display_name":"Jefe Incidencias"}'),
  ('00000000-0000-0000-0000-00000000f303', 'otro@inc.test', '{"display_name":"Otro Piloto"}'),
  ('00000000-0000-0000-0000-00000000f304', 'super@inc.test', '{"display_name":"Super Incidencias"}');
insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, x.slug, x.name, x.icao, true
  from organizations, (values ('inc-uno', 'Incidencias Uno', 'QIA'), ('inc-dos', 'Incidencias Dos', 'QIB')) x(slug, name, icao)
 where organizations.slug = 'lam';

create temp table t on commit drop as
select (select id from airlines where slug = 'inc-uno') as a1,
       (select id from airlines where slug = 'inc-dos') as a2;
grant select on t to authenticated;

insert into airline_memberships (airline_id, user_id, roles, status)
select a1, u::uuid, r::airline_role[], 'active'::membership_status
  from t, (values ('00000000-0000-0000-0000-00000000f301', '{pilot}'),
                  ('00000000-0000-0000-0000-00000000f302', '{pilot,ops_chief}')) m(u, r);
insert into airline_memberships (airline_id, user_id, roles, status)
select a2, '00000000-0000-0000-0000-00000000f303'::uuid, '{pilot}'::airline_role[], 'active'::membership_status from t;
insert into organization_members (organization_id, user_id, role)
select id, '00000000-0000-0000-0000-00000000f304', 'superadmin' from organizations where slug = 'lam';

-- -----------------------------------------------------------------------------
-- Enviar
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f301"}';

select lives_ok(
  $$insert into support_tickets (airline_id, kind, module, reference, title, details, context)
    select a1, 'error', 'Flight Booking', ' pirep-2026-00006 ', '  No puedo reservar  ',
           'Al pulsar Reservar aparece un error de aeronave.', '{"browser":"Chrome · Windows","path":"/booking"}'::jsonb from t$$,
  'El piloto reporta una incidencia de su aerolínea'
);
select lives_ok(
  $$insert into support_tickets (kind, module, title, details) values
    ('question', 'Conector ACARS', 'Duda del conector', 'No sé dónde queda la bitácora del conector.')$$,
  'Y una de la plataforma, sin aerolínea'
);
select results_eq(
  $$select author_name, author_pilot_number is not null, title, reference, status, folio ~ '^INC-\d{4}-\d{5}$'
      from support_tickets where kind = 'error'$$,
  $$values ('Piloto Incidencias'::text, true, 'No puedo reservar'::text, 'PIREP-2026-00006'::text, 'new'::text, true)$$,
  'Llega firmado, con folio, en estado nuevo y con el texto limpio'
);
select throws_ok(
  $$insert into support_tickets (airline_id, title, details) select a2, 'Otra aerolínea', 'No soy miembro de esta aerolínea.' from t$$,
  '42501', null, 'No se reporta a nombre de una aerolínea ajena'
);
select throws_ok(
  $$insert into support_tickets (user_id, title, details) values ('00000000-0000-0000-0000-00000000f303', 'Suplantar', 'A nombre de otro piloto.')$$,
  '42501', null, 'No se envía a nombre de otra persona'
);
select throws_ok(
  $$insert into support_tickets (title, details, status) values ('Ya resuelta', 'Intento marcarla resuelta.', 'resolved')$$,
  '42501', null, 'Quien envía no elige el estado'
);
select throws_ok(
  $$insert into support_tickets (title, details) values ('Corta', 'corto')$$,
  '23514', null, 'El detalle necesita al menos 10 caracteres'
);
update support_tickets set status = 'resolved' where kind = 'error';
select is((select status from support_tickets where kind = 'error'), 'new', 'El piloto no cambia el estado de su reporte');
select throws_ok($$delete from support_tickets$$, '42501', null, 'Nadie borra reportes');
select is((select count(*)::int from support_tickets), 2, 'El piloto ve sus dos reportes');

-- -----------------------------------------------------------------------------
-- Ver y atender
-- -----------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f303"}';
select is((select count(*)::int from support_tickets), 0, 'Otro piloto no ve reportes ajenos');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f302"}';
select is((select count(*)::int from support_tickets), 1, 'El jefe de operaciones ve solo el de su aerolínea');
select lives_ok(
  $$update support_tickets set status = 'in_review', response = '  Lo estamos revisando.  ' where kind = 'error'$$,
  'El jefe de operaciones lo atiende'
);
select results_eq(
  $$select status, response, handler_name, handled_at is not null from support_tickets where kind = 'error'$$,
  $$values ('in_review'::text, 'Lo estamos revisando.'::text, 'Jefe Incidencias'::text, true)$$,
  'Queda quién lo atendió y cuándo'
);
select throws_ok(
  $$update support_tickets set title = 'Otro título' where kind = 'error'$$,
  '42501', null, 'El staff no reescribe lo que mandó el piloto'
);
update support_tickets set status = 'resolved' where kind = 'question';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f304"}';
select is((select status from support_tickets where kind = 'question'), 'new', 'El staff de una aerolínea no atiende los de la plataforma');

select is((select count(*)::int from support_tickets), 2, 'El superadministrador ve todos');
select lives_ok($$update support_tickets set status = 'resolved', response = 'Está en %LOCALAPPDATA%\LamAcars\logs.' where kind = 'question'$$,
  'El superadministrador atiende los de la plataforma');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f301"}';
select results_eq(
  $$select status, handler_name from support_tickets where kind = 'question'$$,
  $$values ('resolved'::text, 'Super Incidencias'::text)$$,
  'Quien lo envió ve el estado y quién respondió'
);
reset role;

-- -----------------------------------------------------------------------------
-- Límite por hora
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f303"}';
insert into support_tickets (title, details) select 'Reporte ' || g, 'Detalle del reporte número ' || g from generate_series(1, 10) g;
select throws_ok(
  $$insert into support_tickets (title, details) values ('Uno más', 'Este ya pasa del límite por hora.')$$,
  'P0001', null, 'Máximo 10 reportes por hora por persona'
);
reset role;

select * from finish();
rollback;
