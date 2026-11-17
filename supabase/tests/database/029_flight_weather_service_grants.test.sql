-- La Edge Function acars (clave secreta = service_role) lee el vuelo y guarda su METAR.
-- Sin estos permisos el METAR de salida y de llegada no se guardaba.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(8);

select ok(has_table_privilege('service_role', 'public.flights', 'select'), 'service_role lee flights');
select ok(has_table_privilege('service_role', 'public.flight_sessions', 'select'), 'service_role lee flight_sessions');
select ok(has_table_privilege('service_role', 'public.flight_events', 'select'), 'service_role lee flight_events');
select ok(has_table_privilege('service_role', 'public.airports', 'select'), 'service_role lee airports');
select ok(has_table_privilege('service_role', 'public.flight_weather', 'select'), 'service_role lee flight_weather');
select ok(has_table_privilege('service_role', 'public.flight_weather', 'insert'), 'service_role inserta en flight_weather');
select ok(has_table_privilege('service_role', 'public.flight_weather', 'update'), 'service_role actualiza flight_weather');
select ok(not has_table_privilege('authenticated', 'public.flight_weather', 'insert'), 'un usuario no escribe METAR');

select * from finish();
rollback;
