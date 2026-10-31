-- Zona horaria del perfil.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(4);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a7', 'tz@test.test', '{"display_name":"Piloto TZ"}');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000a7"}';
select lives_ok(
  $$update profiles set time_zone = 'America/Mexico_City' where id = '00000000-0000-0000-0000-0000000000a7'$$,
  'El piloto guarda su zona horaria'
);
select is((select time_zone from profiles where id = '00000000-0000-0000-0000-0000000000a7'), 'America/Mexico_City', 'La zona queda guardada');
select throws_ok(
  $$update profiles set time_zone = 'Hora de México; drop' where id = '00000000-0000-0000-0000-0000000000a7'$$,
  '23514', null, 'Solo se aceptan nombres IANA'
);
select lives_ok(
  $$update profiles set time_zone = null where id = '00000000-0000-0000-0000-0000000000a7'$$,
  'Nula vuelve a la zona del navegador'
);
reset role;

select * from finish();
rollback;
