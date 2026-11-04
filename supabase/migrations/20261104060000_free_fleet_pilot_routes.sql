-- =============================================================================
-- Flota libre, rutas registradas por pilotos y tipos volados por ruta (2026-11-04)
--
-- Retroalimentación de los pilotos: las habilitaciones de tipo y la
-- disponibilidad de la flota complican el uso. Todo queda como opción de la
-- aerolínea para no perder lo construido:
--
--   require_type_rating          (ya existía) exige habilitación de tipo.
--   control_fleet_availability   (nuevo, activado) una aeronave reservada o en
--                                vuelo no se puede reservar; respeta Mantenimiento
--                                y Fuera de servicio y la regla de "aeronave en el
--                                origen". Apagado: cualquier piloto reserva
--                                cualquier matrícula de la flota y el sistema deja
--                                de cambiar su estado.
--   pilots_register_routes       (nuevo, activado) los pilotos registran rutas.
--
-- Rutas: las del staff (formulario e importación) nacen activas. Las que registra
-- un piloto nacen pendientes (activated_at nulo), se pueden reservar, y pasan a
-- activas solas con el primer PIREP aceptado que llegó al destino de la ruta.
-- Los tipos de aeronave de una ruta siguen siendo opcionales (sin tipos = cualquiera);
-- get_route_type_usage informa con qué tipos se ha volado cada ruta.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Ajustes de la aerolínea
-- -----------------------------------------------------------------------------
alter table public.airline_settings
  add column control_fleet_availability boolean not null default true,
  add column pilots_register_routes boolean not null default true;
comment on column public.airline_settings.control_fleet_availability is
  'Activado: una aeronave reservada, en vuelo, en mantenimiento o fuera de servicio no se reserva. Apagado: la flota es libre y el sistema no cambia su estado.';
comment on column public.airline_settings.pilots_register_routes is
  'Los pilotos registran rutas; nacen pendientes y se activan con el primer PIREP aceptado que llegó al destino.';
grant update (control_fleet_availability, pilots_register_routes) on public.airline_settings to authenticated;

create function private.fleet_controlled(p_airline_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.control_fleet_availability from public.airline_settings s where s.airline_id = p_airline_id), true);
$$;
revoke all on function private.fleet_controlled(uuid) from public;

-- -----------------------------------------------------------------------------
-- Una reserva activa por aeronave: ahora depende del ajuste, así que la regla
-- pasa del índice único a las funciones de reserva (que bloquean la aeronave).
-- -----------------------------------------------------------------------------
drop index if exists public.flight_bookings_one_active_per_aircraft;
create index if not exists flight_bookings_aircraft_id_active_idx on public.flight_bookings (aircraft_id) where status = 'active';

create or replace function private.booking_block_reason(p_user_id uuid, p_route_id uuid, p_aircraft_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_route_airline uuid;
  v_route_active boolean;
  v_route_origin bigint;
  v_route_operation text;
  v_ac_airline uuid;
  v_ac_type bigint;
  v_ac_status public.aircraft_status;
  v_ac_operation text;
  v_ac_location bigint;
  v_require_rating boolean;
  v_require_origin boolean;
  v_controlled boolean;
begin
  select r.airline_id, r.is_active, r.origin_airport_id, r.operation_type
    into v_route_airline, v_route_active, v_route_origin, v_route_operation
  from public.routes r where r.id = p_route_id;
  if not found or not v_route_active then
    return 'route_inactive';
  end if;

  select a.airline_id, a.aircraft_type_id, a.status, a.operation_type, coalesce(a.current_airport_id, a.base_airport_id)
    into v_ac_airline, v_ac_type, v_ac_status, v_ac_operation, v_ac_location
  from public.aircraft a where a.id = p_aircraft_id;
  if not found or v_ac_airline <> v_route_airline then
    return 'aircraft_other_airline';
  end if;

  v_controlled := private.fleet_controlled(v_route_airline);
  if v_controlled and (
       v_ac_status <> 'available'
       or exists (select 1 from public.flight_bookings b where b.aircraft_id = p_aircraft_id and b.status = 'active')
     ) then
    return 'aircraft_unavailable';
  end if;

  if exists (select 1 from public.route_aircraft_types t where t.route_id = p_route_id)
     and not exists (
       select 1 from public.route_aircraft_types t
       where t.route_id = p_route_id and t.aircraft_type_id = v_ac_type
     ) then
    return 'type_not_allowed';
  end if;

  if (v_route_operation = 'passenger' and v_ac_operation = 'cargo')
     or (v_route_operation = 'cargo' and v_ac_operation = 'passenger') then
    return 'operation_mismatch';
  end if;

  select s.require_type_rating, s.require_aircraft_at_origin
    into v_require_rating, v_require_origin
  from public.airline_settings s where s.airline_id = v_route_airline;

  if coalesce(v_require_rating, true) and not exists (
    select 1 from public.pilot_type_ratings pr
    where pr.airline_id = v_route_airline and pr.user_id = p_user_id and pr.aircraft_type_id = v_ac_type
  ) then
    return 'no_rating';
  end if;

  if v_controlled and coalesce(v_require_origin, false) and v_ac_location is distinct from v_route_origin then
    return 'not_at_origin';
  end if;

  return null;
end;
$$;

create or replace function private.program_aircraft_block_reason(p_user_id uuid, p_airline_id uuid, p_aircraft_id uuid, p_type_ids bigint[], p_origin bigint)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ac_airline uuid;
  v_ac_type bigint;
  v_ac_status public.aircraft_status;
  v_ac_location bigint;
  v_require_rating boolean;
  v_require_origin boolean;
  v_controlled boolean;
begin
  select a.airline_id, a.aircraft_type_id, a.status, coalesce(a.current_airport_id, a.base_airport_id)
    into v_ac_airline, v_ac_type, v_ac_status, v_ac_location
  from public.aircraft a where a.id = p_aircraft_id;
  if not found or v_ac_airline <> p_airline_id then
    return 'aircraft_other_airline';
  end if;
  v_controlled := private.fleet_controlled(p_airline_id);
  if v_controlled and (
       v_ac_status <> 'available'
       or exists (select 1 from public.flight_bookings b where b.aircraft_id = p_aircraft_id and b.status = 'active')
     ) then
    return 'aircraft_unavailable';
  end if;
  if coalesce(cardinality(p_type_ids), 0) > 0 and not (v_ac_type = any (p_type_ids)) then
    return 'type_not_allowed';
  end if;
  select s.require_type_rating, s.require_aircraft_at_origin into v_require_rating, v_require_origin
  from public.airline_settings s where s.airline_id = p_airline_id;
  if coalesce(v_require_rating, true) and not exists (
    select 1 from public.pilot_type_ratings pr
    where pr.airline_id = p_airline_id and pr.user_id = p_user_id and pr.aircraft_type_id = v_ac_type
  ) then
    return 'no_rating';
  end if;
  if v_controlled and coalesce(v_require_origin, false) and v_ac_location is distinct from p_origin then
    return 'not_at_origin';
  end if;
  return null;
end;
$$;

-- Con la flota libre, el sistema no marca aeronaves como Asignada ni En vuelo
-- (reservas, tours, eventos y ACARS pasan por aquí).
create or replace function private.guard_aircraft_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('assigned', 'in_flight') then
      raise exception 'La aeronave tiene un vuelo reservado o en curso' using errcode = '55006';
    end if;
    return old;
  end if;

  new.registration := upper(btrim(new.registration));
  if tg_op = 'UPDATE' and new.airline_id is distinct from old.airline_id then
    raise exception 'Una aeronave no se puede cambiar de aerolínea' using errcode = '42501';
  end if;

  if current_user in ('authenticated', 'anon') then
    if new.status in ('assigned', 'in_flight')
       and (tg_op = 'INSERT' or new.status is distinct from old.status) then
      raise exception 'Los estados Asignada y En vuelo los pone el sistema' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and old.status in ('assigned', 'in_flight') and (
         new.status is distinct from old.status
         or new.aircraft_type_id is distinct from old.aircraft_type_id
         or new.current_airport_id is distinct from old.current_airport_id
       ) then
      raise exception 'La aeronave tiene un vuelo reservado o en curso; cancela la reserva primero' using errcode = '55006';
    end if;
  elsif tg_op = 'UPDATE' and new.status in ('assigned', 'in_flight') and new.status is distinct from old.status
        and not private.fleet_controlled(new.airline_id) then
    new.status := old.status;
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Rutas pendientes y activas
-- -----------------------------------------------------------------------------
alter table public.routes
  add column activated_at timestamptz default now(),
  add column activated_pirep_id uuid references public.pireps (id) on delete set null,
  add column registered_by uuid references public.profiles (id) on delete set null;
comment on column public.routes.activated_at is
  'Nulo = pendiente: la registró un piloto y aún no tiene un PIREP aceptado que llegó al destino. Las del staff nacen activas.';
comment on column public.routes.activated_pirep_id is 'PIREP que activó la ruta.';
comment on column public.routes.registered_by is 'Piloto que registró la ruta (nulo si la creó el staff).';
update public.routes set activated_at = created_at where activated_at is null;
create index routes_activated_pirep_id_idx on public.routes (activated_pirep_id);
create index routes_registered_by_idx on public.routes (registered_by);
create index routes_airline_pending_idx on public.routes (airline_id) where activated_at is null;

-- El piloto puede borrar su ruta pendiente si no tiene reservas activas.
create policy routes_delete_own_pending on public.routes for delete to authenticated
  using (
    registered_by = (select auth.uid())
    and activated_at is null
    and not exists (select 1 from public.flight_bookings b where b.route_id = routes.id and b.status = 'active')
  );

create function private.route_reason_message(p_reason text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_reason
    when 'routes_closed' then 'Esta aerolínea no permite que los pilotos registren rutas'
    when 'invalid_flight_number' then 'Número de vuelo inválido: de 1 a 4 dígitos y, opcional, una letra'
    when 'same_airport' then 'El origen y el destino deben ser distintos'
    when 'airport_not_found' then 'Aeropuerto no encontrado'
    when 'invalid_operation' then 'Tipo de operación inválido'
    when 'invalid_minutes' then 'La duración estimada debe estar entre 10 y 1440 minutos'
    when 'too_many_pending' then 'Tienes 20 rutas pendientes en esta aerolínea; vuela alguna antes de registrar más'
    else 'No se pudo registrar la ruta'
  end;
$$;
revoke all on function private.route_reason_message(text) from public;

create function public.register_route(
  p_airline_id uuid,
  p_flight_number text,
  p_origin_airport_id bigint,
  p_destination_airport_id bigint,
  p_operation_type text default 'passenger',
  p_estimated_minutes integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_number text := upper(regexp_replace(coalesce(p_flight_number, ''), '\s', '', 'g'));
  v_open boolean;
  v_reason text;
  v_id uuid;
  v_other text;
begin
  if v_uid is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  if not exists (select 1 from public.airlines a where a.id = p_airline_id and a.is_active)
     or not private.is_airline_member(p_airline_id) then
    raise exception '%', private.booking_reason_message('not_member') using errcode = '42501', hint = 'not_member';
  end if;
  select s.pilots_register_routes into v_open from public.airline_settings s where s.airline_id = p_airline_id;
  if not coalesce(v_open, true) and not private.can_manage_airline(p_airline_id) then
    v_reason := 'routes_closed';
  elsif v_number !~ '^[0-9]{1,4}[A-Z]?$' then
    v_reason := 'invalid_flight_number';
  elsif p_origin_airport_id is null or p_destination_airport_id is null
        or (select count(*) from public.airports a where a.id in (p_origin_airport_id, p_destination_airport_id)) < 2 then
    v_reason := case when p_origin_airport_id is not distinct from p_destination_airport_id then 'same_airport' else 'airport_not_found' end;
  elsif coalesce(p_operation_type, 'passenger') not in ('passenger', 'cargo', 'mixed') then
    v_reason := 'invalid_operation';
  elsif p_estimated_minutes is not null and p_estimated_minutes not between 10 and 1440 then
    v_reason := 'invalid_minutes';
  elsif (select count(*) from public.routes r
          where r.airline_id = p_airline_id and r.registered_by = v_uid and r.activated_at is null) >= 20 then
    v_reason := 'too_many_pending';
  end if;
  if v_reason is not null then
    raise exception '%', private.route_reason_message(v_reason) using errcode = 'P0001', hint = v_reason;
  end if;

  -- Serializa por aerolínea y número de vuelo.
  select oa.icao_code || '–' || da.icao_code into v_other
    from public.routes r
    join public.airports oa on oa.id = r.origin_airport_id
    join public.airports da on da.id = r.destination_airport_id
   where r.airline_id = p_airline_id and r.flight_number = v_number;
  if found then
    raise exception 'El número de vuelo % ya existe en la aerolínea (%)', v_number, v_other
      using errcode = '23505', hint = 'flight_number_taken';
  end if;

  begin
    insert into public.routes (airline_id, flight_number, origin_airport_id, destination_airport_id, estimated_minutes,
                               operation_type, activated_at, registered_by)
    values (p_airline_id, v_number, p_origin_airport_id, p_destination_airport_id, p_estimated_minutes::smallint,
            coalesce(p_operation_type, 'passenger'), null, v_uid)
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'El número de vuelo % ya existe en la aerolínea', v_number using errcode = '23505', hint = 'flight_number_taken';
    when check_violation then
      raise exception '%', private.route_reason_message('same_airport') using errcode = 'P0001', hint = 'same_airport';
  end;
  return v_id;
end;
$$;
revoke all on function public.register_route(uuid, text, bigint, bigint, text, integer) from public, anon;
grant execute on function public.register_route(uuid, text, bigint, bigint, text, integer) to authenticated;

-- Primer PIREP aceptado que llegó al destino: la ruta pendiente queda activa.
create function private.activate_route_from_pirep()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'accepted' and (tg_op = 'INSERT' or old.status is distinct from 'accepted') and not coalesce(new.diverted, false) then
    update public.routes r
       set activated_at = now(), activated_pirep_id = new.id
      from public.flights f
     where f.id = new.flight_id
       and r.id = f.route_id
       and r.airline_id = new.airline_id
       and r.activated_at is null
       and new.arrival_airport_id = r.destination_airport_id;
  end if;
  return null;
end;
$$;
revoke all on function private.activate_route_from_pirep() from public;

create trigger pireps_activate_route after insert or update of status on public.pireps
  for each row execute function private.activate_route_from_pirep();

-- -----------------------------------------------------------------------------
-- Tipos con los que se ha volado cada ruta (vuelos completados).
-- -----------------------------------------------------------------------------
create function public.get_route_type_usage(p_airline_id uuid)
returns table (route_id uuid, aircraft_type_id bigint, icao_code text, flights integer, last_flight_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  if not (private.is_org_admin() or private.is_airline_member(p_airline_id)) then
    raise exception 'No tienes acceso a esta aerolínea' using errcode = '42501';
  end if;
  return query
    select f.route_id, f.aircraft_type_id, t.icao_code, count(*)::integer, max(coalesce(f.completed_at, f.updated_at))
      from public.flights f
      join public.aircraft_types t on t.id = f.aircraft_type_id
     where f.airline_id = p_airline_id and f.route_id is not null and f.status = 'completed'
     group by f.route_id, f.aircraft_type_id, t.icao_code
     order by f.route_id, count(*) desc, t.icao_code;
end;
$$;
revoke all on function public.get_route_type_usage(uuid) from public, anon;
grant execute on function public.get_route_type_usage(uuid) to authenticated;
