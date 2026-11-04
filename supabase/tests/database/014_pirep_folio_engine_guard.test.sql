-- Folio de PIREP y tope de eventos de motor por sesión.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(8);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000f0a1', 'a@folio.test', '{"display_name":"Piloto Folio"}'),
  ('00000000-0000-0000-0000-00000000f0a2', 'b@folio.test', '{"display_name":"Piloto Folio Dos"}');
insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, 'folio-aerolinea', 'Prueba Folio', 'QFO', true from organizations where slug = 'lam';
insert into airports (icao_code, iata_code, name, city, country_code, latitude, longitude, elevation_ft, airport_type) values
  ('MMMX', 'MEX', 'Aeropuerto Internacional de la Ciudad de México', 'Ciudad de México', 'MX', 19.4363, -99.0721, 7316, 'large_airport'),
  ('PHNL', 'HNL', 'Daniel K. Inouye International Airport', 'Honolulu', 'US', 21.3187, -157.9225, 13, 'large_airport')
on conflict (icao_code) do nothing;

create temp table t on commit drop as
select
  (select id from airlines where slug = 'folio-aerolinea') as airline,
  (select id from aircraft_types where icao_code = 'A339') as a339,
  (select id from airports where icao_code = 'MMMX') as mmmx,
  (select id from airports where icao_code = 'PHNL') as phnl,
  encode(extensions.digest('lamd_folio', 'sha256'), 'hex') as token,
  encode(extensions.digest('lamd_folio2', 'sha256'), 'hex') as token2,
  gen_random_uuid() as device, gen_random_uuid() as device2, gen_random_uuid() as flight, gen_random_uuid() as session,
  gen_random_uuid() as flight2, gen_random_uuid() as session2;
grant select on t to service_role;

insert into airline_memberships (airline_id, user_id, roles, status)
select airline, u, '{pilot}'::airline_role[], 'active'::membership_status
  from t, unnest(array['00000000-0000-0000-0000-00000000f0a1', '00000000-0000-0000-0000-00000000f0a2']::uuid[]) u;
insert into acars_devices (id, user_id, name, token_hash, token_prefix)
select device, '00000000-0000-0000-0000-00000000f0a1'::uuid, 'PC folio', token, 'lamd_fol' from t
union all
select device2, '00000000-0000-0000-0000-00000000f0a2'::uuid, 'PC folio 2', token2, 'lamd_fo2' from t;
insert into flights (id, airline_id, user_id, aircraft_type_id, aircraft_registration, airline_icao, flight_number, callsign,
                     origin_airport_id, destination_airport_id, planned_distance_nm, planned_minutes, operation_type, network, status, started_at)
select f.id, airline, f.uid, a339, 'XA-FOL', 'QFO', f.num, 'QFO2201', mmmx, phnl, 3295, 480, 'passenger', 'IVAO', 'in_progress', now() - interval '1 hour'
  from t, lateral (values (t.flight, '2201', '00000000-0000-0000-0000-00000000f0a1'::uuid), (t.flight2, '2202', '00000000-0000-0000-0000-00000000f0a2'::uuid)) as f(id, num, uid);
insert into flight_sessions (id, flight_id, device_id, user_id, airline_id, status, phase)
select s.id, s.f, s.d, s.uid, airline, 'active', 'pushback'
  from t, lateral (values (t.session, t.flight, t.device, '00000000-0000-0000-0000-00000000f0a1'::uuid),
                          (t.session2, t.flight2, t.device2, '00000000-0000-0000-0000-00000000f0a2'::uuid)) as s(id, f, d, uid);

-- ---------------------------------------------------------------------------
-- Tope de eventos de motor
-- ---------------------------------------------------------------------------
create function pg_temp.engine_batch(p_from int) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object(
           'id', gen_random_uuid(), 'seq', n, 'type', case when n % 2 = 0 then 'engine_start' else 'engine_shutdown' end,
           'phase', 'pushback', 'occurred_at', now() - interval '30 minutes' + make_interval(secs => n), 'data', jsonb_build_object('running', 4, 'count', 4)))
    from generate_series(p_from, p_from + 49) n;
$$;
grant execute on function pg_temp.engine_batch(int) to service_role;

set local role service_role;
select is((acars_events((select token from t), (select session from t), pg_temp.engine_batch(0)) ->> 'inserted')::int, 50,
  'Un lote normal de eventos de motor se guarda');
select is((acars_events((select token from t), (select session from t), pg_temp.engine_batch(50)) ->> 'inserted')::int, 14,
  'Al llegar a 64 eventos de motor, el resto se acepta pero no se guarda');
select is((acars_events((select token from t), (select session from t), (pg_temp.engine_batch(100) - 49) || jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'seq', 150, 'type', 'phase_change', 'phase', 'taxi_out',
      'occurred_at', now() - interval '5 minutes', 'data', jsonb_build_object('from', 'pushback', 'to', 'taxi_out')))
  ) ->> 'received')::int, 50, 'El lote se recibe completo');
reset role;
select is((select count(*)::int from flight_events where session_id = (select session from t) and type in ('engine_start', 'engine_shutdown')), 64,
  'La sesión conserva 64 eventos de motor como máximo');
select is((select phase from flight_sessions where id = (select session from t)), 'taxi_out',
  'Los demás eventos del mismo lote sí se guardan (la fase avanza)');
set local role service_role;
select is((acars_events((select token2 from t), (select session2 from t), pg_temp.engine_batch(0)) ->> 'inserted')::int, 50,
  'El tope es por sesión');
reset role;

-- ---------------------------------------------------------------------------
-- Folio
-- ---------------------------------------------------------------------------
insert into pireps (flight_id, session_id, airline_id, user_id, aircraft_type_id, aircraft_registration, callsign, flight_number,
                    origin_airport_id, destination_airport_id, arrival_airport_id, block_on_at, block_minutes, distance_nm, score, status)
select p.f, p.s, airline, p.uid, a339, 'XA-FOL', 'QFO2201', p.num, mmmx, phnl, phnl, now(), 480, 3295, 90, 'pending'
  from t, lateral (values (t.flight, t.session, '2201', '00000000-0000-0000-0000-00000000f0a1'::uuid),
                          (t.flight2, t.session2, '2202', '00000000-0000-0000-0000-00000000f0a2'::uuid)) as p(f, s, num, uid);
select ok(
  (select bool_and(folio ~ ('^PIREP-' || to_char(now() at time zone 'UTC', 'YYYY') || '-[0-9]{5}$')) from pireps where airline_id = (select airline from t)),
  'Cada PIREP nuevo recibe su folio PIREP-AAAA-NNNNN'
);
select is(
  (select count(distinct folio)::int from pireps where airline_id = (select airline from t)), 2,
  'Los folios no se repiten'
);

select * from finish();
rollback;
