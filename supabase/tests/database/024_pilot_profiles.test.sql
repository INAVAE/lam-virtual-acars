-- Perfil completo del piloto: quién lo ve y qué ve cada quien.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(12);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000fc01', 'piloto@perfil.test', '{"display_name":"Piloto Perfil"}'),
  ('00000000-0000-0000-0000-00000000fc02', 'companero@perfil.test', '{"display_name":"Companero"}'),
  ('00000000-0000-0000-0000-00000000fc03', 'jefe@perfil.test', '{"display_name":"Jefe Perfil"}'),
  ('00000000-0000-0000-0000-00000000fc04', 'ajeno@perfil.test', '{"display_name":"Ajeno"}');
insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, x.slug, x.name, x.icao, true from organizations, (values ('perfil-uno', 'Perfil Uno', 'QPA'), ('perfil-dos', 'Perfil Dos', 'QPB')) x(slug, name, icao)
 where organizations.slug = 'lam';
create temp table t on commit drop as
select (select id from airlines where slug = 'perfil-uno') a1, (select id from airlines where slug = 'perfil-dos') a2,
       (select pilot_number from profiles where id = '00000000-0000-0000-0000-00000000fc01') num;
grant select on t to authenticated;
insert into airline_memberships (airline_id, user_id, roles, status)
select a1, u::uuid, r::airline_role[], 'active'::membership_status from t,
  (values ('00000000-0000-0000-0000-00000000fc01', '{pilot}'), ('00000000-0000-0000-0000-00000000fc02', '{pilot}'),
          ('00000000-0000-0000-0000-00000000fc03', '{pilot,ops_chief}')) m(u, r)
union all select a2, '00000000-0000-0000-0000-00000000fc04', '{pilot}', 'active' from t;

-- Datos propios
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc01"}';
select lives_ok($$update profiles set ivao_vid = '654321', discord_username = 'piloto.lam', bio = 'Vuelo A320' where id = '00000000-0000-0000-0000-00000000fc01'$$,
  'Cada quien edita su VID, Discord y presentación');
select throws_ok($$update profiles set discord_username = 'Con Espacios' where id = '00000000-0000-0000-0000-00000000fc01'$$, '23514', null,
  'El usuario de Discord se valida');
select throws_ok($$update profiles set avatar_url = 'https://otro.sitio/foto.png' where id = '00000000-0000-0000-0000-00000000fc01'$$, '23514', null,
  'La foto solo puede venir del bucket avatars');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-00000000fc01/foto.webp')$$,
  'Sube su foto a su carpeta');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('avatars', '00000000-0000-0000-0000-00000000fc02/foto.webp')$$, '42501', null,
  'No a la carpeta de otro');
select is((select get_pilot_profile(num) -> 'profile' ->> 'email' from t), 'piloto@perfil.test', 'Ve su propio correo');

-- Compañero de aerolínea
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc02"}';
select is((select get_pilot_profile(num) -> 'profile' ->> 'display_name' from t), 'Piloto Perfil', 'Un compañero de aerolínea ve el perfil');
select is((select get_pilot_profile(num) -> 'profile' ->> 'email' from t), null, 'Pero no el correo');
select is((select get_pilot_profile(num) -> 'profile' ->> 'ivao_vid' from t), '654321', 'Sí el VID de IVAO');

-- Staff
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc03"}';
select is((select get_pilot_profile(num) -> 'profile' ->> 'email' from t), 'piloto@perfil.test', 'Su jefe de operaciones ve el correo');
select is((select (get_pilot_profile(num) -> 'viewer' ->> 'staff')::boolean from t), true, 'Y queda marcado como staff');

-- Ajeno
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000fc04"}';
select throws_ok($$select get_pilot_profile(num) from t$$, '42501', null, 'Un piloto de otra aerolínea no lo ve');
reset role;

select * from finish();
rollback;
