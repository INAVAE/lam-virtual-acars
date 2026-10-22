-- =============================================================================
-- LAM Virtual ACARS — Fase 2 (3/5): permisos y RLS de catálogos, flota y rutas
-- =============================================================================

revoke all on function private.great_circle_nm(double precision, double precision, double precision, double precision) from public;
grant execute on function private.great_circle_nm(double precision, double precision, double precision, double precision) to authenticated, service_role;
revoke all on function private.days_mask(text) from public;
grant execute on function private.days_mask(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Permisos y RLS
-- -----------------------------------------------------------------------------
revoke all on public.airports, public.aircraft_types, public.aircraft, public.routes, public.route_aircraft_types
  from anon, authenticated;

grant select, insert, delete on public.airports to authenticated;
grant update (iata_code, name, city, country_code, latitude, longitude, elevation_ft, airport_type, source)
  on public.airports to authenticated;

grant select, insert, delete on public.aircraft_types to authenticated;
grant update (manufacturer, model, wake_category, engine_type, max_passengers, max_cargo_kg, cruise_speed_kts)
  on public.aircraft_types to authenticated;

grant select, delete on public.aircraft to authenticated;
grant insert (airline_id, aircraft_type_id, registration, fleet_number, configuration, operation_type, status,
  base_airport_id, current_airport_id, notes) on public.aircraft to authenticated;
grant update (aircraft_type_id, registration, fleet_number, configuration, operation_type, status,
  base_airport_id, current_airport_id, notes) on public.aircraft to authenticated;

grant select, delete on public.routes to authenticated;
grant insert (airline_id, flight_number, origin_airport_id, destination_airport_id, estimated_minutes,
  departure_time_utc, days_of_week, operation_type, is_active, notes) on public.routes to authenticated;
grant update (flight_number, origin_airport_id, destination_airport_id, estimated_minutes, departure_time_utc,
  days_of_week, operation_type, is_active, notes) on public.routes to authenticated;

grant select, insert, delete on public.route_aircraft_types to authenticated;

-- Catálogos: lectura para cualquier sesión; escritura solo superadministrador.
create policy airports_select on public.airports for select to authenticated using (true);
create policy airports_insert on public.airports for insert to authenticated with check ((select private.is_org_admin()));
create policy airports_update on public.airports for update to authenticated
  using ((select private.is_org_admin())) with check ((select private.is_org_admin()));
create policy airports_delete on public.airports for delete to authenticated using ((select private.is_org_admin()));

create policy aircraft_types_select on public.aircraft_types for select to authenticated using (true);
create policy aircraft_types_insert on public.aircraft_types for insert to authenticated with check ((select private.is_org_admin()));
create policy aircraft_types_update on public.aircraft_types for update to authenticated
  using ((select private.is_org_admin())) with check ((select private.is_org_admin()));
create policy aircraft_types_delete on public.aircraft_types for delete to authenticated using ((select private.is_org_admin()));

-- Flota y rutas: miembros de la aerolínea leen; administradores escriben.
create policy aircraft_select on public.aircraft for select to authenticated
  using ((select private.is_org_admin()) or private.is_airline_member(airline_id));
create policy aircraft_insert on public.aircraft for insert to authenticated
  with check (private.can_manage_airline(airline_id));
create policy aircraft_update on public.aircraft for update to authenticated
  using (private.can_manage_airline(airline_id)) with check (private.can_manage_airline(airline_id));
create policy aircraft_delete on public.aircraft for delete to authenticated
  using (private.can_manage_airline(airline_id));

create policy routes_select on public.routes for select to authenticated
  using ((select private.is_org_admin()) or private.is_airline_member(airline_id));
create policy routes_insert on public.routes for insert to authenticated
  with check (private.can_manage_airline(airline_id));
create policy routes_update on public.routes for update to authenticated
  using (private.can_manage_airline(airline_id)) with check (private.can_manage_airline(airline_id));
create policy routes_delete on public.routes for delete to authenticated
  using (private.can_manage_airline(airline_id));

create policy route_aircraft_types_select on public.route_aircraft_types for select to authenticated
  using (exists (
    select 1 from public.routes r
    where r.id = route_id and ((select private.is_org_admin()) or private.is_airline_member(r.airline_id))
  ));
create policy route_aircraft_types_insert on public.route_aircraft_types for insert to authenticated
  with check (exists (select 1 from public.routes r where r.id = route_id and private.can_manage_airline(r.airline_id)));
create policy route_aircraft_types_delete on public.route_aircraft_types for delete to authenticated
  using (exists (select 1 from public.routes r where r.id = route_id and private.can_manage_airline(r.airline_id)));

