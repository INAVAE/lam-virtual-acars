-- =============================================================================
-- LAM Virtual ACARS — Vuelo directo (sin ruta registrada)
--
-- Pedido de la operación: en Flight Booking, «Reservar un nuevo vuelo directo»
-- reserva origen, destino y número de vuelo sin buscar una ruta. Después el
-- piloto genera el plan en SimBrief y lo importa, como con cualquier reserva.
--
-- - airline_settings.allow_direct_flights (activado): la aerolínea lo permite.
--   El staff que administra la aerolínea siempre puede.
-- - book_direct_flight(..., p_register_route):
--     false → el vuelo queda sin ruta (route_id nulo), como los de eventos.
--     true  → registra la ruta con register_route (nace pendiente y se activa
--             con el primer PIREP aceptado que llegue al destino) y la reserva
--             con book_flight. Si la reserva falla, la ruta tampoco se guarda.
-- - direct_aircraft_options: aeronaves de la aerolínea con el motivo de
--   bloqueo para un vuelo directo (sin tipos de ruta; «en el origen» si aplica).
-- =============================================================================

alter table public.airline_settings
  add column allow_direct_flights boolean not null default true;
comment on column public.airline_settings.allow_direct_flights is
  'Los pilotos reservan vuelos directos (origen, destino y número de vuelo) sin una ruta registrada.';
grant update (allow_direct_flights) on public.airline_settings to authenticated;

create function public.direct_aircraft_options(p_airline_id uuid, p_origin_airport_id bigint default null)
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
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_airline_member(p_airline_id) then
    return;
  end if;
  return query
  select o.* from (
    select a.id, a.registration, a.fleet_number, a.aircraft_type_id, t.icao_code, t.model, a.status, ap.icao_code,
           private.program_aircraft_block_reason((select auth.uid()), p_airline_id, a.id, null, p_origin_airport_id)
      from public.aircraft a
      join public.aircraft_types t on t.id = a.aircraft_type_id
      left join public.airports ap on ap.id = coalesce(a.current_airport_id, a.base_airport_id)
     where a.airline_id = p_airline_id
  ) o (aircraft_id, registration, fleet_number, aircraft_type_id, type_icao, type_model, status, location_icao, block_reason)
  order by (o.block_reason is not null), o.type_icao, o.registration;
end;
$$;
revoke all on function public.direct_aircraft_options(uuid, bigint) from public, anon;
grant execute on function public.direct_aircraft_options(uuid, bigint) to authenticated;
comment on function public.direct_aircraft_options(uuid, bigint) is
  'Aeronaves de la aerolínea para un vuelo directo, con el motivo por el que quien llama no puede reservarlas (NULL si puede).';

create function public.book_direct_flight(
  p_airline_id uuid,
  p_flight_number text,
  p_origin_airport_id bigint,
  p_destination_airport_id bigint,
  p_aircraft_id uuid,
  p_callsign text,
  p_register_route boolean default false,
  p_operation_type text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_callsign text := upper(regexp_replace(coalesce(p_callsign, ''), '\s', '', 'g'));
  v_number text := upper(regexp_replace(coalesce(p_flight_number, ''), '\s', '', 'g'));
  v_airline public.airlines;
  v_open boolean;
  v_origin public.airports;
  v_dest public.airports;
  v_route uuid;
  v_result jsonb;
  v_reason text;
  v_type bigint;
  v_registration text;
  v_ac_operation text;
  v_operation text;
  v_cruise smallint;
  v_max smallint;
  v_hours smallint;
  v_active integer;
  v_expires timestamptz;
  v_distance integer;
  v_booking uuid;
  v_flight uuid;
begin
  if v_uid is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  select * into v_airline from public.airlines where id = p_airline_id;
  if not found or not v_airline.is_active or not private.is_airline_member(p_airline_id) then
    raise exception '%', private.booking_reason_message('not_member') using errcode = '42501', hint = 'not_member';
  end if;
  select s.allow_direct_flights into v_open from public.airline_settings s where s.airline_id = p_airline_id;
  if not coalesce(v_open, true) and not private.can_manage_airline(p_airline_id) then
    raise exception '% no permite reservar vuelos directos; reserva una ruta de la lista', v_airline.name
      using errcode = 'P0001', hint = 'direct_closed';
  end if;
  if v_callsign !~ '^[A-Z0-9]{3,10}$' then
    raise exception 'Callsign inválido: de 3 a 10 letras o números, sin espacios' using errcode = '22023', hint = 'invalid_callsign';
  end if;
  if v_number !~ '^[0-9]{1,4}[A-Z]?$' then
    raise exception '%', private.program_reason_message('invalid_flight_number') using errcode = '22023', hint = 'invalid_flight_number';
  end if;
  if p_operation_type is not null and p_operation_type not in ('passenger', 'cargo', 'mixed') then
    raise exception '%', private.route_reason_message('invalid_operation') using errcode = '22023', hint = 'invalid_operation';
  end if;
  select * into v_origin from public.airports where id = p_origin_airport_id;
  select * into v_dest from public.airports where id = p_destination_airport_id;
  if v_origin.id is null or v_dest.id is null then
    raise exception '%', private.route_reason_message('airport_not_found') using errcode = '22023', hint = 'airport_not_found';
  end if;
  if v_origin.id = v_dest.id then
    raise exception '%', private.route_reason_message('same_airport') using errcode = '22023', hint = 'same_airport';
  end if;

  -- Con registro: la ruta pendiente y la reserva normal de esa ruta, en la misma transacción.
  if p_register_route then
    v_route := public.register_route(p_airline_id, v_number, v_origin.id, v_dest.id, coalesce(p_operation_type, 'passenger'), null);
    v_result := public.book_flight(v_route, p_aircraft_id, v_callsign);
    return v_result || jsonb_build_object('route_id', v_route, 'route_registered', true);
  end if;

  perform private.expire_bookings();
  perform 1 from public.profiles where id = v_uid for update;
  select a.aircraft_type_id, a.registration, a.operation_type into v_type, v_registration, v_ac_operation
  from public.aircraft a where a.id = p_aircraft_id for update;
  v_reason := private.program_aircraft_block_reason(v_uid, p_airline_id, p_aircraft_id, null, v_origin.id);
  if v_reason is not null then
    raise exception '%', private.program_reason_message(v_reason) using errcode = 'P0001', hint = v_reason;
  end if;

  select s.max_active_bookings, s.booking_expiry_hours into v_max, v_hours
  from public.airline_settings s where s.airline_id = p_airline_id;
  select count(*) into v_active from public.flight_bookings b
  where b.user_id = v_uid and b.airline_id = p_airline_id and b.status = 'active';
  if v_active >= coalesce(v_max, 1) then
    raise exception 'Ya tienes % reserva(s) activa(s) en esta aerolínea; el máximo es %', v_active, coalesce(v_max, 1)
      using errcode = 'P0001', hint = 'max_bookings';
  end if;

  v_expires := now() + make_interval(hours => coalesce(v_hours, 24));
  v_distance := round(private.great_circle_nm(v_origin.latitude, v_origin.longitude, v_dest.latitude, v_dest.longitude))::integer;
  select t.cruise_speed_kts into v_cruise from public.aircraft_types t where t.id = v_type;
  v_operation := coalesce(p_operation_type, v_ac_operation, 'passenger');

  insert into public.flight_bookings (airline_id, user_id, route_id, aircraft_id, expires_at)
  values (p_airline_id, v_uid, null, p_aircraft_id, v_expires)
  returning id into v_booking;

  insert into public.flights (
    booking_id, airline_id, user_id, route_id, aircraft_id, aircraft_type_id, aircraft_registration,
    airline_icao, flight_number, callsign, origin_airport_id, destination_airport_id,
    planned_distance_nm, planned_minutes, scheduled_departure_at, operation_type, network, flight_plan_remarks
  ) values (
    v_booking, p_airline_id, v_uid, null, p_aircraft_id, v_type, v_registration,
    v_airline.icao_code, v_number, v_callsign, v_origin.id, v_dest.id,
    v_distance, least(32000, ceil(v_distance::numeric / coalesce(nullif(v_cruise, 0), 420) * 60) + 25)::smallint,
    null, v_operation, v_airline.network, v_airline.flight_plan_remarks
  )
  returning id into v_flight;

  update public.aircraft set status = 'assigned' where id = p_aircraft_id;
  return jsonb_build_object('booking_id', v_booking, 'flight_id', v_flight, 'expires_at', v_expires, 'route_registered', false);
end;
$$;
revoke all on function public.book_direct_flight(uuid, text, bigint, bigint, uuid, text, boolean, text) from public, anon;
grant execute on function public.book_direct_flight(uuid, text, bigint, bigint, uuid, text, boolean, text) to authenticated;
comment on function public.book_direct_flight(uuid, text, bigint, bigint, uuid, text, boolean, text) is
  'Reserva un vuelo directo (origen, destino y número de vuelo) sin ruta registrada; con p_register_route registra además la ruta pendiente.';
