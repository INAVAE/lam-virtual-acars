-- Fase 7.4: Eventos (escenarios, aprobación, registros, reserva, ranking, mapa y exclusividad con tours).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(30);

-- A crea el evento (piloto de X), C administra X, D vuela con Y, E vuela con Z (no admitida).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000009a1', 'a@f7e.test', '{"display_name":"Creador A"}'),
  ('00000000-0000-0000-0000-0000000009c3', 'c@f7e.test', '{"display_name":"Admin C"}'),
  ('00000000-0000-0000-0000-0000000009d4', 'd@f7e.test', '{"display_name":"Piloto D"}'),
  ('00000000-0000-0000-0000-0000000009e5', 'e@f7e.test', '{"display_name":"Piloto E"}');
insert into airlines (organization_id, slug, name, icao_code, is_active, network)
select id, x.slug, x.name, x.icao, true, 'IVAO' from organizations,
  (values ('ev-x', 'Evento X', 'QEX'), ('ev-y', 'Evento Y', 'QEY'), ('ev-z', 'Evento Z', 'QEZ')) as x(slug, name, icao)
 where organizations.slug = 'lam';
insert into airports (icao_code, iata_code, name, city, country_code, latitude, longitude, elevation_ft, airport_type) values
  ('MMMX', 'MEX', 'Aeropuerto Internacional de la Ciudad de México', 'Ciudad de México', 'MX', 19.4363, -99.0721, 7316, 'large_airport'),
  ('MMGL', 'GDL', 'Aeropuerto Internacional de Guadalajara', 'Guadalajara', 'MX', 20.5218, -103.3112, 5016, 'large_airport'),
  ('MMMY', 'MTY', 'Aeropuerto Internacional de Monterrey', 'Monterrey', 'MX', 25.7785, -100.1069, 1278, 'large_airport')
on conflict (icao_code) do nothing;

create temp table t (
  x uuid, y uuid, z uuid, b738 bigint, mmmx bigint, mmgl bigint, mmmy bigint,
  ev uuid, ev2 uuid, reg_d uuid, flight uuid, tour uuid
) on commit drop;
insert into t (x, y, z, b738, mmmx, mmgl, mmmy)
select (select id from airlines where slug = 'ev-x'), (select id from airlines where slug = 'ev-y'), (select id from airlines where slug = 'ev-z'),
       (select id from aircraft_types where icao_code = 'B738'),
       (select id from airports where icao_code = 'MMMX'), (select id from airports where icao_code = 'MMGL'), (select id from airports where icao_code = 'MMMY');
grant select, update on t to authenticated;

insert into airline_memberships (airline_id, user_id, roles, status)
select m.airline, m.uid, m.roles::airline_role[], 'active'::membership_status
  from t, lateral (values (t.x, '00000000-0000-0000-0000-0000000009a1'::uuid, '{pilot}'), (t.x, '00000000-0000-0000-0000-0000000009c3'::uuid, '{airline_admin}'),
                          (t.y, '00000000-0000-0000-0000-0000000009d4'::uuid, '{pilot}'), (t.z, '00000000-0000-0000-0000-0000000009e5'::uuid, '{pilot}')) as m(airline, uid, roles);
insert into aircraft (airline_id, aircraft_type_id, registration, base_airport_id, current_airport_id)
select y, b738, 'XA-EY1', mmmy, mmmy from t;
insert into pilot_type_ratings (airline_id, user_id, aircraft_type_id)
select y, '00000000-0000-0000-0000-0000000009d4'::uuid, b738 from t;

-- ---------------------------------------------------------------------------
-- Creación, escenarios y aprobación
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009a1"}';
update t set ev = save_event(null, jsonb_build_object(
  'airline_id', (select x from t), 'name', 'Fly-in Ciudad de México', 'scenario', 'any_origin_same_destination',
  'origin_airport_id', (select mmgl from t), 'destination_airport_id', (select mmmx from t),
  'starts_at', now() - interval '1 hour', 'ends_at', now() + interval '3 hours',
  'airline_ids', jsonb_build_array((select x from t), (select y from t)), 'prize_criterion', 'softest_landing',
  'prize_description', 'Insignia dorada y mención', 'prize_places', 3, 'color', '#f59e0b'));
select results_eq(
  $$select status::text, scenario::text, origin_airport_id is null, destination_airport_id = (select mmmx from t), folio ~ '^EVT-[0-9]{4}-[0-9]{4}$'
      from events where id = (select ev from t)$$,
  $$values ('draft'::text, 'any_origin_same_destination'::text, true, true, true)$$,
  'El evento nace en borrador con folio, y en el escenario 2 solo guarda el destino'
);
select throws_ok(
  format($$select save_event(null, jsonb_build_object('airline_id', %L, 'name', 'Mal', 'scenario', 'same_origin_same_destination',
    'origin_airport_id', %s, 'starts_at', now() + interval '1 day', 'ends_at', now() + interval '2 days'))$$, (select x from t), (select mmmx from t)),
  '23514', null, 'El escenario 1 pide origen y destino'
);
select throws_ok(
  format($$select save_event(null, jsonb_build_object('airline_id', %L, 'name', 'Al revés', 'scenario', 'same_origin_any_destination',
    'origin_airport_id', %s, 'starts_at', now() + interval '2 days', 'ends_at', now() + interval '1 day'))$$, (select x from t), (select mmmx from t)),
  '23514', null, 'El fin va después del inicio'
);
update t set ev2 = save_event(null, jsonb_build_object(
  'airline_id', (select x from t), 'name', 'Salida desde Monterrey', 'scenario', 'same_origin_any_destination',
  'origin_airport_id', (select mmmy from t), 'starts_at', now() + interval '2 days', 'ends_at', now() + interval '2 days 4 hours'));
select is((select folio <> (select folio from events where id = (select ev from t)) from events where id = (select ev2 from t)), true, 'Cada evento tiene su propio folio');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009d4"}';
select is(jsonb_array_length(get_events()), 0, 'Un borrador no lo ve nadie más');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009a1"}';
select is(submit_event((select ev from t))::text, 'submitted', 'El evento de un piloto espera al administrador de su aerolínea');
select throws_ok(format('select review_event(%L, true)', (select ev from t)), '42501', null, 'El piloto no aprueba su propio evento');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009c3"}';
select lives_ok(format('select review_event(%L, true)', (select ev from t)), 'El administrador lo publica');
select is(submit_event((select ev2 from t))::text, 'published', 'El administrador publica directo lo que envía');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009a1"}';
select throws_ok(
  format($$select save_event(%L, jsonb_build_object('name', 'Fly-in', 'scenario', 'same_origin_same_destination',
    'origin_airport_id', %s, 'destination_airport_id', %s, 'starts_at', now(), 'ends_at', now() + interval '3 hours'))$$,
    (select ev from t), (select mmgl from t), (select mmmx from t)),
  'P0001', null, 'Publicado, el escenario y el horario ya no cambian'
);

-- ---------------------------------------------------------------------------
-- Registros
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009e5"}';
select throws_ok(format('select register_event(%L, %L)', (select ev from t), (select z from t)), 'P0001', 'Tu aerolínea no participa en este evento',
  'Solo se registran pilotos de las aerolíneas del evento');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009d4"}';
select is(jsonb_array_length(get_events()), 2, 'Publicados, los ven pilotos de otras aerolíneas');
update t set reg_d = (register_event(ev, y, mmmy, 'Salgo de Monterrey') ->> 'registration_id')::uuid;
select is((select status::text || '/' || (proposed_airport_id = (select mmmy from t)) from event_registrations where id = (select reg_d from t)), 'pending/true',
  'El registro queda pendiente con el origen propuesto');
select throws_ok(format('select register_event(%L, %L)', (select ev from t), (select y from t)), 'P0001', 'Ya estás registrado en este evento', 'No se registra dos veces');

-- Exclusividad: con un registro activo en un evento no entra a un tour.
reset role;
insert into tours (airline_id, created_by, code, name, status, published_at)
select y, '00000000-0000-0000-0000-0000000009d4', 'EXC-01', 'Tour de prueba', 'published', now() from t;
insert into tour_legs (tour_id, leg_number, origin_airport_id, destination_airport_id, distance_nm)
select (select id from tours where code = 'EXC-01'), 1, mmmx, mmgl, 250 from t;
update t set tour = (select id from tours where code = 'EXC-01');
set local role authenticated;
select throws_ok(format('select enroll_tour(%L, %L)', (select tour from t), (select y from t)), 'P0001',
  'No puedes participar en un evento y en un tour a la vez: retírate o termina el otro primero', 'Un piloto en un evento no entra a un tour');

select throws_ok(
  format('select book_event_flight(%L, %L, %L, %L, %L)', (select reg_d from t), (select id from aircraft where registration = 'XA-EY1'), 'QEY900', '900', (select mmmy from t)),
  'P0001', 'Tu registro todavía no está aprobado', 'Sin aprobación no se reserva'
);

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009a1"}';
select is((get_event((select ev from t)) ->> 'pending_registrations')::int, 1, 'El creador ve el registro pendiente');
select lives_ok(format('select review_event_registration(%L, true)', (select reg_d from t)), 'El creador aprueba el registro');

-- ---------------------------------------------------------------------------
-- Reserva y vuelo
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009d4"}';
select throws_ok(
  format('select book_event_flight(%L, %L, %L, %L, %L, %L)', (select reg_d from t), (select id from aircraft where registration = 'XA-EY1'), 'QEY900', '900', (select mmmy from t), (select mmgl from t)),
  'P0001', 'El evento llega a otro aeropuerto', 'El destino debe ser el del evento'
);
select throws_ok(
  format('select book_event_flight(%L, %L, %L, %L)', (select reg_d from t), (select id from aircraft where registration = 'XA-EY1'), 'QEY900', '900'),
  '22023', null, 'En el escenario 2 el piloto indica su origen'
);
update t set flight = (book_event_flight(reg_d, (select id from aircraft where registration = 'XA-EY1'), 'qey900', '900', mmmy) ->> 'flight_id')::uuid;
select results_eq(
  $$select airline_id = (select y from t), origin_airport_id = (select mmmy from t), destination_airport_id = (select mmmx from t), callsign, event_registration_id = (select reg_d from t)
      from flights where id = (select flight from t)$$,
  $$values (true, true, true, 'QEY900'::text, true)$$,
  'El vuelo se reserva con la flota propia, su origen y el destino del evento'
);
select throws_ok(
  format('select book_event_flight(%L, %L, %L, %L, %L)', (select reg_d from t), (select id from aircraft where registration = 'XA-EY1'), 'QEY901', '901', (select mmmy from t)),
  'P0001', 'Ya tienes un vuelo del evento reservado o en curso', 'Un vuelo del evento a la vez'
);
select throws_ok(format('select withdraw_event_registration(%L)', (select reg_d from t)), 'P0001', null, 'No se retira con un vuelo reservado');

reset role;
update flights set status = 'in_progress', started_at = now() where id = (select flight from t);
insert into flight_sessions (flight_id, user_id, airline_id, status, phase)
select flight, '00000000-0000-0000-0000-0000000009d4', y, 'active', 'cruise' from t;
set local role authenticated;
select results_eq(
  $$select x -> 'event' ->> 'folio' = (select folio from events where id = (select ev from t)), x -> 'event' ->> 'name', x -> 'tour' is null or x -> 'tour' = 'null'::jsonb
      from jsonb_array_elements(get_live_flights(null)) x$$,
  $$values (true, 'Fly-in Ciudad de México'::text, true)$$,
  'En el mapa, el vuelo trae el folio y el nombre del evento'
);

-- ---------------------------------------------------------------------------
-- Ranking
-- ---------------------------------------------------------------------------
reset role;
update flight_sessions set status = 'completed', ended_at = now() where flight_id = (select flight from t);
update flights set status = 'completed', completed_at = now() where id = (select flight from t);
insert into pireps (flight_id, session_id, airline_id, user_id, aircraft_type_id, aircraft_registration, callsign, flight_number,
                    origin_airport_id, destination_airport_id, arrival_airport_id, block_on_at, block_minutes, distance_nm, landing_vs_fpm, score, status)
select f.id, s.id, f.airline_id, f.user_id, f.aircraft_type_id, f.aircraft_registration, f.callsign, f.flight_number,
       f.origin_airport_id, f.destination_airport_id, f.destination_airport_id, now(), 95, 400, -142, 91, 'pending'
  from flights f join flight_sessions s on s.flight_id = f.id where f.id = (select flight from t);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009e5"}';
select results_eq(
  $$select (x ->> 'position')::int, x ->> 'name', (x ->> 'landing_vs_fpm')::int, x ->> 'pirep_status', x ->> 'origin'
      from jsonb_array_elements(get_event((select ev from t)) -> 'ranking') x$$,
  $$values (1, 'Piloto D'::text, -142, 'pending'::text, 'MMMY'::text)$$,
  'El ranking usa el criterio del premio y lo ve cualquier piloto'
);
reset role;
update pireps set status = 'rejected', reviewed_at = now() where flight_id = (select flight from t);
set local role authenticated;
select is(jsonb_array_length(get_event((select ev from t)) -> 'ranking'), 0, 'Un PIREP rechazado sale del ranking');

-- Retirarse libera al piloto para un tour.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009d4"}';
select lives_ok(format('select withdraw_event_registration(%L)', (select reg_d from t)), 'Sin vuelo activo se puede retirar');
select lives_ok(format('select enroll_tour(%L, %L)', (select tour from t), (select y from t)), 'Ya fuera del evento, se inscribe al tour');
select throws_ok(format('select register_event(%L, %L, %L)', (select ev2 from t), (select y from t), (select mmmx from t)), 'P0001',
  'No puedes participar en un evento y en un tour a la vez: retírate o termina el otro primero', 'Y en un tour no entra a otro evento');

-- Cancelar
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000009a1"}';
select lives_ok(format('select cancel_event(%L, %L)', (select ev2 from t), 'Clima'), 'El creador puede cancelar el evento');

select * from finish();
rollback;
