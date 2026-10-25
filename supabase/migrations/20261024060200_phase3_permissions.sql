-- =============================================================================
-- LAM Virtual ACARS — Fase 3 (3/4): permisos y RLS
-- Reservas y vuelos no tienen permisos de escritura: solo cambian con
-- book_flight, cancel_booking y el vencimiento automático.
-- =============================================================================

revoke all on public.pilot_type_ratings, public.flight_bookings, public.flights, public.simbrief_ofps
  from anon, authenticated;

grant select, delete on public.pilot_type_ratings to authenticated;
grant insert (airline_id, user_id, aircraft_type_id, notes) on public.pilot_type_ratings to authenticated;

grant select on public.flight_bookings, public.flights, public.simbrief_ofps to authenticated;
grant insert (flight_id, request_id, static_id, generated_at, airline_icao, flight_number, atc_callsign,
  origin_icao, destination_icao, alternate_icao, aircraft_icao, registration, route, cruise_altitude_ft,
  air_distance_nm, est_enroute_minutes, est_block_minutes, fuel_units, block_fuel, trip_fuel, reserve_fuel,
  zfw, tow, ldw, pax_count, cargo, pdf_url) on public.simbrief_ofps to authenticated;
grant update (flight_id, request_id, static_id, generated_at, airline_icao, flight_number, atc_callsign,
  origin_icao, destination_icao, alternate_icao, aircraft_icao, registration, route, cruise_altitude_ft,
  air_distance_nm, est_enroute_minutes, est_block_minutes, fuel_units, block_fuel, trip_fuel, reserve_fuel,
  zfw, tow, ldw, pax_count, cargo, pdf_url) on public.simbrief_ofps to authenticated;

grant update (require_type_rating) on public.airline_settings to authenticated;

-- Habilitaciones: el piloto ve las suyas; el staff de la aerolínea las gestiona.
create policy pilot_type_ratings_select on public.pilot_type_ratings for select to authenticated
  using (user_id = (select auth.uid()) or private.can_staff_airline(airline_id));
create policy pilot_type_ratings_insert on public.pilot_type_ratings for insert to authenticated
  with check (private.can_staff_airline(airline_id));
create policy pilot_type_ratings_delete on public.pilot_type_ratings for delete to authenticated
  using (
    private.can_staff_airline(airline_id)
    and (user_id <> (select auth.uid()) or (select private.is_org_admin()))
  );

-- Reservas, vuelos y OFP: el piloto ve los suyos; el staff, los de su aerolínea.
create policy flight_bookings_select on public.flight_bookings for select to authenticated
  using (user_id = (select auth.uid()) or private.can_staff_airline(airline_id));
create policy flights_select on public.flights for select to authenticated
  using (user_id = (select auth.uid()) or private.can_staff_airline(airline_id));
create policy simbrief_ofps_select on public.simbrief_ofps for select to authenticated
  using (user_id = (select auth.uid()) or private.can_staff_airline(airline_id));

-- El piloto importa el OFP de su propio vuelo mientras no haya comenzado.
create policy simbrief_ofps_insert on public.simbrief_ofps for insert to authenticated
  with check (exists (
    select 1 from public.flights f
    where f.id = flight_id and f.user_id = (select auth.uid()) and f.status = 'scheduled'
  ));
create policy simbrief_ofps_update on public.simbrief_ofps for update to authenticated
  using (exists (
    select 1 from public.flights f
    where f.id = flight_id and f.user_id = (select auth.uid()) and f.status = 'scheduled'
  ))
  with check (exists (
    select 1 from public.flights f
    where f.id = flight_id and f.user_id = (select auth.uid()) and f.status = 'scheduled'
  ));

-- -----------------------------------------------------------------------------
-- Funciones
-- -----------------------------------------------------------------------------
revoke all on function private.user_is_active_member(uuid, uuid) from public;
grant execute on function private.user_is_active_member(uuid, uuid) to authenticated, service_role;
revoke all on function private.booking_block_reason(uuid, uuid, uuid) from public;
grant execute on function private.booking_block_reason(uuid, uuid, uuid) to authenticated, service_role;
revoke all on function private.booking_reason_message(text) from public;
revoke all on function private.next_departure(time, smallint, timestamptz) from public;
revoke all on function private.close_booking(uuid, public.booking_status, uuid) from public;
revoke all on function private.expire_bookings() from public;
revoke all on function private.normalize_registration(text) from public;
grant execute on function private.normalize_registration(text) to authenticated, service_role;
revoke all on function private.guard_rating_write() from public;
revoke all on function private.set_simbrief_ofp() from public;

revoke all on function public.route_aircraft_options(uuid) from public, anon;
grant execute on function public.route_aircraft_options(uuid) to authenticated;
revoke all on function public.book_flight(uuid, uuid, text) from public, anon;
grant execute on function public.book_flight(uuid, uuid, text) to authenticated;
revoke all on function public.cancel_booking(uuid) from public, anon;
grant execute on function public.cancel_booking(uuid) to authenticated;

comment on function public.route_aircraft_options(uuid) is 'Aeronaves de la aerolínea de la ruta, con el motivo por el que quien llama no puede reservarlas (NULL si puede).';
comment on function public.book_flight(uuid, uuid, text) is 'Reserva una ruta con una aeronave y el callsign del piloto. Valida todas las reglas en el servidor.';
comment on function public.cancel_booking(uuid) is 'Cancela una reserva activa cuyo vuelo no comenzó y libera la aeronave.';

-- -----------------------------------------------------------------------------
-- Dashboard: agrega las reservas activas.
-- -----------------------------------------------------------------------------
create or replace function public.get_dashboard_summary(p_airline_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_admin boolean;
  v_airlines uuid[];
  v_scope text;
begin
  if v_uid is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;

  v_is_admin := private.is_org_admin();

  if p_airline_id is not null then
    if not (v_is_admin or private.is_airline_member(p_airline_id)) then
      raise exception 'No tienes acceso a esta aerolínea' using errcode = '42501';
    end if;
    v_airlines := array[p_airline_id];
    v_scope := 'airline';
  elsif v_is_admin then
    select coalesce(array_agg(a.id), '{}') into v_airlines from public.airlines a;
    v_scope := 'organization';
  else
    select coalesce(array_agg(m.airline_id), '{}') into v_airlines
    from public.airline_memberships m
    where m.user_id = v_uid and m.status = 'active';
    v_scope := 'member';
  end if;

  return jsonb_build_object(
    'scope', v_scope,
    'airlines_total', (select count(*) from public.airlines a where a.id = any (v_airlines)),
    'airlines_active', (select count(*) from public.airlines a where a.id = any (v_airlines) and a.is_active),
    'pilots_active_members', (
      select count(distinct m.user_id)
      from public.airline_memberships m
      where m.airline_id = any (v_airlines) and m.status = 'active' and 'pilot' = any (m.roles)
    ),
    'pending_requests', (
      select count(*)
      from public.airline_memberships m
      where m.airline_id = any (v_airlines)
        and m.status = 'pending'
        and private.can_manage_airline(m.airline_id)
    ),
    'profiles_total', case
      when v_is_admin and p_airline_id is null then (select count(*) from public.profiles)
    end,
    'bookings_active', (
      select count(*)
      from public.flight_bookings b
      where b.airline_id = any (v_airlines) and b.status = 'active' and b.expires_at > now()
    ),
    'my_bookings_active', (
      select count(*)
      from public.flight_bookings b
      where b.user_id = v_uid and b.airline_id = any (v_airlines) and b.status = 'active' and b.expires_at > now()
    )
  );
end;
$$;
