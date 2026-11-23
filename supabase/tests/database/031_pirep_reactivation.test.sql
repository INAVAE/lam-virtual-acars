-- Reactivar un PIREP rechazado: el piloto lo solicita con un comentario; el
-- administrador de la aerolínea o el superadministrador lo reactivan (a
-- revisión o aprobado) o declinan la solicitud. El jefe de operaciones no.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(20);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000e01', 'piloto@react.test', '{"display_name":"Piloto React"}'),
  ('00000000-0000-0000-0000-000000000e02', 'jefe@react.test', '{"display_name":"Jefe React"}'),
  ('00000000-0000-0000-0000-000000000e03', 'admin@react.test', '{"display_name":"Admin React"}'),
  ('00000000-0000-0000-0000-000000000e04', 'super@react.test', '{"display_name":"Super React"}'),
  ('00000000-0000-0000-0000-000000000e05', 'otro@react.test', '{"display_name":"Otro React"}');
insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, 'react-uno', 'Reactivar Uno', 'QRA', true from organizations where slug = 'lam';
insert into organization_members (organization_id, user_id, role)
select id, '00000000-0000-0000-0000-000000000e04', 'superadmin' from organizations where slug = 'lam';
insert into airports (icao_code, iata_code, name, city, country_code, latitude, longitude, elevation_ft, airport_type) values
  ('MMMX', 'MEX', 'Aeropuerto Internacional de la Ciudad de México', 'Ciudad de México', 'MX', 19.4363, -99.0721, 7316, 'large_airport'),
  ('MMGL', 'GDL', 'Aeropuerto Internacional de Guadalajara', 'Guadalajara', 'MX', 20.5218, -103.3112, 5016, 'large_airport')
on conflict (icao_code) do nothing;

create temp table t (x uuid, b738 bigint, mmmx bigint, mmgl bigint, flight uuid, pirep uuid) on commit drop;
insert into t (x, b738, mmmx, mmgl)
select (select id from airlines where slug = 'react-uno'), (select id from aircraft_types where icao_code = 'B738'),
       (select id from airports where icao_code = 'MMMX'), (select id from airports where icao_code = 'MMGL');
grant select on t to authenticated;
insert into airline_memberships (airline_id, user_id, roles, status)
select t.x, m.uid, m.roles::airline_role[], 'active'::membership_status
  from t, (values ('00000000-0000-0000-0000-000000000e01'::uuid, '{pilot}'), ('00000000-0000-0000-0000-000000000e02'::uuid, '{ops_chief,pilot}'),
                  ('00000000-0000-0000-0000-000000000e03'::uuid, '{airline_admin}'), ('00000000-0000-0000-0000-000000000e05'::uuid, '{pilot}')) as m(uid, roles);
insert into aircraft (airline_id, aircraft_type_id, registration, base_airport_id, current_airport_id)
select x, b738, 'XA-RE1', mmmx, mmmx from t;

-- Un vuelo terminado con su PIREP rechazado.
with b as (
  insert into flight_bookings (airline_id, user_id, route_id, aircraft_id, expires_at)
  select x, '00000000-0000-0000-0000-000000000e01', null, (select id from aircraft where registration = 'XA-RE1'), now() + interval '1 day' from t
  returning id, airline_id, aircraft_id
)
insert into flights (booking_id, airline_id, user_id, aircraft_id, aircraft_type_id, aircraft_registration, airline_icao, flight_number, callsign,
                     origin_airport_id, destination_airport_id, planned_distance_nm, planned_minutes, scheduled_departure_at, operation_type, network)
select b.id, b.airline_id, '00000000-0000-0000-0000-000000000e01', b.aircraft_id, (select b738 from t), 'XA-RE1', 'QRA', '700', 'QRA700',
       (select mmmx from t), (select mmgl from t), 250, 70, now(), 'passenger', 'IVAO'
  from b;
update t set flight = (select id from flights where callsign = 'QRA700');
update flights set status = 'completed', started_at = now() - interval '1 hour', completed_at = now() where id = (select flight from t);
insert into flight_sessions (flight_id, user_id, airline_id, status, phase, ended_at)
select id, user_id, airline_id, 'completed', 'taxi_in', now() from flights where id = (select flight from t);
insert into pireps (flight_id, session_id, airline_id, user_id, aircraft_id, aircraft_type_id, aircraft_registration, callsign, flight_number,
                    origin_airport_id, destination_airport_id, arrival_airport_id, block_on_at, landing_at, block_minutes, distance_nm, score, status,
                    review_comment, reviewed_by, reviewed_at)
select f.id, s.id, f.airline_id, f.user_id, f.aircraft_id, f.aircraft_type_id, f.aircraft_registration, f.callsign, f.flight_number,
       f.origin_airport_id, f.destination_airport_id, f.destination_airport_id, now(), now(), 60, 250, 80, 'rejected',
       'Falta la ruta', '00000000-0000-0000-0000-000000000e02', now()
  from flights f join flight_sessions s on s.flight_id = f.id where f.id = (select flight from t);
update t set pirep = (select id from pireps where callsign = 'QRA700');
create temp table before_aircraft on commit drop as select total_minutes, cycles from aircraft where registration = 'XA-RE1';

set local role authenticated;

-- El piloto solicita la reactivación
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000e05"}';
select throws_ok($$select request_pirep_reactivation((select pirep from t), 'Es mío')$$, '42501', null, 'Solo el piloto del vuelo la solicita');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000e01"}';
select throws_ok($$select request_pirep_reactivation((select pirep from t), '   ')$$, '22023', null, 'La solicitud exige comentario');
select isnt((request_pirep_reactivation((select pirep from t), 'La ruta sí la cargué: adjunto el OFP')).reactivation_requested_at, null,
  'El piloto solicita la reactivación con su comentario');
select ok(exists (select 1 from pirep_comments where pirep_id = (select pirep from t) and author_role = 'pilot'
                   and body = 'Solicitud de reactivación: La ruta sí la cargué: adjunto el OFP'), 'Y queda en la conversación del PIREP');
select throws_ok($$select reactivate_pirep((select pirep from t), 'approve', null)$$, '42501', null, 'El piloto no se reactiva a sí mismo');

-- El jefe de operaciones no reactiva
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000e02"}';
select throws_ok($$select reactivate_pirep((select pirep from t), 'review', null)$$, '42501', null, 'El jefe de operaciones no reactiva');

-- El administrador declina, luego reactiva a revisión
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000e03"}';
select throws_ok($$select reactivate_pirep((select pirep from t), 'decline', null)$$, '22023', null, 'Declinar exige motivo');
select is((reactivate_pirep((select pirep from t), 'decline', 'El OFP no coincide')).status::text, 'rejected', 'El administrador declina: sigue rechazado');
select is((select reactivation_requested_at from pireps where id = (select pirep from t)), null, 'Y la solicitud se cierra');
select throws_ok($$select reactivate_pirep((select pirep from t), 'decline', 'Otra vez')$$, '55000', null, 'Sin solicitud no hay qué declinar');
select is((reactivate_pirep((select pirep from t), 'review', 'Lo reviso de nuevo')).status::text, 'pending', 'El administrador lo reactiva: vuelve a revisión');
select is((select reviewed_by from pireps where id = (select pirep from t)), null, 'Sin revisor hasta la nueva decisión');
select throws_ok($$select reactivate_pirep((select pirep from t), 'approve', null)$$, '55000', null, 'Solo se reactiva un PIREP rechazado');

-- Rechazado otra vez; el superadministrador lo reactiva y aprueba
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000e02"}';
select review_pirep((select pirep from t), 'rejected', 'Sigue sin ruta');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000e04"}';
select is((reactivate_pirep((select pirep from t), 'approve', 'Revisado con el OFP')).status::text, 'accepted', 'El superadministrador lo reactiva y aprueba');
select results_eq(
  $$select reviewed_by, review_comment from pireps where id = (select pirep from t)$$,
  $$values ('00000000-0000-0000-0000-000000000e04'::uuid, 'Revisado con el OFP'::text)$$,
  'Queda registrado quién lo aprobó y por qué');
select ok(exists (select 1 from pirep_comments where pirep_id = (select pirep from t) and author_role = 'staff'
                   and body = 'PIREP reactivado y aprobado. Revisado con el OFP'), 'La decisión queda en la conversación');
reset role;
select results_eq(
  $$select a.total_minutes - 60, a.cycles - 1 from aircraft a where registration = 'XA-RE1'$$,
  $$select total_minutes, cycles from before_aircraft$$,
  'Aprobado, se suman sus horas y su ciclo a la aeronave');

-- Archivado: no se reactiva
reset role;
update pireps set status = 'rejected' where id = (select pirep from t);
set local role authenticated;
select archive_pirep((select pirep from t), 'Duplicado');
select throws_ok($$select reactivate_pirep((select pirep from t), 'approve', null)$$, '55000', null, 'Un PIREP archivado no se reactiva (se restaura primero)');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000e01"}';
select throws_ok($$select request_pirep_reactivation((select pirep from t), 'Por favor')$$, '55000', null, 'Ni el piloto pide reactivar un PIREP archivado');
select throws_ok($$select reactivate_pirep((select pirep from t), 'jugar', null)$$, '22023', null, 'Acción no válida');
reset role;

select * from finish();
rollback;
