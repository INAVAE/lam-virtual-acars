-- El superadministrador y el administrador de la aerolínea modifican un tour por
-- completo aunque ya esté publicado, cerrado o tenga pilotos con avance.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(21);

-- A propone el tour (piloto), C administra la aerolínea, E es jefe de operaciones,
-- D vuela el tour y S es superadministrador.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000009a1', 'a@tae.test', '{"display_name":"Creador A"}'),
  ('00000000-0000-0000-0000-0000000009c3', 'c@tae.test', '{"display_name":"Admin C"}'),
  ('00000000-0000-0000-0000-0000000009d4', 'd@tae.test', '{"display_name":"Piloto D"}'),
  ('00000000-0000-0000-0000-0000000009e5', 'e@tae.test', '{"display_name":"Jefe E"}'),
  ('00000000-0000-0000-0000-0000000009f6', 's@tae.test', '{"display_name":"Super S"}');
insert into organization_members (organization_id, user_id, role)
select id, '00000000-0000-0000-0000-0000000009f6', 'superadmin' from organizations where slug = 'lam';
insert into airlines (organization_id, slug, name, icao_code, is_active, network)
select id, 'tour-m', 'Tour M', 'QTM', true, 'IVAO' from organizations where slug = 'lam';
insert into airports (icao_code, iata_code, name, city, country_code, latitude, longitude, elevation_ft, airport_type) values
  ('MMMX', 'MEX', 'Aeropuerto Internacional de la Ciudad de México', 'Ciudad de México', 'MX', 19.4363, -99.0721, 7316, 'large_airport'),
  ('MMGL', 'GDL', 'Aeropuerto Internacional de Guadalajara', 'Guadalajara', 'MX', 20.5218, -103.3112, 5016, 'large_airport'),
  ('MMMY', 'MTY', 'Aeropuerto Internacional de Monterrey', 'Monterrey', 'MX', 25.7785, -100.1069, 1278, 'large_airport'),
  ('MMUN', 'CUN', 'Aeropuerto Internacional de Cancún', 'Cancún', 'MX', 21.0365, -86.8771, 22, 'large_airport')
on conflict (icao_code) do nothing;

create temp table t (
  x uuid, b738 bigint, mmmx bigint, mmgl bigint, mmmy bigint, mmun bigint,
  tour uuid, enr uuid, leg1 uuid, leg2 uuid, leg3 uuid, flight1 uuid, flight2 uuid
) on commit drop;
insert into t (x, b738, mmmx, mmgl, mmmy, mmun)
select (select id from airlines where slug = 'tour-m'), (select id from aircraft_types where icao_code = 'B738'),
       (select id from airports where icao_code = 'MMMX'), (select id from airports where icao_code = 'MMGL'),
       (select id from airports where icao_code = 'MMMY'), (select id from airports where icao_code = 'MMUN');
grant select, update on t to authenticated;

insert into airline_memberships (airline_id, user_id, roles, status)
select t.x, m.uid, m.roles::airline_role[], 'active'::membership_status
  from t, (values ('00000000-0000-0000-0000-0000000009a1'::uuid, '{pilot}'), ('00000000-0000-0000-0000-0000000009c3'::uuid, '{airline_admin}'),
                  ('00000000-0000-0000-0000-0000000009d4'::uuid, '{pilot}'), ('00000000-0000-0000-0000-0000000009e5'::uuid, '{ops_chief,pilot}')) as m(uid, roles);
insert into aircraft (airline_id, aircraft_type_id, registration, base_airport_id, current_airport_id)
select x, b738, 'XA-TM1', mmmx, mmmx from t;
insert into pilot_type_ratings (airline_id, user_id, aircraft_type_id)
select x, '00000000-0000-0000-0000-0000000009d4'::uuid, b738 from t;

create function pg_temp.finish_leg(p_flight uuid) returns void language sql as $$
  update flights set status = 'completed', started_at = now() - interval '1 hour', completed_at = now() where id = p_flight;
  update flight_bookings set status = 'completed', closed_at = now() where id = (select booking_id from flights where id = p_flight);
  update aircraft set status = 'available' where id = (select aircraft_id from flights where id = p_flight);
  insert into flight_sessions (flight_id, user_id, airline_id, status, phase, ended_at)
  select id, user_id, airline_id, 'completed', 'taxi_in', now() from flights where id = p_flight;
  insert into pireps (flight_id, session_id, airline_id, user_id, aircraft_type_id, aircraft_registration, callsign, flight_number,
                      origin_airport_id, destination_airport_id, arrival_airport_id, block_on_at, block_minutes, distance_nm, score, status, reviewed_at)
  select f.id, s.id, f.airline_id, f.user_id, f.aircraft_type_id, f.aircraft_registration, f.callsign, f.flight_number,
         f.origin_airport_id, f.destination_airport_id, f.destination_airport_id, now(), 60, f.planned_distance_nm, 95, 'accepted', now()
    from flights f join flight_sessions s on s.flight_id = f.id where f.id = p_flight;
$$;

create function pg_temp.legs_json(p_ids uuid[], p_from bigint[], p_to bigint[]) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('id', p_ids[i], 'origin_airport_id', p_from[i], 'destination_airport_id', p_to[i]) order by i)
    from generate_subscripts(p_from, 1) i;
$$;

-- ---------------------------------------------------------------------------
-- Quien lo propone lo edita solo como borrador
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009a1"}';
update t set tour = save_tour(null, jsonb_build_object(
  'airline_id', (select x from t), 'code', 'TAE-01', 'name', 'Costa a costa', 'color', '#a855f7',
  'aircraft_type_ids', jsonb_build_array((select b738 from t)), 'ordered_legs', true, 'auto_approve_same_airline', false),
  pg_temp.legs_json(array[null, null, null]::uuid[], array[(select mmmx from t), (select mmgl from t), (select mmmy from t)],
                    array[(select mmgl from t), (select mmmy from t), (select mmmx from t)]));
update t set leg1 = (select id from tour_legs where tour_id = t.tour and leg_number = 1),
             leg2 = (select id from tour_legs where tour_id = t.tour and leg_number = 2),
             leg3 = (select id from tour_legs where tour_id = t.tour and leg_number = 3);
select lives_ok(
  format($$select save_tour(%L, '{"code":"TAE-01","name":"Costa a costa (borrador)","aircraft_type_ids":[%s]}'::jsonb)$$, (select tour from t), (select b738 from t)),
  'En borrador, quien lo propuso lo edita'
);
select is((get_tour((select tour from t)) ->> 'can_modify')::boolean, true, 'En borrador, la web le deja editarlo');
select is(submit_tour((select tour from t))::text, 'submitted', 'Lo envía a revisión');
select throws_ok(
  format($$select save_tour(%L, '{"code":"TAE-01","name":"Otro nombre","aircraft_type_ids":[%s]}'::jsonb)$$, (select tour from t), (select b738 from t)),
  '42501', null, 'Enviado, quien lo propuso ya no lo modifica'
);
select is((get_tour((select tour from t)) ->> 'can_modify')::boolean, false, 'Y la web ya no le muestra Editar');
select is(private.can_edit_tour_folder((select tour::text from t)), false, 'Ni sube otra insignia');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009c3"}';
select lives_ok(format('select review_tour(%L, true)', (select tour from t)), 'El administrador lo publica');

-- ---------------------------------------------------------------------------
-- D se inscribe y vuela dos legs
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009d4"}';
update t set enr = (enroll_tour(tour, x) ->> 'enrollment_id')::uuid;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009c3"}';
select lives_ok(format('select review_tour_enrollment(%L, true)', (select enr from t)), 'El administrador aprueba la inscripción');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009d4"}';
update t set flight1 = (book_tour_leg(enr, leg1, (select id from aircraft where registration = 'XA-TM1'), 'QTM101', '101') ->> 'flight_id')::uuid;
reset role;
select pg_temp.finish_leg((select flight1 from t));
set local role authenticated;
update t set flight2 = (book_tour_leg(enr, leg2, (select id from aircraft where registration = 'XA-TM1'), 'QTM102', '102') ->> 'flight_id')::uuid;
reset role;
select pg_temp.finish_leg((select flight2 from t));
set local role authenticated;

-- ---------------------------------------------------------------------------
-- Ni el jefe de operaciones ni el creador lo modifican ya publicado
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009e5"}';
select throws_ok(
  format($$select save_tour(%L, '{"code":"TAE-01","name":"Jefe","aircraft_type_ids":[%s]}'::jsonb)$$, (select tour from t), (select b738 from t)),
  '42501', null, 'El jefe de operaciones no modifica el tour'
);
select throws_ok(format('select close_tour(%L)', (select tour from t)), '42501', null, 'Ni lo cierra');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009a1"}';
select throws_ok(format('select close_tour(%L)', (select tour from t)), '42501', null, 'Quien lo propuso tampoco lo cierra');

-- ---------------------------------------------------------------------------
-- El administrador lo cambia todo con un piloto a la mitad
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009c3"}';
select is((get_tour((select tour from t)) ->> 'can_modify')::boolean, true, 'El administrador puede modificarlo publicado');
-- Quita el leg 2, deja el 1, el 3 pasa a ser el 2 y agrega MMMX-MMUN; cambia el código y los tipos.
select lives_ok(
  format($$select save_tour(%L, '{"code":"TAE-02","name":"Costa a costa","aircraft_type_ids":[%s],"ordered_legs":true}'::jsonb, %L::jsonb)$$,
         (select tour from t), (select b738 from t),
         pg_temp.legs_json(array[(select leg1 from t), (select leg3 from t), null]::uuid[],
                           array[(select mmmx from t), (select mmmy from t), (select mmmx from t)],
                           array[(select mmgl from t), (select mmmx from t), (select mmun from t)])),
  'Publicado y con avance, el administrador cambia código, legs y orden'
);
select results_eq(
  $$select leg_number::int, id = (select leg1 from t), id = (select leg3 from t) from tour_legs where tour_id = (select tour from t) order by leg_number$$,
  $$values (1, true, false), (2, false, true), (3, false, false)$$,
  'Los legs que siguen conservan su identidad y se renumeran'
);
select is((select code from tours where id = (select tour from t)), 'TAE-02', 'El código cambió');
select ok((select tour_leg_id is null and tour_enrollment_id is not null from flights where id = (select flight2 from t)),
  'El vuelo del leg quitado queda como vuelo normal');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009d4"}';
select results_eq(
  $$select x ->> 'state' from jsonb_array_elements(get_tour((select tour from t)) -> 'my_legs') x order by (x ->> 'leg_number')::int$$,
  $$values ('accepted'::text), ('open'::text), ('open'::text)$$,
  'El piloto conserva su avance en el leg que siguió'
);

-- Si quita los legs que faltan, quien ya voló el resto termina el tour.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009c3"}';
select lives_ok(
  format($$select save_tour(%L, '{"code":"TAE-02","name":"Costa a costa","aircraft_type_ids":[%s]}'::jsonb, %L::jsonb)$$,
         (select tour from t), (select b738 from t),
         pg_temp.legs_json(array[(select leg1 from t)]::uuid[], array[(select mmmx from t)], array[(select mmgl from t)])),
  'El administrador deja un solo leg'
);
select is((select status::text from tour_enrollments where id = (select enr from t)), 'completed', 'Quien ya lo voló completo termina el tour y gana la insignia');

-- ---------------------------------------------------------------------------
-- El superadministrador lo modifica aun cerrado
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009f6"}';
select lives_ok(format('select close_tour(%L)', (select tour from t)), 'El superadministrador lo cierra');
select lives_ok(
  format($$select save_tour(%L, '{"code":"TAE-02","name":"Costa a costa 2026","aircraft_type_ids":[%s]}'::jsonb)$$, (select tour from t), (select b738 from t)),
  'Y lo sigue modificando ya cerrado'
);

select * from finish();
rollback;
