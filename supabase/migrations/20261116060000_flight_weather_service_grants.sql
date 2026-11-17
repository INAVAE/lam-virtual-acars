-- =============================================================================
-- LAM Virtual ACARS — permisos de la Edge Function acars para el METAR del vuelo
--
-- En este proyecto service_role no recibe permisos de tabla por omisión (ver
-- 20261028070000_acars_live_position_cleanup_grant.sql). La función acars lee el
-- vuelo, su sesión, sus eventos de calzos y los aeropuertos, y escribe en
-- flight_weather con la clave secreta; sin estos permisos cada consulta fallaba
-- en silencio y ningún PIREP guardaba el METAR de salida ni de llegada.
-- =============================================================================

grant select on public.flights to service_role;
grant select on public.flight_sessions to service_role;
grant select on public.flight_events to service_role;
grant select on public.airports to service_role;
grant select, insert, update on public.flight_weather to service_role;
