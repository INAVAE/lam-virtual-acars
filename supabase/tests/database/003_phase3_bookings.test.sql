-- Pruebas de la Fase 3: habilitaciones, reservas, vencimiento y SimBrief.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(46);

-- -----------------------------------------------------------------------------
-- Escenario
-- -----------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'super@p3.test', '{"display_name":"Super"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'admin-a@p3.test', '{"display_name":"Admin A"}'),
  ('00000000-0000-0000-0000-0000000000c3', 'jefe-a@p3.test', '{"display_name":"Jefe A"}'),
  ('00000000-0000-0000-0000-0000000000c4', 'piloto-a@p3.test', '{"display_name":"Piloto A"}'),
  ('00000000-0000-0000-0000-0000000000c5', 'piloto-a2@p3.test', '{"display_name":"Piloto A2"}'),
  ('00000000-0000-0000-0000-0000000000c6', 'piloto-b@p3.test', '{"display_name":"Piloto B"}'),
  ('00000000-0000-0000-0000-0000000000c7', 'piloto-a3@p3.test', '{"display_name":"Piloto A3"}');
select private.grant_superadmin('super@p3.test');

insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, 'p3-aerolinea-a', 'Prueba A', 'QQC', true from organizations where slug = 'lam';
insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, 'p3-aerolinea-b', 'Prueba B', 'QQD', true from organizations where slug = 'lam';

insert into airports (icao_code, iata_code, name, city, country_code, latitude, longitude, elevation_ft, airport_type) values
  ('MMMX', 'MEX', 'Aeropuerto Internacional de la Ciudad de México', 'Ciudad de México', 'MX', 19.4363, -99.0721, 7316, 'large_airport'),
  ('MMGL', 'GDL', 'Aeropuerto Internacional de Guadalajara', 'Guadalajara', 'MX', 20.5218, -103.3112, 5016, 'large_airport'),
  ('MMMY', 'MTY', 'Aeropuerto Internacional de Monterrey', 'Monterrey', 'MX', 25.7785, -100.1069, 1278, 'large_airport')
on conflict (icao_code) do nothing;

create temp table t_ids on commit drop as
select
  (select id from airlines where slug = 'p3-aerolinea-a') as airline_a,
  (select id from airlines where slug = 'p3-aerolinea-b') as airline_b,
  (select id from aircraft_types where icao_code = 'A20N') as a20n,
  (select id from aircraft_types where icao_code = 'B738') as b738,
  (select id from airports where icao_code = 'MMMX') as mmmx,
  (select id from airports where icao_code = 'MMGL') as mmgl,
  (select id from airports where icao_code = 'MMMY') as mmmy;

insert into airline_memberships (airline_id, user_id, roles, status)
select airline_a, '00000000-0000-0000-0000-0000000000c2'::uuid, '{airline_admin,pilot}'::airline_role[], 'active'::membership_status from t_ids union all
select airline_a, '00000000-0000-0000-0000-0000000000c3', '{ops_chief,pilot}', 'active' from t_ids union all
select airline_a, '00000000-0000-0000-0000-0000000000c4', '{pilot}', 'active' from t_ids union all
select airline_a, '00000000-0000-0000-0000-0000000000c5', '{pilot}', 'active' from t_ids union all
select airline_a, '00000000-0000-0000-0000-0000000000c7', '{pilot}', 'active' from t_ids union all
select airline_b, '00000000-0000-0000-0000-0000000000c6', '{pilot}', 'active' from t_ids;

insert into aircraft (airline_id, aircraft_type_id, registration, operation_type, current_airport_id)
select airline_a, a20n, 'XA-QC1', 'passenger', mmmx from t_ids union all
select airline_a, b738, 'XA-QC2', 'passenger', mmgl from t_ids union all
select airline_a, b738, 'XA-QC3', 'cargo', mmmx from t_ids union all
select airline_b, a20n, 'XA-QD1', 'passenger', mmmx from t_ids;

insert into routes (airline_id, flight_number, origin_airport_id, destination_airport_id, departure_time_utc)
select airline_a, '100', mmmx, mmgl, '12:00'::time from t_ids union all
select airline_a, '200', mmmx, mmmy, null from t_ids;

alter table t_ids add column ac1 uuid, add column ac2 uuid, add column ac3 uuid, add column acb uuid,
  add column r100 uuid, add column r200 uuid;
update t_ids set
  ac1 = (select id from aircraft where registration = 'XA-QC1'),
  ac2 = (select id from aircraft where registration = 'XA-QC2'),
  ac3 = (select id from aircraft where registration = 'XA-QC3'),
  acb = (select id from aircraft where registration = 'XA-QD1'),
  r100 = (select id from routes where flight_number = '100' and airline_id = t_ids.airline_a),
  r200 = (select id from routes where flight_number = '200' and airline_id = t_ids.airline_a);
grant select on t_ids to authenticated, anon;

-- La ruta 100 solo admite A20N; la 200 no limita tipos.
insert into route_aircraft_types (route_id, aircraft_type_id) select r100, a20n from t_ids;

-- -----------------------------------------------------------------------------
-- Habilitaciones
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c4"}';
select throws_ok(
  $$insert into pilot_type_ratings (airline_id, user_id, aircraft_type_id)
    select airline_a, '00000000-0000-0000-0000-0000000000c4', a20n from t_ids$$,
  '42501', null, 'Un piloto no se otorga habilitaciones'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3"}';
select lives_ok(
  $$insert into pilot_type_ratings (airline_id, user_id, aircraft_type_id)
    select airline_a, '00000000-0000-0000-0000-0000000000c4'::uuid, a20n from t_ids union all
    select airline_a, '00000000-0000-0000-0000-0000000000c4', b738 from t_ids$$,
  'El jefe de operaciones habilita a un piloto de su aerolínea'
);
select throws_ok(
  $$insert into pilot_type_ratings (airline_id, user_id, aircraft_type_id)
    select airline_a, '00000000-0000-0000-0000-0000000000c3', a20n from t_ids$$,
  '42501', null, 'El jefe de operaciones no se habilita a sí mismo'
);
select throws_ok(
  $$insert into pilot_type_ratings (airline_id, user_id, aircraft_type_id)
    select airline_a, '00000000-0000-0000-0000-0000000000c6', a20n from t_ids$$,
  '23514', null, 'No se habilita a quien no es miembro activo de la aerolínea'
);
select throws_ok(
  $$insert into pilot_type_ratings (airline_id, user_id, aircraft_type_id)
    select airline_b, '00000000-0000-0000-0000-0000000000c6', a20n from t_ids$$,
  '42501', null, 'El staff de una aerolínea no habilita pilotos de otra'
);
reset role;

select is(
  (select granted_by from pilot_type_ratings
   where user_id = '00000000-0000-0000-0000-0000000000c4' and aircraft_type_id = (select a20n from t_ids)),
  '00000000-0000-0000-0000-0000000000c3'::uuid,
  'La habilitación registra quién la otorgó'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c5"}';
select is((select count(*) from pilot_type_ratings)::int, 0, 'Un piloto no ve las habilitaciones de otros');
reset role;

-- -----------------------------------------------------------------------------
-- Opciones de reserva
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c4"}';
select throws_ok(
  $$insert into flight_bookings (airline_id, user_id, aircraft_id, expires_at)
    select airline_a, '00000000-0000-0000-0000-0000000000c4', ac1, now() + interval '1 day' from t_ids$$,
  '42501', null, 'Nadie inserta reservas directamente'
);
select is(
  (select block_reason from route_aircraft_options((select r100 from t_ids)) where registration = 'XA-QC1'),
  null, 'Aeronave compatible: sin motivo de bloqueo'
);
select is(
  (select block_reason from route_aircraft_options((select r100 from t_ids)) where registration = 'XA-QC2'),
  'type_not_allowed', 'Tipo no permitido en la ruta'
);
select is(
  (select block_reason from route_aircraft_options((select r200 from t_ids)) where registration = 'XA-QC3'),
  'operation_mismatch', 'Aeronave de carga en ruta de pasajeros'
);
select is(
  (select count(*) from route_aircraft_options((select r100 from t_ids)) where registration = 'XA-QD1')::int,
  0, 'Las opciones no incluyen aeronaves de otra aerolínea'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c5"}';
select is(
  (select block_reason from route_aircraft_options((select r100 from t_ids)) where registration = 'XA-QC1'),
  'no_rating', 'Sin habilitación del tipo'
);
select throws_ok(
  $$select book_flight((select r100 from t_ids), (select ac1 from t_ids), 'QQC100')$$,
  'P0001', 'No tienes habilitación para este tipo de aeronave', 'La base rechaza reservar sin habilitación'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c6"}';
select throws_ok(
  $$select book_flight((select r100 from t_ids), (select ac1 from t_ids), 'QQD100')$$,
  '42501', null, 'Un piloto de otra aerolínea no reserva'
);
select throws_ok(
  $$select book_flight((select r100 from t_ids), (select acb from t_ids), 'QQD100')$$,
  '42501', null, 'No se reserva una ruta ajena con una aeronave propia'
);
reset role;

-- -----------------------------------------------------------------------------
-- Reservar
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c4"}';
select throws_ok(
  $$select book_flight((select r100 from t_ids), (select ac1 from t_ids), 'MX')$$,
  '22023', null, 'Callsign demasiado corto'
);
select lives_ok(
  $$select book_flight((select r100 from t_ids), (select ac1 from t_ids), ' mxl 100 ')$$,
  'Un piloto habilitado reserva una combinación válida'
);
select is((select callsign from flights), 'MXL100', 'El callsign del piloto se guarda normalizado');
select is(
  (select row(airline_icao, flight_number, planned_distance_nm, status::text)::text from flights),
  '(QQC,100,248,scheduled)', 'El vuelo copia los datos de la ruta'
);
select ok(
  (select expires_at between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute' from flight_bookings),
  'La reserva vence según booking_expiry_hours (24 h)'
);
select is((select status::text from aircraft where registration = 'XA-QC1'), 'assigned', 'La aeronave queda asignada');
select throws_ok(
  $$select book_flight((select r200 from t_ids), (select ac2 from t_ids), 'MXL200')$$,
  'P0001', null, 'No se supera el máximo de reservas activas'
);
reset role;

alter table t_ids add column bk uuid;
update t_ids set bk = (select id from flight_bookings where status = 'active');

-- Otra persona no puede tomar la misma aeronave.
insert into pilot_type_ratings (airline_id, user_id, aircraft_type_id)
select airline_a, '00000000-0000-0000-0000-0000000000c5', a20n from t_ids;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c5"}';
select throws_ok(
  $$select book_flight((select r100 from t_ids), (select ac1 from t_ids), 'QQC101')$$,
  'P0001', 'La aeronave no está disponible', 'Una aeronave asignada no se reserva dos veces'
);
select is((select count(*) from flight_bookings)::int, 0, 'Un piloto no ve las reservas de otros');
select throws_ok(
  $$select cancel_booking((select bk from t_ids))$$,
  'P0002', null, 'Un piloto no cancela la reserva de otro'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c2"}';
select throws_ok(
  $$update aircraft set status = 'maintenance' where registration = 'XA-QC1'$$,
  '55006', null, 'El administrador no cambia el estado de una aeronave reservada'
);
select throws_ok(
  $$delete from aircraft where registration = 'XA-QC1'$$,
  '55006', null, 'No se borra una aeronave reservada'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c3"}';
select is((select count(*) from flight_bookings)::int, 1, 'El jefe de operaciones ve las reservas de su aerolínea');
reset role;

-- -----------------------------------------------------------------------------
-- Cancelar y vencer
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c4"}';
select lives_ok($$select cancel_booking((select id from flight_bookings))$$, 'El piloto cancela su reserva');
select throws_ok(
  $$select cancel_booking((select id from flight_bookings))$$,
  'P0001', 'La reserva ya no está activa', 'Una reserva cancelada no se cancela dos veces'
);
reset role;

select is(
  (select row(b.status::text, f.status::text, a.status::text)::text
   from flight_bookings b join flights f on f.booking_id = b.id join aircraft a on a.id = b.aircraft_id),
  '(cancelled,cancelled,available)', 'Cancelar cierra la reserva, cancela el vuelo y libera la aeronave'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c4"}';
select lives_ok(
  $$select book_flight((select r200 from t_ids), (select ac1 from t_ids), 'MXL200')$$,
  'Tras cancelar puede reservar de nuevo'
);
reset role;

update flight_bookings set expires_at = now() - interval '1 minute' where status = 'active';
select is(private.expire_bookings(), 1, 'Vence la reserva atrasada');
select is((select status::text from aircraft where registration = 'XA-QC1'), 'available', 'El vencimiento libera la aeronave');

-- -----------------------------------------------------------------------------
-- Políticas de la aerolínea
-- -----------------------------------------------------------------------------
update airline_settings set require_aircraft_at_origin = true where airline_id = (select airline_a from t_ids);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c4"}';
select is(
  (select block_reason from route_aircraft_options((select r200 from t_ids)) where registration = 'XA-QC2'),
  'not_at_origin', 'Con la política activa, la aeronave debe estar en el origen'
);
reset role;

update airline_settings set require_aircraft_at_origin = false, require_type_rating = false
where airline_id = (select airline_a from t_ids);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c7"}';
select is(
  (select block_reason from route_aircraft_options((select r200 from t_ids)) where registration = 'XA-QC2'),
  null, 'Sin exigir habilitación, cualquier piloto puede reservar el tipo'
);
reset role;
update airline_settings set require_type_rating = true where airline_id = (select airline_a from t_ids);

select is(
  private.next_departure('12:00', 127::smallint, '2026-10-24 13:00+00'),
  '2026-10-25 12:00+00'::timestamptz, 'Próxima salida diaria'
);
select is(
  private.next_departure('12:00', 1::smallint, '2026-10-24 13:00+00'),
  '2026-10-26 12:00+00'::timestamptz, 'Próxima salida solo los lunes'
);

-- -----------------------------------------------------------------------------
-- SimBrief
-- -----------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c4"}';
select lives_ok(
  $$select book_flight((select r100 from t_ids), (select ac1 from t_ids), 'MXL100')$$,
  'Nueva reserva para el OFP'
);
reset role;
alter table t_ids add column fl uuid;
update t_ids set fl = (select id from flights where status = 'scheduled');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c4"}';
select lives_ok(
  $$insert into simbrief_ofps (flight_id, request_id, origin_icao, destination_icao, aircraft_icao, registration, atc_callsign, generated_at)
    select fl, '123456', 'mmmx', 'MMMY', 'A20N', 'XAQC1', 'MXL100', now() from t_ids$$,
  'El piloto importa el OFP de su vuelo'
);
select is(
  (select jsonb_path_query_array(mismatches, '$[*].field')::text from simbrief_ofps),
  '["destination"]', 'Se avisa el destino distinto; la matrícula sin guion coincide'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c5"}';
select throws_ok(
  $$insert into simbrief_ofps (flight_id, request_id, origin_icao, destination_icao)
    select fl, '999', 'MMMX', 'MMGL' from t_ids$$,
  '42501', null, 'Nadie importa un OFP en un vuelo ajeno'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c4"}';
select lives_ok(
  $$insert into simbrief_ofps (flight_id, request_id, origin_icao, destination_icao, aircraft_icao, registration, atc_callsign)
    select fl, '123457', 'MMMX', 'MMGL', 'A20N', 'XA-QC1', 'MXL100' from t_ids
    on conflict (flight_id) do update set request_id = excluded.request_id, destination_icao = excluded.destination_icao$$,
  'Reimportar reemplaza el OFP'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c4"}';
select is((select mismatches::text from simbrief_ofps), '[]', 'Sin diferencias tras corregir el destino');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000c4"}';
select is(
  (get_dashboard_summary((select airline_a from t_ids)) ->> 'my_bookings_active')::int,
  1, 'El dashboard cuenta las reservas activas del piloto'
);
reset role;

select * from finish();
rollback;
