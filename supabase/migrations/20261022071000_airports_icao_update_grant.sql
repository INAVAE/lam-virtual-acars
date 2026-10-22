-- La actualización masiva de aeropuertos (Edge Function import-airports en
-- modo refresh) hace upsert por icao_code y necesita permiso de columna.
-- Solo el superadministrador pasa la política airports_update.
grant update (icao_code) on public.airports to authenticated;
