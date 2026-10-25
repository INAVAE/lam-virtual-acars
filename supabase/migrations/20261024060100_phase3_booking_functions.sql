-- =============================================================================
-- LAM Virtual ACARS — Fase 3 (2/4): reglas de reserva, vencimiento y SimBrief
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ¿Por qué p_user no puede reservar p_aircraft para p_route? NULL si puede.
-- Códigos: route_inactive, aircraft_other_airline, aircraft_unavailable,
-- type_not_allowed, operation_mismatch, no_rating, not_at_origin.
-- -----------------------------------------------------------------------------
create function private.booking_block_reason(p_user_id uuid, p_route_id uuid, p_aircraft_id uuid)
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

  if v_ac_status <> 'available' then
    return 'aircraft_unavailable';
  end if;

  -- Sin tipos marcados en la ruta, cualquier tipo de la flota sirve.
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

  if coalesce(v_require_origin, false) and v_ac_location is distinct from v_route_origin then
    return 'not_at_origin';
  end if;

  return null;
end;
$$;

create function private.booking_reason_message(p_reason text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_reason
    when 'route_inactive' then 'La ruta no existe o está inactiva'
    when 'aircraft_other_airline' then 'La aeronave no pertenece a la aerolínea de la ruta'
    when 'aircraft_unavailable' then 'La aeronave no está disponible'
    when 'type_not_allowed' then 'El tipo de aeronave no está permitido en esta ruta'
    when 'operation_mismatch' then 'La aeronave no es apta para el tipo de operación de la ruta'
    when 'no_rating' then 'No tienes habilitación para este tipo de aeronave'
    when 'not_at_origin' then 'La aeronave no está en el aeropuerto de origen'
    when 'max_bookings' then 'Alcanzaste el máximo de reservas activas en esta aerolínea'
    when 'not_member' then 'Solo los miembros activos de la aerolínea reservan sus vuelos'
    else 'No se puede reservar este vuelo'
  end;
$$;

-- Próxima salida programada a partir de p_from (hora UTC y días de la ruta).
create function private.next_departure(p_time time, p_days smallint, p_from timestamptz default now())
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_day date := (p_from at time zone 'UTC')::date;
  v_at timestamptz;
  i integer;
begin
  if p_time is null then
    return null;
  end if;
  for i in 0..7 loop
    v_at := ((v_day + i) + p_time) at time zone 'UTC';
    if (p_days & (1 << (extract(isodow from v_day + i)::integer - 1))) <> 0 and v_at > p_from then
      return v_at;
    end if;
  end loop;
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Cierre de reservas (cancelación y vencimiento). Libera la aeronave.
-- -----------------------------------------------------------------------------
create function private.close_booking(p_booking_id uuid, p_status public.booking_status, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aircraft uuid;
begin
  update public.flight_bookings
     set status = p_status, closed_at = now(), closed_by = p_actor
   where id = p_booking_id and status = 'active'
  returning aircraft_id into v_aircraft;
  if not found then
    return;
  end if;

  update public.flights
     set status = 'cancelled', cancelled_at = now()
   where booking_id = p_booking_id and status = 'scheduled';

  update public.aircraft
     set status = 'available'
   where id = v_aircraft and status = 'assigned';
end;
$$;

-- Vence las reservas cuyo plazo pasó y cuyo vuelo no comenzó.
create function private.expire_bookings()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_count integer := 0;
begin
  for v_id in
    select b.id
    from public.flight_bookings b
    join public.flights f on f.booking_id = b.id
    where b.status = 'active' and b.expires_at <= now() and f.status = 'scheduled'
    for update of b skip locked
  loop
    perform private.close_booking(v_id, 'expired', null);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- API: aeronaves de la ruta con el motivo por el que no se pueden reservar.
-- SECURITY INVOKER: solo ve rutas y flota que RLS permite a quien llama.
-- -----------------------------------------------------------------------------
create function public.route_aircraft_options(p_route_id uuid)
returns table (
  aircraft_id uuid,
  registration text,
  fleet_number text,
  aircraft_type_id bigint,
  type_icao text,
  type_model text,
  status public.aircraft_status,
  location_icao text,
  block_reason text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    a.id,
    a.registration,
    a.fleet_number,
    a.aircraft_type_id,
    t.icao_code,
    t.model,
    a.status,
    ap.icao_code,
    private.booking_block_reason((select auth.uid()), r.id, a.id)
  from public.routes r
  join public.aircraft a on a.airline_id = r.airline_id
  join public.aircraft_types t on t.id = a.aircraft_type_id
  left join public.airports ap on ap.id = coalesce(a.current_airport_id, a.base_airport_id)
  where r.id = p_route_id
  order by (private.booking_block_reason((select auth.uid()), r.id, a.id) is not null), t.icao_code, a.registration;
$$;

-- -----------------------------------------------------------------------------
-- API: reservar. Valida todo en el servidor y bloquea aeronave y piloto para
-- evitar dobles reservas simultáneas.
-- -----------------------------------------------------------------------------
create function public.book_flight(p_route_id uuid, p_aircraft_id uuid, p_callsign text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_callsign text := upper(regexp_replace(coalesce(p_callsign, ''), '\s', '', 'g'));
  v_airline uuid;
  v_airline_icao text;
  v_airline_active boolean;
  v_network text;
  v_remarks text;
  v_flight_number text;
  v_origin bigint;
  v_destination bigint;
  v_distance integer;
  v_minutes smallint;
  v_dep_time time;
  v_days smallint;
  v_operation text;
  v_type bigint;
  v_registration text;
  v_max smallint;
  v_hours smallint;
  v_active integer;
  v_reason text;
  v_booking uuid;
  v_flight uuid;
  v_expires timestamptz;
begin
  if v_uid is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  if v_callsign !~ '^[A-Z0-9]{3,10}$' then
    raise exception 'Callsign inválido: de 3 a 10 letras o números, sin espacios'
      using errcode = '22023', hint = 'invalid_callsign';
  end if;

  select r.airline_id, r.flight_number, r.origin_airport_id, r.destination_airport_id, r.distance_nm,
         r.estimated_minutes, r.departure_time_utc, r.days_of_week, r.operation_type,
         al.icao_code, al.is_active, al.network, al.flight_plan_remarks
    into v_airline, v_flight_number, v_origin, v_destination, v_distance,
         v_minutes, v_dep_time, v_days, v_operation,
         v_airline_icao, v_airline_active, v_network, v_remarks
  from public.routes r
  join public.airlines al on al.id = r.airline_id
  where r.id = p_route_id;
  if not found then
    raise exception '%', private.booking_reason_message('route_inactive') using errcode = 'P0002', hint = 'route_inactive';
  end if;

  if not v_airline_active or not private.is_airline_member(v_airline) then
    raise exception '%', private.booking_reason_message('not_member') using errcode = '42501', hint = 'not_member';
  end if;

  perform private.expire_bookings();

  -- Serializa las reservas del mismo piloto y de la misma aeronave.
  perform 1 from public.profiles where id = v_uid for update;
  select a.aircraft_type_id, a.registration into v_type, v_registration
  from public.aircraft a where a.id = p_aircraft_id for update;

  v_reason := private.booking_block_reason(v_uid, p_route_id, p_aircraft_id);
  if v_reason is not null then
    raise exception '%', private.booking_reason_message(v_reason) using errcode = 'P0001', hint = v_reason;
  end if;

  select s.max_active_bookings, s.booking_expiry_hours into v_max, v_hours
  from public.airline_settings s where s.airline_id = v_airline;

  select count(*) into v_active
  from public.flight_bookings b
  where b.user_id = v_uid and b.airline_id = v_airline and b.status = 'active';
  if v_active >= coalesce(v_max, 1) then
    raise exception 'Ya tienes % reserva(s) activa(s) en esta aerolínea; el máximo es %', v_active, coalesce(v_max, 1)
      using errcode = 'P0001', hint = 'max_bookings';
  end if;

  v_expires := now() + make_interval(hours => coalesce(v_hours, 24));

  insert into public.flight_bookings (airline_id, user_id, route_id, aircraft_id, expires_at)
  values (v_airline, v_uid, p_route_id, p_aircraft_id, v_expires)
  returning id into v_booking;

  insert into public.flights (
    booking_id, airline_id, user_id, route_id, aircraft_id, aircraft_type_id, aircraft_registration,
    airline_icao, flight_number, callsign, origin_airport_id, destination_airport_id,
    planned_distance_nm, planned_minutes, scheduled_departure_at, operation_type, network, flight_plan_remarks
  ) values (
    v_booking, v_airline, v_uid, p_route_id, p_aircraft_id, v_type, v_registration,
    v_airline_icao, v_flight_number, v_callsign, v_origin, v_destination,
    v_distance, v_minutes, private.next_departure(v_dep_time, v_days), v_operation, v_network, v_remarks
  )
  returning id into v_flight;

  update public.aircraft set status = 'assigned' where id = p_aircraft_id;

  return jsonb_build_object('booking_id', v_booking, 'flight_id', v_flight, 'expires_at', v_expires);
end;
$$;

-- -----------------------------------------------------------------------------
-- API: cancelar. El piloto cancela las suyas; el staff, las de su aerolínea.
-- -----------------------------------------------------------------------------
create function public.cancel_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
  v_airline uuid;
  v_status public.booking_status;
  v_flight_status public.flight_status;
begin
  if v_uid is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;

  select b.user_id, b.airline_id, b.status, f.status
    into v_owner, v_airline, v_status, v_flight_status
  from public.flight_bookings b
  left join public.flights f on f.booking_id = b.id
  where b.id = p_booking_id
  for update of b;

  if not found or not (v_owner = v_uid or private.can_staff_airline(v_airline)) then
    raise exception 'Reserva no encontrada' using errcode = 'P0002';
  end if;
  if v_status <> 'active' then
    raise exception 'La reserva ya no está activa' using errcode = 'P0001', hint = 'not_active';
  end if;
  if v_flight_status is distinct from 'scheduled' then
    raise exception 'El vuelo ya comenzó; no se puede cancelar' using errcode = 'P0001', hint = 'flight_started';
  end if;

  perform private.close_booking(p_booking_id, 'cancelled', v_uid);
end;
$$;

-- -----------------------------------------------------------------------------
-- SimBrief: el servidor completa dueño y aerolínea y calcula las diferencias
-- contra el vuelo reservado. Lo que mande el cliente en esos campos no cuenta.
-- -----------------------------------------------------------------------------
create function private.normalize_registration(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '');
$$;

create function private.set_simbrief_ofp()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_airline uuid;
  v_user uuid;
  v_origin text;
  v_destination text;
  v_type text;
  v_registration text;
  v_callsign text;
  v_issues jsonb := '[]'::jsonb;
begin
  if tg_op = 'UPDATE' and new.flight_id <> old.flight_id then
    raise exception 'El OFP no se puede mover a otro vuelo' using errcode = '42501';
  end if;

  select f.airline_id, f.user_id, o.icao_code, d.icao_code, t.icao_code, f.aircraft_registration, f.callsign
    into v_airline, v_user, v_origin, v_destination, v_type, v_registration, v_callsign
  from public.flights f
  join public.airports o on o.id = f.origin_airport_id
  join public.airports d on d.id = f.destination_airport_id
  join public.aircraft_types t on t.id = f.aircraft_type_id
  where f.id = new.flight_id;
  if not found then
    raise exception 'No puedes importar un OFP para este vuelo' using errcode = '42501';
  end if;

  new.airline_id := v_airline;
  new.user_id := v_user;
  new.fetched_at := now();
  new.origin_icao := upper(btrim(new.origin_icao));
  new.destination_icao := upper(btrim(new.destination_icao));
  new.alternate_icao := nullif(upper(btrim(new.alternate_icao)), '');
  new.aircraft_icao := nullif(upper(btrim(new.aircraft_icao)), '');
  new.atc_callsign := nullif(upper(btrim(new.atc_callsign)), '');

  if new.origin_icao <> v_origin then
    v_issues := v_issues || jsonb_build_object('field', 'origin', 'expected', v_origin, 'actual', new.origin_icao, 'severity', 'high');
  end if;
  if new.destination_icao <> v_destination then
    v_issues := v_issues || jsonb_build_object('field', 'destination', 'expected', v_destination, 'actual', new.destination_icao, 'severity', 'high');
  end if;
  if new.aircraft_icao is distinct from v_type then
    v_issues := v_issues || jsonb_build_object('field', 'aircraft_type', 'expected', v_type, 'actual', new.aircraft_icao, 'severity', 'high');
  end if;
  if private.normalize_registration(new.registration) is distinct from private.normalize_registration(v_registration) then
    v_issues := v_issues || jsonb_build_object('field', 'registration', 'expected', v_registration, 'actual', new.registration, 'severity', 'low');
  end if;
  if new.atc_callsign is distinct from v_callsign then
    v_issues := v_issues || jsonb_build_object('field', 'callsign', 'expected', v_callsign, 'actual', new.atc_callsign, 'severity', 'low');
  end if;
  if new.generated_at is not null and new.generated_at < now() - interval '24 hours' then
    v_issues := v_issues || jsonb_build_object('field', 'generated_at', 'expected', 'menos de 24 h', 'actual', to_char(new.generated_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI"Z"'), 'severity', 'low');
  end if;

  new.mismatches := v_issues;
  return new;
end;
$$;

create trigger simbrief_ofps_set before insert or update on public.simbrief_ofps
  for each row execute function private.set_simbrief_ofp();
