-- «Cambio de aeronave»: solo cuenta si cambia el título del avión, no su matrícula ATC.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(4);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000fb01', 'a@cambio.test', '{"display_name":"Piloto Misma"}'),
  ('00000000-0000-0000-0000-00000000fb02', 'b@cambio.test', '{"display_name":"Piloto Otra"}');
insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, 'cambio-aerolinea', 'Prueba Cambio', 'QCA', true from organizations where slug = 'lam';
insert into airports (icao_code, iata_code, name, city, country_code, latitude, longitude, elevation_ft, airport_type) values
  ('MMMX', 'MEX', 'Aeropuerto Internacional de la Ciudad de México', 'Ciudad de México', 'MX', 19.4363, -99.0721, 7316, 'large_airport'),
  ('MMGL', 'GDL', 'Aeropuerto Internacional de Guadalajara', 'Guadalajara', 'MX', 20.5218, -103.3112, 5016, 'large_airport')
on conflict (icao_code) do nothing;

create temp table t on commit drop as
select (select id from airlines where slug = 'cambio-aerolinea') as airline,
       (select id from aircraft_types where icao_code = 'A339') as a339,
       (select id from airports where icao_code = 'MMMX') as mmmx,
       (select id from airports where icao_code = 'MMGL') as mmgl;

-- Vuelo 1: el evento trae el mismo título (cambió la matrícula ATC). Vuelo 2: otro avión.
create temp table v on commit drop as
select n, u, title, gen_random_uuid() as flight, gen_random_uuid() as session
  from (values (1, '00000000-0000-0000-0000-00000000fb01'::uuid, 'A380-800 EA Basic'),
               (2, '00000000-0000-0000-0000-00000000fb02'::uuid, 'Airbus A320neo')) as x(n, u, title);

insert into airline_memberships (airline_id, user_id, roles, status)
select airline, u, '{pilot}'::airline_role[], 'active'::membership_status from t, v;
insert into flights (id, airline_id, user_id, aircraft_type_id, aircraft_registration, airline_icao, flight_number, callsign,
                     origin_airport_id, destination_airport_id, planned_distance_nm, planned_minutes, operation_type, network, status, started_at, completed_at)
select flight, airline, u, a339, 'XA-QA' || n, 'QCA', '20' || n, 'QCA20' || n, mmmx, mmgl, 250, 70, 'passenger', 'IVAO', 'completed',
       now() - interval '3 hours', now() - interval '30 minutes'
  from t, v;
insert into flight_sessions (id, flight_id, user_id, airline_id, status, phase, started_at, ended_at, last_contact_at, sim_aircraft_title)
select session, flight, u, airline, 'completed', 'flight_completed', now() - interval '3 hours', now() - interval '30 minutes',
       now() - interval '30 minutes', 'A380-800 EA Basic'
  from t, v;

insert into flight_events (id, flight_id, session_id, user_id, airline_id, seq, type, phase, occurred_at, data)
select gen_random_uuid(), v.flight, v.session, v.u, t.airline, e.seq, e.type, e.phase, now() - e.ago,
       case when e.type = 'aircraft_changed' then jsonb_build_object('title', v.title, 'icao', 'A388') else e.data end
  from t, v, (values
    (0, 'aircraft_changed', 'preflight', interval '170 minutes', '{}'::jsonb),
    (1, 'block_off', 'pushback', interval '147 minutes', '{}'::jsonb),
    (2, 'takeoff', 'initial_climb', interval '132 minutes', '{}'::jsonb),
    (3, 'touchdown', 'landing', interval '45 minutes', '{"vs_fpm":-180}'::jsonb),
    (4, 'block_on', 'taxi_in', interval '35 minutes', '{}'::jsonb)
  ) as e(seq, type, phase, ago, data);

select lives_ok($$select private.build_pirep(session) from v$$, 'Se generan los dos PIREP');

select is(
  (select count(*)::int from pireps p, v, jsonb_array_elements(p.findings) f
    where p.session_id = v.session and v.n = 1 and f ->> 'code' = 'aircraft_changed'),
  0, 'Misma aeronave con otra matrícula ATC: sin «Cambio de aeronave»'
);
select is(
  (select count(*)::int from pireps p, v, jsonb_array_elements(p.findings) f
    where p.session_id = v.session and v.n = 2 and f ->> 'code' = 'aircraft_changed'),
  1, 'Otro avión: sí hay «Cambio de aeronave»'
);
select is((select has_critical from pireps p, v where p.session_id = v.session and v.n = 2), true, 'Y sigue siendo falta grave');

select * from finish();
rollback;
