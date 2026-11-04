-- Carga de combustible: antes de los calzos fuera es normal; después, una falta.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(8);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000fe01', 'a@carga.test', '{"display_name":"Piloto Carga"}'),
  ('00000000-0000-0000-0000-00000000fe02', 'b@carga.test', '{"display_name":"Piloto Recarga"}');
insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, 'carga-aerolinea', 'Prueba Carga', 'QCG', true from organizations where slug = 'lam';
insert into airports (icao_code, iata_code, name, city, country_code, latitude, longitude, elevation_ft, airport_type) values
  ('MMMX', 'MEX', 'Aeropuerto Internacional de la Ciudad de México', 'Ciudad de México', 'MX', 19.4363, -99.0721, 7316, 'large_airport'),
  ('MMGL', 'GDL', 'Aeropuerto Internacional de Guadalajara', 'Guadalajara', 'MX', 20.5218, -103.3112, 5016, 'large_airport')
on conflict (icao_code) do nothing;

create temp table t on commit drop as
select (select id from airlines where slug = 'carga-aerolinea') as airline,
       (select id from aircraft_types where icao_code = 'A339') as a339,
       (select id from airports where icao_code = 'MMMX') as mmmx,
       (select id from airports where icao_code = 'MMGL') as mmgl;

select is(
  (select enabled::text || '/' || penalty || '/' || threshold || '/' || critical from pirep_scoring_rules
    where rule_code = 'fuel_added_after_pushback' and airline_id = (select airline from t)),
  'true/20/100/true', 'Toda aerolínea recibe la regla activa: 20 puntos, umbral de 100 kg, falta grave'
);

-- Dos vuelos completos MMMX–MMGL: el primero carga en tierra; el segundo, además, recarga después de los calzos fuera.
create temp table v on commit drop as
select n, u, gen_random_uuid() as flight, gen_random_uuid() as session
  from (values (1, '00000000-0000-0000-0000-00000000fe01'::uuid), (2, '00000000-0000-0000-0000-00000000fe02'::uuid)) as x(n, u);

insert into airline_memberships (airline_id, user_id, roles, status)
select airline, u, '{pilot}'::airline_role[], 'active'::membership_status from t, v;
insert into flights (id, airline_id, user_id, aircraft_type_id, aircraft_registration, airline_icao, flight_number, callsign,
                     origin_airport_id, destination_airport_id, planned_distance_nm, planned_minutes, operation_type, network, status, started_at, completed_at)
select flight, airline, u, a339, 'XA-QC' || n, 'QCG', '10' || n, 'QCG10' || n, mmmx, mmgl, 250, 70, 'passenger', 'IVAO', 'completed',
       now() - interval '3 hours', now() - interval '30 minutes'
  from t, v;
insert into flight_sessions (id, flight_id, user_id, airline_id, status, phase, started_at, ended_at, last_contact_at)
select session, flight, u, airline, 'completed', 'flight_completed', now() - interval '3 hours', now() - interval '30 minutes', now() - interval '30 minutes'
  from t, v;

-- Traza: arranca con 19,318 kg, carga a 79,118 en tierra (antes de los calzos fuera), consume y vuela.
-- El vuelo 2 recarga 600 kg en el rodaje (550 netos: entre muestras se queman 50), después de los calzos fuera.
insert into flight_track_points (flight_id, session_id, user_id, airline_id, seq, sampled_at, latitude, longitude, altitude_ft, gs_kt, ias_kt, vs_fpm, heading_deg, on_ground, phase, fuel_kg)
select v.flight, v.session, v.u, t.airline, p.seq, now() - p.ago, p.lat, p.lon, p.alt, p.gs, p.gs, 0, 280, p.ground, p.phase,
       p.fuel + case when v.n = 2 and p.seq >= 6 then 600 else 0 end
  from t, v, (values
    (0, interval '170 minutes', 19.43, -99.07, 7316, 0, true, 'preflight', 19318),
    (1, interval '168 minutes', 19.43, -99.07, 7316, 0, true, 'preflight', 19310),
    (2, interval '158 minutes', 19.43, -99.07, 7316, 0, true, 'preflight', 79118),
    (3, interval '150 minutes', 19.43, -99.07, 7316, 0, true, 'preflight', 79100),
    (4, interval '146 minutes', 19.43, -99.07, 7316, 0, true, 'pushback', 79090),
    (5, interval '140 minutes', 19.44, -99.08, 7316, 15, true, 'taxi_out', 78900),
    (6, interval '136 minutes', 19.44, -99.08, 7316, 15, true, 'taxi_out', 78850),
    (7, interval '130 minutes', 19.80, -100.5, 20000, 380, false, 'climb', 76000),
    (8, interval '60 minutes', 20.50, -103.3, 5100, 140, false, 'approach', 70000),
    (9, interval '40 minutes', 20.52, -103.31, 5016, 10, true, 'taxi_in', 69800)
  ) as p(seq, ago, lat, lon, alt, gs, ground, phase, fuel);

insert into flight_events (id, flight_id, session_id, user_id, airline_id, seq, type, phase, occurred_at, data)
select gen_random_uuid(), v.flight, v.session, v.u, t.airline, e.seq, e.type, e.phase, now() - e.ago,
       e.data || case when v.n = 2 and e.type in ('takeoff', 'touchdown', 'block_on') then '{"fuel_add":600}'::jsonb else '{}'::jsonb end
  from t, v, (values
    (0, 'block_off', 'pushback', interval '147 minutes', '{"fuel_kg":79095}'::jsonb),
    (1, 'engine_start', 'pushback', interval '145 minutes', '{"running":1,"count":4}'::jsonb),
    (2, 'takeoff', 'initial_climb', interval '132 minutes', '{"fuel_kg":78700}'::jsonb),
    (3, 'touchdown', 'landing', interval '45 minutes', '{"vs_fpm":-180,"fuel_kg":69900}'::jsonb),
    (4, 'block_on', 'taxi_in', interval '35 minutes', '{"fuel_kg":69780}'::jsonb)
  ) as e(seq, type, phase, ago, data);

create temp table r on commit drop as
select v.n, private.pirep_fuel_metrics(v.session) as f from v;

select results_eq(
  $$select (f ->> 'preflight_loaded_kg')::int, f ->> 'refueled_kg' from r where n = 1$$,
  $$values (59808, null::text)$$,
  'La carga en tierra antes de los calzos fuera se informa aparte y no cuenta como recarga'
);
select ok((select (f ->> 'before_engines_kg')::int between 0 and 100 from r where n = 1),
  'Lo consumido antes del arranque no incluye la carga');
select is((select (f ->> 'refueled_kg')::int from r where n = 2), 550, 'Lo agregado después de los calzos fuera es una recarga');

select ok(private.build_pirep((select session from v where n = 1)) is not null, 'El vuelo 1 genera su PIREP');
select ok(private.build_pirep((select session from v where n = 2)) is not null, 'El vuelo 2 genera su PIREP');
select ok(
  not exists (select 1 from pireps p, jsonb_array_elements(p.findings) f
               where p.session_id = (select session from v where n = 1) and f ->> 'code' = 'fuel_added_after_pushback'),
  'Cargar combustible antes del pushback no es falta'
);
select results_eq(
  $$select (f ->> 'value')::int, (f ->> 'critical')::boolean, p.status::text
      from pireps p, jsonb_array_elements(p.findings) f
     where p.session_id = (select session from v where n = 2) and f ->> 'code' = 'fuel_added_after_pushback'$$,
  $$values (550, true, 'pending'::text)$$,
  'Agregar combustible después de los calzos fuera es falta grave y el PIREP va a revisión'
);

select * from finish();
rollback;
