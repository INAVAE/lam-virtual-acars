-- La Edge Function `acars` borra la posición viva al cerrar la sesión con la
-- clave secreta (service_role). En este proyecto service_role no recibe
-- permisos de tabla por omisión, así que se otorgan explícitamente.
grant select, delete on public.flight_positions_live to service_role;
