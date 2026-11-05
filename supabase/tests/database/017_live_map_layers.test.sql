-- Capas del mapa en vivo: ruta del plan de SimBrief y control activo de IVAO.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(15);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000f201', 'p@capas.test', '{"display_name":"Piloto Capas"}'),
  ('00000000-0000-0000-0000-00000000f202', 'x@capas.test', '{"display_name":"Ajeno Capas"}');
insert into airlines (organization_id, slug, name, icao_code, is_active)
select id, 'capas-aerolinea', 'Prueba Capas', 'QCP', true from organizations where slug = 'lam';
insert into airports (icao_code, iata_code, name, city, country_code, latitude, longitude, elevation_ft, airport_type) values
  ('MMMX', 'MEX', 'Aeropuerto Internacional de la Ciudad de México', 'Ciudad de México', 'MX', 19.4363, -99.0721, 7316, 'large_airport'),
  ('MMGL', 'GDL', 'Aeropuerto Internacional de Guadalajara', 'Guadalajara', 'MX', 20.5218, -103.3112, 5016, 'large_airport')
on conflict (icao_code) do nothing;

create temp table t on commit drop as
select (select id from airlines where slug = 'capas-aerolinea') as airline,
       (select id from aircraft_types where icao_code = 'B738') as b738,
       (select id from airports where icao_code = 'MMMX') as mmmx,
       (select id from airports where icao_code = 'MMGL') as mmgl,
       gen_random_uuid() as flight, gen_random_uuid() as flight2;
grant select on t to authenticated;

insert into airline_memberships (airline_id, user_id, roles, status)
select airline, '00000000-0000-0000-0000-00000000f201'::uuid, '{pilot}'::airline_role[], 'active'::membership_status from t;
insert into flights (id, airline_id, user_id, aircraft_type_id, aircraft_registration, airline_icao, flight_number, callsign,
                     origin_airport_id, destination_airport_id, planned_distance_nm, planned_minutes, operation_type, network, status)
select f, airline, '00000000-0000-0000-0000-00000000f201', b738, 'XA-CAP', 'QCP', n, 'QCP' || n, mmmx, mmgl, 248, 65, 'passenger', 'IVAO', 'scheduled'
  from t, lateral (values (t.flight, '100'), (t.flight2, '101')) as x(f, n);
insert into simbrief_ofps (flight_id, airline_id, user_id, request_id, origin_icao, destination_icao, route, navlog)
select flight, airline, '00000000-0000-0000-0000-00000000f201', 'R1', 'MMMX', 'MMGL', 'SLM UT7 QET',
       '[{"ident":"SLM","type":"vor","lat":19.8,"lon":-99.0,"via":"DCT","sid_star":false},
         {"ident":"QET","type":"vor","lat":20.6,"lon":-100.3,"via":"UT7","sid_star":false}]'::jsonb
  from t;

-- -----------------------------------------------------------------------------
-- Ruta del plan
-- -----------------------------------------------------------------------------
select throws_ok(
  $$insert into simbrief_ofps (flight_id, airline_id, user_id, request_id, origin_icao, destination_icao, navlog)
    select flight2, airline, '00000000-0000-0000-0000-00000000f201', 'R2', 'MMMX', 'MMGL', '{"a":1}'::jsonb from t$$,
  '23514', null, 'Los puntos del plan son una lista'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f201"}';
select results_eq(
  $$select jsonb_array_length(r -> 'fixes'), r -> 'fixes' -> 1 ->> 'ident', r ->> 'route'
      from (select get_live_flight_route((select flight from t)) r) x$$,
  $$values (2, 'QET'::text, 'SLM UT7 QET'::text)$$,
  'El piloto ve los puntos del plan de su vuelo'
);
select is(get_live_flight_route((select flight2 from t)) -> 'fixes', '[]'::jsonb, 'Sin plan importado, la lista de puntos va vacía');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f202"}';
select throws_ok($$select get_live_flight_route((select flight from t))$$, '42501', null, 'Quien no es de la aerolínea no ve la ruta');
reset role;

-- -----------------------------------------------------------------------------
-- Control de IVAO
-- -----------------------------------------------------------------------------
create temp table w on commit drop as select '{
  "updatedAt": "2026-11-05T03:10:47Z",
  "clients": {
    "pilots": [{"callsign": "AMX123", "userId": 1, "lastTrack": {"latitude": 1, "longitude": 2}}],
    "atcs": [
      {"id": 1, "userId": 753225, "rating": 5, "callsign": "MMMX_TWR", "createdAt": "2026-11-04T19:33:54Z",
       "atcSession": {"position": "TWR", "frequency": 118.1},
       "lastTrack": {"latitude": 19.43, "longitude": -99.07},
       "atis": {"lines": ["ts-1.ivao.aero/MMMX_TWR", "Information ALFA MMMX 050146Z 04010KT"], "revision": "A"}},
      {"id": 2, "userId": 111, "rating": 7, "callsign": "MMFR_CTR", "createdAt": "2026-11-04T20:00:00Z",
       "atcSession": {"frequency": "128.3"}, "lastTrack": {"latitude": "x", "longitude": -99}},
      {"id": 3, "callsign": "bad callsign!"}
    ]
  }
}'::jsonb as j;

select is(jsonb_array_length(private.ivao_compact_atcs((select j from w))), 2, 'Se conservan los controladores con callsign válido');
select results_eq(
  $$select a ->> 'callsign', a ->> 'position', (a ->> 'frequency')::numeric, (a ->> 'latitude')::numeric, jsonb_array_length(a -> 'atis')
      from jsonb_array_elements(private.ivao_compact_atcs((select j from w))) a where a ->> 'callsign' = 'MMMX_TWR'$$,
  $$values ('MMMX_TWR'::text, 'TWR'::text, 118.1::numeric, 19.43::numeric, 2)$$,
  'Callsign, posición, frecuencia, coordenadas y ATIS'
);
select is(
  (select a ->> 'position' from jsonb_array_elements(private.ivao_compact_atcs((select j from w))) a where a ->> 'callsign' = 'MMFR_CTR'),
  'CTR', 'Sin posición en la sesión, se toma del callsign'
);
select ok(
  (select bool_and(a ->> 'latitude' is null) from jsonb_array_elements(private.ivao_compact_atcs((select j from w))) a where a ->> 'callsign' = 'MMFR_CTR'),
  'Una coordenada inválida se descarta'
);
select ok(
  not exists (select 1 from jsonb_array_elements(private.ivao_compact_atcs((select j from w))) a
               where a ? 'userId' or a ? 'rating' or a ? 'id'),
  'No se guardan el VID, el rango ni el id del miembro'
);
select is(private.ivao_compact_atcs('{}'::jsonb), '[]'::jsonb, 'Una respuesta sin controladores da una lista vacía');
select lives_ok($$select private.ivao_refresh()$$, 'La tarea de descarga corre sin error aunque nadie mire el mapa');

set local request.jwt.claims = '{}';
select throws_ok($$select get_ivao_atc()$$, '28000', null, 'Sin sesión no hay datos de IVAO');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f202"}';
select is(get_ivao_atc() -> 'atcs', '[]'::jsonb, 'Sin descarga reciente la lista va vacía');
reset role;
update private.ivao_state set atcs = private.ivao_compact_atcs((select j from w)), fetched_at = now();
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000f202"}';
select results_eq(
  $$select jsonb_array_length(r -> 'atcs'), (r ->> 'stale')::boolean from (select get_ivao_atc() r) x$$,
  $$values (2, false)$$,
  'Cualquier usuario con sesión ve la lista vigente'
);
reset role;
select ok((select last_viewed_at > now() - interval '1 minute' from private.ivao_state), 'Queda marcado que alguien mira el mapa');

select * from finish();
rollback;
