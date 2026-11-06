-- APU no informada: encendida desde que se conectó el conector y sin cambios en todo el vuelo.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(4);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000fa01', 'a@apu.test', '{"display_name":"Piloto APU"}');
insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, 'apu-aerolinea', 'Prueba APU', 'QAP', true from organizations where slug = 'lam';
insert into airports (icao_code, iata_code, name, city, country_code, latitude, longitude, elevation_ft, airport_type) values
  ('MMMX', 'MEX', 'Aeropuerto Internacional de la Ciudad de México', 'Ciudad de México', 'MX', 19.4363, -99.0721, 7316, 'large_airport'),
  ('MMGL', 'GDL', 'Aeropuerto Internacional de Guadalajara', 'Guadalajara', 'MX', 20.5218, -103.3112, 5016, 'large_airport')
on conflict (icao_code) do nothing;

create temp table t on commit drop as
select (select id from airlines where slug = 'apu-aerolinea') as airline,
       (select id from aircraft_types where icao_code = 'A339') as a339,
       (select id from airports where icao_code = 'MMMX') as mmmx,
       (select id from airports where icao_code = 'MMGL') as mmgl,
       '00000000-0000-0000-0000-00000000fa01'::uuid as u;

-- Cuatro vuelos: 1) APU fija desde la conexión y despegó; 2) igual pero la APU se apagó;
-- 3) APU fija pero el vuelo nunca despegó; 4) la APU se encendió en la puerta y se apagó.
create temp table v on commit drop as
select n, gen_random_uuid() as flight, gen_random_uuid() as session from generate_series(1, 4) n;

insert into airline_memberships (airline_id, user_id, roles, status)
select airline, u, '{pilot}'::airline_role[], 'active'::membership_status from t;
insert into flights (id, airline_id, user_id, aircraft_type_id, aircraft_registration, airline_icao, flight_number, callsign,
                     origin_airport_id, destination_airport_id, planned_distance_nm, planned_minutes, operation_type, network, status, started_at, completed_at)
select flight, airline, u, a339, 'XA-QA' || n, 'QAP', '20' || n, 'QAP20' || n, mmmx, mmgl, 250, 70, 'passenger', 'IVAO', 'completed',
       now() - interval '3 hours', now() - interval '30 minutes'
  from t, v;
insert into flight_sessions (id, flight_id, user_id, airline_id, status, phase, started_at, ended_at, last_contact_at)
select session, flight, u, airline, 'completed', 'flight_completed', now() - interval '3 hours', now() - interval '30 minutes', now() - interval '30 minutes'
  from t, v;

insert into flight_events (id, flight_id, session_id, user_id, airline_id, seq, type, phase, occurred_at, data)
select gen_random_uuid(), v.flight, v.session, t.u, t.airline, e.seq, e.type, e.phase, now() - e.ago, e.data
  from t, v, (values
    (0, 'note', 'aircraft_connected', interval '170 minutes', '{"kind":"apu","state":"running","fuel_kg":20000}'::jsonb, array[1, 2, 3]),
    (0, 'note', 'preflight', interval '170 minutes', '{"kind":"apu","state":"start","fuel_kg":20000}'::jsonb, array[4]),
    (1, 'block_off', 'pushback', interval '147 minutes', '{"fuel_kg":79095}'::jsonb, array[1, 2, 3, 4]),
    (2, 'note', 'taxi_out', interval '140 minutes', '{"kind":"apu","state":"stop","fuel_kg":79000}'::jsonb, array[2, 4]),
    (3, 'takeoff', 'initial_climb', interval '132 minutes', '{"fuel_kg":78700}'::jsonb, array[1, 2, 4]),
    (4, 'block_on', 'taxi_in', interval '35 minutes', '{"fuel_kg":69780}'::jsonb, array[1, 2, 4])
  ) as e(seq, type, phase, ago, data, only_in)
 where v.n = any (e.only_in);

create temp table r on commit drop as
select v.n, private.pirep_fuel_metrics(v.session) -> 'apu' as apu from v;

select is((select apu from r where n = 1), '{"unreliable": true, "running_at_start": true}'::jsonb,
  'Encendida desde la conexión y sin cambios en un vuelo que despegó: la aeronave no informa su APU');
select is((select (apu ->> 'minutes')::numeric from r where n = 2), 30.0::numeric,
  'Si la APU se apagó, se cuentan sus minutos reales');
select is((select apu ->> 'unreliable' from r where n = 3), null,
  'Sin despegue no se descarta: pudo quedarse en la puerta con la APU');
select results_eq(
  $$select (apu ->> 'minutes')::numeric, (apu ->> 'starts')::int, apu ->> 'unreliable' from r where n = 4$$,
  $$values (30.0::numeric, 1, null::text)$$,
  'Encendida y apagada en la puerta: tiempo normal'
);

select * from finish();
rollback;
