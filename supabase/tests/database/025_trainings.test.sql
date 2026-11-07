-- Training: programar, inscribirse, aprobar, cupo, resultado y reconocimiento.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(22);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000fd11', 'admin@trn.test', '{"display_name":"Admin Training"}'),
  ('00000000-0000-0000-0000-00000000fd12', 'instructor@trn.test', '{"display_name":"Instructor"}'),
  ('00000000-0000-0000-0000-00000000fd13', 'p1@trn.test', '{"display_name":"Piloto Uno"}'),
  ('00000000-0000-0000-0000-00000000fd14', 'p2@trn.test', '{"display_name":"Piloto Dos"}'),
  ('00000000-0000-0000-0000-00000000fd15', 'sin@trn.test', '{"display_name":"Sin Aerolinea"}');
insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, x.slug, x.name, x.icao, true from organizations, (values ('trn-uno', 'Training Uno', 'QTA'), ('trn-dos', 'Training Dos', 'QTB')) x(slug, name, icao)
 where organizations.slug = 'lam';
create temp table t on commit drop as
select (select id from airlines where slug = 'trn-uno') a1, (select id from airlines where slug = 'trn-dos') a2;
grant select on t to authenticated;
insert into airline_memberships (airline_id, user_id, roles, status)
select a1, u::uuid, r::airline_role[], 'active'::membership_status from t,
  (values ('00000000-0000-0000-0000-00000000fd11', '{pilot,airline_admin}'), ('00000000-0000-0000-0000-00000000fd12', '{pilot}'),
          ('00000000-0000-0000-0000-00000000fd13', '{pilot}')) m(u, r)
union all select a2, '00000000-0000-0000-0000-00000000fd14', '{pilot}', 'active' from t;

create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;

set local role authenticated;

-- Un piloto no programa
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fd13"}';
select throws_ok($$select save_training(null, jsonb_build_object('title', 'Mi curso', 'category', 'theory', 'starts_at', now() + interval '2 days',
  'ends_at', now() + interval '2 days 2 hours', 'instructor_name', 'Alguien'))$$, '42501', null, 'Un piloto no programa entrenamientos');

-- El administrador programa
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fd11"}';
select lives_ok($$insert into ids select 'trn', save_training(null, jsonb_build_object(
  'title', 'Procedimientos SOP del A320', 'category', 'aircraft', 'level', 'intermediate', 'description', 'Flujo de cabina',
  'starts_at', now() + interval '2 days', 'ends_at', now() + interval '2 days 2 hours', 'capacity', 1,
  'instructor_id', '00000000-0000-0000-0000-00000000fd12', 'airline_id', (select a1 from t),
  'discord_url', 'https://discord.gg/lamvirtual', 'discord_channel', '#training-a320'))$$, 'Un administrador programa un entrenamiento');
select matches((select get_training((select v from ids where k = 'trn')) ->> 'folio'), '^TRN-[0-9]{4}-[0-9]{4}$', 'Recibe folio TRN');
select throws_ok($$select save_training(null, jsonb_build_object('title', 'Al revés', 'category', 'theory', 'starts_at', now() + interval '2 days',
  'ends_at', now() + interval '1 day', 'instructor_name', 'Alguien'))$$, '22023', null, 'El fin debe ser posterior al inicio');
select throws_ok($$select save_training(null, jsonb_build_object('title', 'Sin instructor', 'category', 'theory', 'starts_at', now() + interval '2 days',
  'ends_at', now() + interval '2 days 1 hour'))$$, '22023', null, 'Necesita instructor');
select throws_ok($$select save_training(null, jsonb_build_object('title', 'Discord falso', 'category', 'theory', 'starts_at', now() + interval '2 days',
  'ends_at', now() + interval '2 days 1 hour', 'instructor_name', 'Alguien', 'discord_url', 'https://evil.example/x'))$$, '23514', null,
  'El enlace de Discord se valida');
select throws_ok($$select * from trainings$$, '42501', null, 'La tabla no se lee directo');

-- Inscripción
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fd15"}';
select throws_ok($$select register_training((select v from ids where k = 'trn'))$$, '42501', null, 'Sin aerolínea no se inscribe');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fd12"}';
select throws_ok($$select register_training((select v from ids where k = 'trn'))$$, 'P0001', null, 'El instructor no se inscribe a su propio entrenamiento');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fd13"}';
select lives_ok($$insert into ids select 'r1', register_training((select v from ids where k = 'trn'), 'Vuelo el A320 de Fenix')$$, 'Un piloto se inscribe');
select is((select get_trainings() -> 'trainings' -> 0 -> 'my_registration' ->> 'status'), 'pending', 'Ve su inscripción pendiente');
select throws_ok($$select register_training((select v from ids where k = 'trn'))$$, 'P0001', null, 'No se inscribe dos veces');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fd14"}';
select lives_ok($$insert into ids select 'r2', register_training((select v from ids where k = 'trn'))$$, 'Un piloto de otra aerolínea también se inscribe');
select throws_ok($$select review_training_registration((select v from ids where k = 'r1'), true)$$, '42501', null, 'Un participante no aprueba');

-- Revisión por el instructor, con cupo de 1
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fd12"}';
select lives_ok($$select review_training_registration((select v from ids where k = 'r1'), true, 'Bienvenido')$$, 'El instructor aprueba');
select throws_ok($$select review_training_registration((select v from ids where k = 'r2'), true)$$, 'P0001', null, 'Con el cupo lleno no aprueba más');
select is((select jsonb_array_length(get_training((select v from ids where k = 'trn')) -> 'registrations')), 2, 'El instructor ve todas las inscripciones');
select throws_ok($$select set_training_result((select v from ids where k = 'r1'), 'completed')$$, 'P0001', null, 'La asistencia espera a que empiece');

-- Ya ocurrió: resultado y reconocimiento
reset role;
update trainings set starts_at = now() - interval '3 hours', ends_at = now() - interval '1 hour' where id = (select v from ids where k = 'trn');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fd11"}';
select lives_ok($$select set_training_result((select v from ids where k = 'r1'), 'completed')$$, 'El creador marca «Completó»');
select is((select jsonb_array_length(get_pilot_trainings((select pilot_number from profiles where id = '00000000-0000-0000-0000-00000000fd13')))), 1,
  'El entrenamiento completado aparece en el perfil');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fd14"}';
select is((select jsonb_array_length(get_training((select v from ids where k = 'trn')) -> 'registrations')), 2,
  'Otro piloto ve a los aprobados y su propia inscripción');
select throws_ok($$select withdraw_training_registration((select v from ids where k = 'r2'))$$, 'P0001', null, 'Terminado, ya no se retira');
reset role;

select * from finish();
rollback;
