-- Fase 7.5: Tours (creación, aprobación, inscripción, reserva de legs, avance e insignia).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(37);

-- Personas: A crea el tour (piloto de X), B es piloto de X, C administra X, D vuela con Y.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000008a1', 'a@f7t.test', '{"display_name":"Creador A"}'),
  ('00000000-0000-0000-0000-0000000008b2', 'b@f7t.test', '{"display_name":"Piloto B"}'),
  ('00000000-0000-0000-0000-0000000008c3', 'c@f7t.test', '{"display_name":"Admin C"}'),
  ('00000000-0000-0000-0000-0000000008d4', 'd@f7t.test', '{"display_name":"Piloto D"}');
insert into airlines (organization_id, slug, name, icao_code, is_active, network)
select id, x.slug, x.name, x.icao, true, 'IVAO' from organizations, (values ('tour-x', 'Tour X', 'QTX'), ('tour-y', 'Tour Y', 'QTY')) as x(slug, name, icao)
 where organizations.slug = 'lam';
insert into airports (icao_code, iata_code, name, city, country_code, latitude, longitude, elevation_ft, airport_type) values
  ('MMMX', 'MEX', 'Aeropuerto Internacional de la Ciudad de México', 'Ciudad de México', 'MX', 19.4363, -99.0721, 7316, 'large_airport'),
  ('MMGL', 'GDL', 'Aeropuerto Internacional de Guadalajara', 'Guadalajara', 'MX', 20.5218, -103.3112, 5016, 'large_airport'),
  ('MMMY', 'MTY', 'Aeropuerto Internacional de Monterrey', 'Monterrey', 'MX', 25.7785, -100.1069, 1278, 'large_airport')
on conflict (icao_code) do nothing;

create temp table t (
  x uuid, y uuid, b738 bigint, a20n bigint, mmmx bigint, mmgl bigint, mmmy bigint,
  tour uuid, enr_d uuid, enr_b uuid, leg1 uuid, leg2 uuid, leg3 uuid, flight uuid
) on commit drop;
insert into t (x, y, b738, a20n, mmmx, mmgl, mmmy)
select (select id from airlines where slug = 'tour-x'), (select id from airlines where slug = 'tour-y'),
       (select id from aircraft_types where icao_code = 'B738'), (select id from aircraft_types where icao_code = 'A20N'),
       (select id from airports where icao_code = 'MMMX'), (select id from airports where icao_code = 'MMGL'), (select id from airports where icao_code = 'MMMY');
grant select, update on t to authenticated;

insert into airline_memberships (airline_id, user_id, roles, status)
select m.airline, m.uid, m.roles::airline_role[], 'active'::membership_status
  from t, lateral (values (t.x, '00000000-0000-0000-0000-0000000008a1'::uuid, '{pilot}'), (t.x, '00000000-0000-0000-0000-0000000008b2'::uuid, '{pilot}'),
                          (t.x, '00000000-0000-0000-0000-0000000008c3'::uuid, '{airline_admin}'), (t.y, '00000000-0000-0000-0000-0000000008d4'::uuid, '{pilot}')) as m(airline, uid, roles);
insert into aircraft (airline_id, aircraft_type_id, registration, base_airport_id, current_airport_id)
select y, r.type, r.reg, mmmx, mmmx from t, lateral (values ('XA-TY1', t.b738), ('XA-TY2', t.a20n)) as r(reg, type);
insert into pilot_type_ratings (airline_id, user_id, aircraft_type_id)
select y, '00000000-0000-0000-0000-0000000008d4'::uuid, b738 from t union all
select y, '00000000-0000-0000-0000-0000000008d4'::uuid, a20n from t;

-- Termina el vuelo de un leg como si el conector hubiera enviado el PIREP.
create function pg_temp.finish_leg(p_flight uuid, p_status pirep_status) returns void language sql as $$
  update flights set status = 'completed', started_at = now() - interval '1 hour', completed_at = now() where id = p_flight;
  update flight_bookings set status = 'completed', closed_at = now() where id = (select booking_id from flights where id = p_flight);
  update aircraft set status = 'available' where id = (select aircraft_id from flights where id = p_flight);
  insert into flight_sessions (flight_id, user_id, airline_id, status, phase, ended_at)
  select id, user_id, airline_id, 'completed', 'taxi_in', now() from flights where id = p_flight;
  insert into pireps (flight_id, session_id, airline_id, user_id, aircraft_type_id, aircraft_registration, callsign, flight_number,
                      origin_airport_id, destination_airport_id, arrival_airport_id, block_on_at, block_minutes, distance_nm, score, status, reviewed_at)
  select f.id, s.id, f.airline_id, f.user_id, f.aircraft_type_id, f.aircraft_registration, f.callsign, f.flight_number,
         f.origin_airport_id, f.destination_airport_id, f.destination_airport_id, now(), 60, f.planned_distance_nm, 95, p_status,
         case when p_status <> 'pending' then now() end
    from flights f join flight_sessions s on s.flight_id = f.id where f.id = p_flight;
$$;

-- ---------------------------------------------------------------------------
-- Creación y aprobación
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000008a1"}';
update t set tour = save_tour(null, jsonb_build_object(
  'airline_id', (select x from t), 'code', 'tmx-01', 'name', 'Joyas de México', 'color', '#a855f7',
  'aircraft_type_ids', jsonb_build_array((select b738 from t)), 'ordered_legs', true,
  'allow_unreviewed_progress', true, 'max_unreviewed_legs', 2, 'auto_approve_same_airline', false),
  jsonb_build_array(
    jsonb_build_object('origin_airport_id', (select mmmx from t), 'destination_airport_id', (select mmgl from t)),
    jsonb_build_object('origin_airport_id', (select mmgl from t), 'destination_airport_id', (select mmmy from t), 'notes', 'Ruta escénica'),
    jsonb_build_object('origin_airport_id', (select mmmy from t), 'destination_airport_id', (select mmmx from t))));
select results_eq(
  $$select code, status::text, (select count(*)::int from tour_legs l where l.tour_id = tours.id) from tours where id = (select tour from t)$$,
  $$values ('TMX-01'::text, 'draft'::text, 3)$$,
  'Un piloto crea un tour en borrador con sus legs'
);
select ok((select distance_nm between 240 and 300 from tour_legs where tour_id = (select tour from t) and leg_number = 1), 'La distancia de cada leg se calcula');
update t set leg1 = (select id from tour_legs where tour_id = t.tour and leg_number = 1),
             leg2 = (select id from tour_legs where tour_id = t.tour and leg_number = 2),
             leg3 = (select id from tour_legs where tour_id = t.tour and leg_number = 3);
select throws_ok(
  format($$select save_tour(null, '{"airline_id":"%s","code":"TMX-01","name":"Otro"}'::jsonb)$$, (select x from t)), '23505', null,
  'El código del tour es único'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000008d4"}';
select is(jsonb_array_length(get_tours()), 0, 'Un borrador no lo ve nadie más');
select throws_ok(
  format($$select save_tour(null, '{"airline_id":"%s","code":"OTRO-1","name":"Ajeno"}'::jsonb)$$, (select x from t)), '42501', null,
  'No se crean tours en una aerolínea ajena'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000008a1"}';
select is(submit_tour((select tour from t))::text, 'submitted', 'El tour de un piloto espera la aprobación del administrador');
select throws_ok(format('select review_tour(%L, true)', (select tour from t)), '42501', null, 'El piloto no aprueba su propio tour');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000008c3"}';
select is((get_tours() -> 0 ->> 'can_approve')::boolean, true, 'El administrador ve que puede aprobarlo');
select throws_ok(format('select review_tour(%L, false)', (select tour from t)), '22023', null, 'Rechazar pide el motivo');
select lives_ok(format('select review_tour(%L, true)', (select tour from t)), 'El administrador de la aerolínea lo publica');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000008a1"}';
select throws_ok(
  format($$select save_tour(%L, '{"code":"TMX-01","name":"Joyas","aircraft_type_ids":[%s]}'::jsonb, '[]'::jsonb)$$, (select tour from t), (select b738 from t)),
  'P0001', null, 'Publicado, sus legs ya no cambian'
);

-- ---------------------------------------------------------------------------
-- Inscripciones
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000008d4"}';
select is(jsonb_array_length(get_tours()), 1, 'Publicado, lo ve cualquier piloto');
select throws_ok(format('select enroll_tour(%L, %L)', (select tour from t), (select x from t)), '42501', null,
  'Solo se inscribe con una aerolínea de la que es miembro');
update t set enr_d = (enroll_tour(tour, y) ->> 'enrollment_id')::uuid;
select is((select status::text from tour_enrollments where id = (select enr_d from t)), 'pending', 'Un piloto de otra aerolínea queda pendiente');
select throws_ok(format('select enroll_tour(%L, %L)', (select tour from t), (select y from t)), 'P0001', 'Ya estás inscrito en este tour',
  'No se inscribe dos veces');
select throws_ok(
  format('select book_tour_leg(%L, %L, %L, %L, %L)', (select enr_d from t), (select leg1 from t), (select id from aircraft where registration = 'XA-TY1'), 'QTY401', '401'),
  'P0001', 'Tu inscripción todavía no está aprobada', 'Sin aprobación no se reserva'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000008b2"}';
select is((select count(*)::int from tour_enrollments where id = (select enr_d from t)), 0, 'Otro piloto no ve inscripciones ajenas');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000008a1"}';
select is((get_tour((select tour from t)) ->> 'pending_enrollments')::int, 1, 'El creador ve la inscripción pendiente');
select lives_ok(format('select review_tour_enrollment(%L, true)', (select enr_d from t)), 'El creador aprueba la inscripción');
select lives_ok(
  format($$select save_tour(%L, '{"code":"TMX-01","name":"Joyas de México","aircraft_type_ids":[%s],"auto_approve_same_airline":true}'::jsonb)$$,
         (select tour from t), (select b738 from t)),
  'Publicado, sus opciones de inscripción sí cambian'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000008b2"}';
update t set enr_b = (enroll_tour(tour, x) ->> 'enrollment_id')::uuid;
select is((select status::text || '/' || auto_approved from tour_enrollments where id = (select enr_b from t)), 'approved/true',
  'Un piloto de la misma aerolínea se aprueba solo si el tour lo permite');

-- ---------------------------------------------------------------------------
-- Reservas y avance
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000008d4"}';
select throws_ok(
  format('select book_tour_leg(%L, %L, %L, %L, %L)', (select enr_d from t), (select leg2 from t), (select id from aircraft where registration = 'XA-TY1'), 'QTY401', '401'),
  'P0001', 'Este tour se vuela en orden: primero termina el leg anterior', 'En un tour ordenado no se salta un leg'
);
select throws_ok(
  format('select book_tour_leg(%L, %L, %L, %L, %L)', (select enr_d from t), (select leg1 from t), (select id from aircraft where registration = 'XA-TY2'), 'QTY401', '401'),
  'P0001', 'El tipo de aeronave no está permitido en esta ruta', 'Solo con los tipos de aeronave del tour'
);
update t set flight = (book_tour_leg(enr_d, leg1, (select id from aircraft where registration = 'XA-TY1'), 'qty 401', '401') ->> 'flight_id')::uuid;
select results_eq(
  $$select airline_id = (select y from t), tour_leg_id = (select leg1 from t), callsign, origin_airport_id = (select mmmx from t), route_id is null
      from flights where id = (select flight from t)$$,
  $$values (true, true, 'QTY401'::text, true, true)$$,
  'El leg se reserva con la flota de su aerolínea y el callsign que eligió'
);
select throws_ok(
  format('select book_tour_leg(%L, %L, %L, %L, %L)', (select enr_d from t), (select leg2 from t), (select id from aircraft where registration = 'XA-TY2'), 'QTY402', '402'),
  'P0001', 'Ya tienes un vuelo de este tour reservado o en curso', 'Un vuelo del tour a la vez'
);
select throws_ok(format('select withdraw_tour_enrollment(%L)', (select enr_d from t)), 'P0001', null, 'No se retira con un vuelo del tour reservado');

-- El vuelo aparece en el mapa con su tour y leg.
reset role;
insert into flight_sessions (flight_id, user_id, airline_id, status, phase)
select flight, '00000000-0000-0000-0000-0000000008d4', y, 'active', 'cruise' from t;
set local role authenticated;
select results_eq(
  $$select x -> 'tour' ->> 'code', (x -> 'tour' ->> 'leg')::int, (x -> 'tour' ->> 'legs')::int from jsonb_array_elements(get_live_flights(null)) x$$,
  $$values ('TMX-01'::text, 1, 3)$$,
  'En el mapa, el vuelo trae el tour y el número de leg'
);

-- Leg 1 en revisión: cuenta como volado y deja seguir.
reset role;
update flight_sessions set status = 'completed', ended_at = now() where flight_id = (select flight from t);
delete from flight_sessions where flight_id = (select flight from t);
select pg_temp.finish_leg((select flight from t), 'pending');
set local role authenticated;
select is((get_tour((select tour from t)) -> 'my_legs' -> 0 ->> 'state'), 'in_review', 'Un leg con PIREP en revisión cuenta como volado');
update t set flight = (book_tour_leg(enr_d, leg2, (select id from aircraft where registration = 'XA-TY1'), 'QTY402', '402') ->> 'flight_id')::uuid;
select ok((select flight is not null from t), 'Con un leg en revisión puede volar el siguiente');
reset role;
select pg_temp.finish_leg((select flight from t), 'pending');
set local role authenticated;
select throws_ok(
  format('select book_tour_leg(%L, %L, %L, %L, %L)', (select enr_d from t), (select leg3 from t), (select id from aircraft where registration = 'XA-TY1'), 'QTY403', '403'),
  'P0001', null, 'Con el máximo de legs en revisión espera la revisión'
);

-- Se rechaza el PIREP del leg 1: se repite y bloquea el orden.
reset role;
update pireps set status = 'rejected', reviewed_at = now()
 where flight_id = (select id from flights where tour_leg_id = (select leg1 from t) and tour_enrollment_id = (select enr_d from t));
set local role authenticated;
select is((get_tour((select tour from t)) -> 'my_legs' -> 0 ->> 'state'), 'repeat', 'Un leg con PIREP rechazado se debe repetir');
select throws_ok(
  format('select book_tour_leg(%L, %L, %L, %L, %L)', (select enr_d from t), (select leg3 from t), (select id from aircraft where registration = 'XA-TY1'), 'QTY403', '403'),
  'P0001', 'Este tour se vuela en orden: primero termina el leg anterior', 'Mientras el leg 1 no se repita, el 3 espera'
);
update t set flight = (book_tour_leg(enr_d, leg1, (select id from aircraft where registration = 'XA-TY1'), 'QTY401', '401') ->> 'flight_id')::uuid;
reset role;
select pg_temp.finish_leg((select flight from t), 'accepted');
update pireps set status = 'accepted', reviewed_at = now()
 where flight_id = (select id from flights where tour_leg_id = (select leg2 from t) and tour_enrollment_id = (select enr_d from t));
set local role authenticated;
update t set flight = (book_tour_leg(enr_d, leg3, (select id from aircraft where registration = 'XA-TY1'), 'QTY403', '403') ->> 'flight_id')::uuid;
reset role;
select pg_temp.finish_leg((select flight from t), 'accepted');
set local role authenticated;

-- ---------------------------------------------------------------------------
-- Insignia
-- ---------------------------------------------------------------------------
select is((select status::text from tour_enrollments where id = (select enr_d from t)), 'completed', 'Con todos los legs aceptados el tour queda terminado');
select results_eq(
  $$select x ->> 'code', (x ->> 'legs')::int from jsonb_array_elements(get_pilot_badges()) x$$,
  $$values ('TMX-01'::text, 3)$$,
  'El piloto gana la insignia del tour'
);
select is((get_tour((select tour from t)) ->> 'finishers')::int, 1, 'El tour cuenta a quien lo terminó');

reset role;
update pireps set status = 'pending', reviewed_at = null
 where flight_id = (select id from flights where tour_leg_id = (select leg3 from t) and tour_enrollment_id = (select enr_d from t) and status = 'completed');
set local role authenticated;
select is(jsonb_array_length(get_pilot_badges()), 0, 'Si un PIREP deja de estar aceptado, la insignia se retira');
select is((select status::text from tour_enrollments where id = (select enr_d from t)), 'approved', 'Y la inscripción vuelve a estar en curso');

select * from finish();
rollback;
