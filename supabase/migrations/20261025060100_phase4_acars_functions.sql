-- =============================================================================
-- LAM Virtual ACARS — Fase 4 (2/3): vinculación, sesiones e ingesta
--
-- Las funciones acars_* reciben el hash SHA-256 del token del dispositivo (lo
-- calcula la Edge Function) y solo las puede ejecutar service_role. Los
-- errores llevan un código estable en HINT que la Edge Function traduce a HTTP.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Utilidades
-- -----------------------------------------------------------------------------
create function private.acars_error(p_code text, p_message text, p_errcode text default 'P0001')
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', p_message using errcode = p_errcode, hint = p_code;
end;
$$;

-- Código de 8 caracteres sin letras ni números ambiguos (sin I, O, 0, 1).
create function private.new_link_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(8);
  v_code text := '';
  i integer;
begin
  for i in 0..7 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v_code;
end;
$$;

-- Aeropuerto más cercano a un punto (dentro de p_max_nm), o NULL.
create function private.nearest_airport(p_lat double precision, p_lon double precision, p_max_nm double precision default 10)
returns bigint
language sql
stable
set search_path = ''
as $$
  select a.id
  from public.airports a
  where a.latitude between p_lat - (p_max_nm / 60.0) and p_lat + (p_max_nm / 60.0)
    and private.great_circle_nm(p_lat, p_lon, a.latitude, a.longitude) <= p_max_nm
  order by private.great_circle_nm(p_lat, p_lon, a.latitude, a.longitude)
  limit 1;
$$;

-- Dispositivo válido para el token. Cuenta la llamada contra el límite por minuto.
create function private.acars_device(p_token_hash text, p_cost integer default 1)
returns public.acars_devices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.acars_devices;
  v_limit constant integer := 240;
begin
  select * into v_device from public.acars_devices where token_hash = p_token_hash for update;
  if not found then
    perform private.acars_error('invalid_token', 'Token de dispositivo no válido', '28000');
  end if;
  if v_device.revoked_at is not null then
    perform private.acars_error('device_revoked', 'Este dispositivo fue revocado; vincúlalo de nuevo', '28000');
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_device.user_id and p.account_status = 'active') then
    perform private.acars_error('account_suspended', 'La cuenta del piloto está suspendida', '28000');
  end if;

  if v_device.rate_window_start < now() - interval '1 minute' then
    v_device.rate_window_start := now();
    v_device.rate_count := p_cost;
  else
    v_device.rate_count := v_device.rate_count + p_cost;
  end if;
  if v_device.rate_count > v_limit then
    perform private.acars_error('rate_limited', 'Demasiadas solicitudes; espera un minuto');
  end if;

  update public.acars_devices
     set last_used_at = now(), rate_window_start = v_device.rate_window_start, rate_count = v_device.rate_count
   where id = v_device.id;
  return v_device;
end;
$$;

-- Sesión activa del dispositivo/piloto. Actualiza el último contacto.
create function private.acars_active_session(p_device public.acars_devices, p_session_id uuid)
returns public.flight_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.flight_sessions;
begin
  select * into v_session from public.flight_sessions where id = p_session_id and user_id = p_device.user_id;
  if not found then
    perform private.acars_error('session_not_found', 'Sesión no encontrada', 'P0002');
  end if;
  if v_session.status <> 'active' then
    perform private.acars_error('session_closed', 'La sesión ya terminó');
  end if;
  update public.flight_sessions
     set last_contact_at = now(), device_id = p_device.id
   where id = v_session.id;
  return v_session;
end;
$$;

-- -----------------------------------------------------------------------------
-- Vinculación
-- -----------------------------------------------------------------------------
create function public.acars_link_start(p_device_name text, p_app_version text, p_poll_secret_hash text, p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_expires timestamptz;
begin
  if p_ip_hash is not null and (
    select count(*) from public.acars_link_codes where ip_hash = p_ip_hash and created_at > now() - interval '1 hour'
  ) >= 20 then
    perform private.acars_error('rate_limited', 'Demasiados códigos solicitados desde esta red; espera una hora');
  end if;

  loop
    v_code := private.new_link_code();
    exit when not exists (select 1 from public.acars_link_codes where code = v_code);
  end loop;

  insert into public.acars_link_codes (code, poll_secret_hash, device_name, app_version, ip_hash)
  values (v_code, p_poll_secret_hash, left(btrim(p_device_name), 60), left(p_app_version, 40), p_ip_hash)
  returning expires_at into v_expires;

  return jsonb_build_object('code', v_code, 'expires_at', v_expires, 'poll_interval_s', 3);
end;
$$;

-- El piloto, con sesión en la web, confirma el código que ve en el conector.
create function public.approve_acars_link(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_link public.acars_link_codes;
begin
  if v_uid is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;

  select * into v_link from public.acars_link_codes where code = v_code for update;
  if not found or v_link.status <> 'pending' or v_link.expires_at <= now() then
    raise exception 'El código no existe, ya se usó o venció. Pide uno nuevo en el conector.'
      using errcode = 'P0002', hint = 'link_invalid';
  end if;

  update public.acars_link_codes
     set status = 'approved', user_id = v_uid, approved_at = now()
   where id = v_link.id;

  return jsonb_build_object('device_name', v_link.device_name);
end;
$$;

-- El conector consulta hasta que el piloto confirma; entonces recibe su token
-- (lo genera la Edge Function, aquí solo se guarda su hash).
create function public.acars_link_poll(p_code text, p_poll_secret_hash text, p_token_hash text, p_token_prefix text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link public.acars_link_codes;
  v_device uuid;
  v_name text;
  v_number integer;
begin
  select * into v_link from public.acars_link_codes where code = upper(p_code) for update;
  if not found or v_link.poll_secret_hash <> p_poll_secret_hash then
    perform private.acars_error('link_invalid', 'Código de vinculación no válido', 'P0002');
  end if;
  if v_link.status = 'consumed' then
    perform private.acars_error('link_used', 'Este código ya se usó');
  end if;
  if v_link.status = 'pending' then
    if v_link.expires_at <= now() then
      perform private.acars_error('link_expired', 'El código venció; pide uno nuevo');
    end if;
    return jsonb_build_object('status', 'pending');
  end if;

  insert into public.acars_devices (user_id, name, token_hash, token_prefix, app_version, last_used_at)
  values (v_link.user_id, v_link.device_name, p_token_hash, p_token_prefix, v_link.app_version, now())
  returning id into v_device;

  update public.acars_link_codes
     set status = 'consumed', consumed_at = now(), device_id = v_device
   where id = v_link.id;

  select display_name, pilot_number into v_name, v_number from public.profiles where id = v_link.user_id;
  return jsonb_build_object(
    'status', 'approved',
    'device_id', v_device,
    'pilot', jsonb_build_object('display_name', v_name, 'pilot_number', v_number)
  );
end;
$$;

-- El piloto revoca sus dispositivos; un superadministrador, cualquiera.
create function public.revoke_acars_device(p_device_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  update public.acars_devices
     set revoked_at = now(), revoked_by = v_uid
   where id = p_device_id
     and revoked_at is null
     and (user_id = v_uid or private.is_org_admin());
  if not found then
    raise exception 'Dispositivo no encontrado o ya revocado' using errcode = 'P0002';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Piloto y vuelos disponibles para el conector
-- -----------------------------------------------------------------------------
create function private.acars_flight_json(p_flight_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'flight_id', f.id,
    'status', f.status,
    'airline', jsonb_build_object('name', al.name, 'icao', f.airline_icao),
    'flight_number', f.flight_number,
    'callsign', f.callsign,
    'origin', jsonb_build_object('icao', o.icao_code, 'name', o.name, 'latitude', o.latitude, 'longitude', o.longitude, 'elevation_ft', o.elevation_ft),
    'destination', jsonb_build_object('icao', d.icao_code, 'name', d.name, 'latitude', d.latitude, 'longitude', d.longitude, 'elevation_ft', d.elevation_ft),
    'aircraft', jsonb_build_object('icao', t.icao_code, 'model', t.model, 'registration', f.aircraft_registration),
    'planned_distance_nm', f.planned_distance_nm,
    'planned_minutes', f.planned_minutes,
    'scheduled_departure_at', f.scheduled_departure_at,
    'network', f.network,
    'flight_plan_remarks', f.flight_plan_remarks,
    'booking_expires_at', b.expires_at,
    'has_ofp', o2.flight_id is not null,
    'ofp', case when o2.flight_id is null then null else jsonb_build_object(
      'route', o2.route, 'cruise_altitude_ft', o2.cruise_altitude_ft, 'block_fuel', o2.block_fuel,
      'fuel_units', o2.fuel_units, 'alternate_icao', o2.alternate_icao, 'est_enroute_minutes', o2.est_enroute_minutes
    ) end
  )
  from public.flights f
  join public.airlines al on al.id = f.airline_id
  join public.airports o on o.id = f.origin_airport_id
  join public.airports d on d.id = f.destination_airport_id
  join public.aircraft_types t on t.id = f.aircraft_type_id
  left join public.flight_bookings b on b.id = f.booking_id
  left join public.simbrief_ofps o2 on o2.flight_id = f.id
  where f.id = p_flight_id;
$$;

create function public.acars_me(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.acars_devices := private.acars_device(p_token_hash);
  v_profile public.profiles;
  v_active jsonb;
begin
  select * into v_profile from public.profiles where id = v_device.user_id;

  select jsonb_build_object('session_id', s.id, 'flight_id', s.flight_id, 'phase', s.phase)
    into v_active
  from public.flight_sessions s
  where s.user_id = v_device.user_id and s.status = 'active';

  return jsonb_build_object(
    'device', jsonb_build_object('id', v_device.id, 'name', v_device.name),
    'pilot', jsonb_build_object('display_name', v_profile.display_name, 'pilot_number', v_profile.pilot_number),
    'active_session', v_active,
    'flights', coalesce((
      select jsonb_agg(private.acars_flight_json(f.id) order by f.scheduled_departure_at nulls last, f.created_at)
      from public.flights f
      left join public.flight_bookings b on b.id = f.booking_id
      where f.user_id = v_device.user_id
        and (f.status = 'in_progress' or (f.status = 'scheduled' and b.status = 'active' and b.expires_at > now()))
    ), '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Sesión
-- -----------------------------------------------------------------------------
create function public.acars_session_start(
  p_token_hash text,
  p_flight_id uuid,
  p_sim_title text,
  p_sim_icao text,
  p_sim_registration text,
  p_client_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.acars_devices := private.acars_device(p_token_hash);
  v_flight public.flights;
  v_booking public.flight_bookings;
  v_session public.flight_sessions;
  v_resumed boolean := false;
begin
  select * into v_flight from public.flights where id = p_flight_id and user_id = v_device.user_id for update;
  if not found then
    perform private.acars_error('flight_not_found', 'Vuelo no encontrado', 'P0002');
  end if;

  select * into v_session from public.flight_sessions where flight_id = v_flight.id;
  if found and v_session.status = 'active' then
    -- Reanudar (reinicio del conector o cambio de equipo del mismo piloto).
    update public.flight_sessions
       set device_id = v_device.id, last_contact_at = now(),
           sim_aircraft_title = coalesce(left(p_sim_title, 256), sim_aircraft_title),
           sim_aircraft_icao = coalesce(left(p_sim_icao, 8), sim_aircraft_icao),
           sim_registration = coalesce(left(p_sim_registration, 16), sim_registration),
           client_version = coalesce(left(p_client_version, 40), client_version)
     where id = v_session.id
    returning * into v_session;
    v_resumed := true;
  elsif found then
    perform private.acars_error('session_closed', 'Este vuelo ya tuvo una sesión ACARS cerrada');
  else
    if v_flight.status <> 'scheduled' then
      perform private.acars_error('flight_not_available', 'El vuelo no está reservado');
    end if;
    select * into v_booking from public.flight_bookings where id = v_flight.booking_id;
    if v_booking.status is distinct from 'active' or v_booking.expires_at <= now() then
      perform private.acars_error('booking_inactive', 'La reserva venció o fue cancelada');
    end if;
    if not private.user_is_active_member(v_flight.airline_id, v_device.user_id) then
      perform private.acars_error('not_member', 'Tu membresía en la aerolínea no está activa', '42501');
    end if;
    if not exists (select 1 from public.simbrief_ofps where flight_id = v_flight.id) then
      perform private.acars_error('ofp_required', 'Importa el plan de SimBrief en My Flights antes de iniciar ACARS');
    end if;
    if exists (select 1 from public.flight_sessions where user_id = v_device.user_id and status = 'active') then
      perform private.acars_error('other_session_active', 'Ya tienes otro vuelo en curso; termínalo primero');
    end if;

    insert into public.flight_sessions (
      flight_id, device_id, user_id, airline_id, sim_aircraft_title, sim_aircraft_icao, sim_registration, client_version
    ) values (
      v_flight.id, v_device.id, v_device.user_id, v_flight.airline_id,
      left(p_sim_title, 256), left(p_sim_icao, 8), left(p_sim_registration, 16), left(p_client_version, 40)
    )
    returning * into v_session;

    update public.flights set status = 'in_progress', started_at = now() where id = v_flight.id;
    update public.aircraft set status = 'in_flight' where id = v_flight.aircraft_id and status = 'assigned';
  end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'resumed', v_resumed,
    'phase', v_session.phase,
    'last_event_seq', (select max(seq) from public.flight_events where flight_id = v_flight.id),
    'last_point_seq', (select max(seq) from public.flight_track_points where flight_id = v_flight.id),
    'flight', private.acars_flight_json(v_flight.id),
    'config', jsonb_build_object('position_interval_s', 10, 'track_batch_interval_s', 60, 'max_points_per_batch', 600, 'max_events_per_call', 50)
  );
end;
$$;

-- Posición viva: solo reemplaza si la muestra es más nueva.
create function public.acars_position(p_token_hash text, p_session_id uuid, p_position jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.acars_devices := private.acars_device(p_token_hash);
  v_session public.flight_sessions := private.acars_active_session(v_device, p_session_id);
  v_phase text := p_position ->> 'phase';
begin
  insert into public.flight_positions_live (
    flight_id, session_id, user_id, airline_id, sampled_at, latitude, longitude, altitude_ft, agl_ft,
    ias_kt, gs_kt, heading_deg, vs_fpm, on_ground, phase, updated_at
  ) values (
    v_session.flight_id, v_session.id, v_session.user_id, v_session.airline_id,
    (p_position ->> 'sampled_at')::timestamptz,
    (p_position ->> 'latitude')::double precision,
    (p_position ->> 'longitude')::double precision,
    round((p_position ->> 'altitude_ft')::numeric)::integer,
    round((p_position ->> 'agl_ft')::numeric)::integer,
    round((p_position ->> 'ias_kt')::numeric)::smallint,
    round((p_position ->> 'gs_kt')::numeric)::smallint,
    round((p_position ->> 'heading_deg')::numeric)::smallint % 361,
    round((p_position ->> 'vs_fpm')::numeric)::integer,
    coalesce((p_position ->> 'on_ground')::boolean, false),
    v_phase,
    now()
  )
  on conflict (flight_id) do update set
    session_id = excluded.session_id, sampled_at = excluded.sampled_at, latitude = excluded.latitude,
    longitude = excluded.longitude, altitude_ft = excluded.altitude_ft, agl_ft = excluded.agl_ft,
    ias_kt = excluded.ias_kt, gs_kt = excluded.gs_kt, heading_deg = excluded.heading_deg,
    vs_fpm = excluded.vs_fpm, on_ground = excluded.on_ground, phase = excluded.phase, updated_at = now()
  where public.flight_positions_live.sampled_at < excluded.sampled_at;

  if v_phase is distinct from v_session.phase then
    update public.flight_sessions set phase = v_phase where id = v_session.id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- Lote de traza: idempotente por (vuelo, secuencia, instante).
create function public.acars_track_batch(p_token_hash text, p_session_id uuid, p_points jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := jsonb_array_length(p_points);
  v_device public.acars_devices := private.acars_device(p_token_hash, greatest(1, v_count / 100));
  v_session public.flight_sessions := private.acars_active_session(v_device, p_session_id);
  v_inserted integer;
begin
  if v_count > 600 then
    perform private.acars_error('batch_too_large', 'Máximo 600 puntos por lote', '22023');
  end if;

  insert into public.flight_track_points (
    flight_id, seq, sampled_at, session_id, user_id, airline_id, latitude, longitude, altitude_ft,
    gs_kt, ias_kt, vs_fpm, heading_deg, on_ground, phase
  )
  select
    v_session.flight_id, (p ->> 'seq')::integer, (p ->> 'sampled_at')::timestamptz, v_session.id,
    v_session.user_id, v_session.airline_id, (p ->> 'latitude')::double precision, (p ->> 'longitude')::double precision,
    round((p ->> 'altitude_ft')::numeric)::integer, round((p ->> 'gs_kt')::numeric)::smallint,
    round((p ->> 'ias_kt')::numeric)::smallint, round((p ->> 'vs_fpm')::numeric)::integer,
    round((p ->> 'heading_deg')::numeric)::smallint % 361, coalesce((p ->> 'on_ground')::boolean, false), p ->> 'phase'
  from jsonb_array_elements(p_points) as p
  on conflict do nothing;
  get diagnostics v_inserted = row_count;

  return jsonb_build_object('received', v_count, 'inserted', v_inserted, 'duplicates', v_count - v_inserted);
end;
$$;

-- Eventos: idempotentes por id (UUID del cliente) y por secuencia.
create function public.acars_events(p_token_hash text, p_session_id uuid, p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := jsonb_array_length(p_events);
  v_device public.acars_devices := private.acars_device(p_token_hash, greatest(1, v_count / 10));
  v_session public.flight_sessions := private.acars_active_session(v_device, p_session_id);
  v_inserted integer;
  v_last_phase text;
begin
  if v_count > 50 then
    perform private.acars_error('batch_too_large', 'Máximo 50 eventos por envío', '22023');
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_events) e
    where (e ->> 'occurred_at')::timestamptz > now() + interval '5 minutes'
  ) then
    perform private.acars_error('clock_skew', 'La hora del equipo está adelantada; sincroniza el reloj de Windows', '22023');
  end if;

  insert into public.flight_events (
    id, flight_id, session_id, user_id, airline_id, seq, type, phase, occurred_at, latitude, longitude, altitude_ft, data
  )
  select
    (e ->> 'id')::uuid, v_session.flight_id, v_session.id, v_session.user_id, v_session.airline_id,
    (e ->> 'seq')::integer, e ->> 'type', e ->> 'phase', (e ->> 'occurred_at')::timestamptz,
    (e ->> 'latitude')::double precision, (e ->> 'longitude')::double precision,
    round((e ->> 'altitude_ft')::numeric)::integer, coalesce(e -> 'data', '{}'::jsonb)
  from jsonb_array_elements(p_events) as e
  on conflict do nothing;
  get diagnostics v_inserted = row_count;

  -- La fase de la sesión sigue al último cambio de fase recibido (por secuencia).
  select ev.data ->> 'to' into v_last_phase
  from public.flight_events ev
  where ev.flight_id = v_session.flight_id and ev.type = 'phase_change'
  order by ev.seq desc
  limit 1;
  if v_last_phase is not null and private.is_flight_phase(v_last_phase) and v_last_phase is distinct from v_session.phase then
    update public.flight_sessions set phase = v_last_phase where id = v_session.id;
  end if;

  return jsonb_build_object('received', v_count, 'inserted', v_inserted, 'duplicates', v_count - v_inserted);
end;
$$;

-- Cierre: completed (vuelo terminado) o aborted (el piloto abandona).
create function public.acars_session_end(
  p_token_hash text,
  p_session_id uuid,
  p_reason text,
  p_latitude double precision,
  p_longitude double precision
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.acars_devices := private.acars_device(p_token_hash);
  v_session public.flight_sessions;
  v_flight public.flights;
  v_airport bigint;
begin
  if p_reason not in ('completed', 'aborted') then
    perform private.acars_error('bad_request', 'Motivo de cierre no válido', '22023');
  end if;

  select * into v_session from public.flight_sessions where id = p_session_id and user_id = v_device.user_id for update;
  if not found then
    perform private.acars_error('session_not_found', 'Sesión no encontrada', 'P0002');
  end if;
  if v_session.status <> 'active' then
    -- Reintento del cierre: responder igual.
    return jsonb_build_object('status', v_session.status, 'already_closed', true);
  end if;

  select * into v_flight from public.flights where id = v_session.flight_id for update;
  if p_latitude is not null and p_longitude is not null then
    v_airport := private.nearest_airport(p_latitude, p_longitude, 10);
  end if;

  update public.flight_sessions
     set status = p_reason, end_reason = p_reason, ended_at = now(), last_contact_at = now(),
         device_id = v_device.id, final_airport_id = v_airport,
         phase = case when p_reason = 'completed' then 'flight_completed' else phase end
   where id = v_session.id;

  if p_reason = 'completed' then
    update public.flights set status = 'completed', completed_at = now() where id = v_flight.id;
    update public.flight_bookings
       set status = 'completed', closed_at = now(), closed_by = v_device.user_id
     where id = v_flight.booking_id and status = 'active';
  else
    update public.flights set status = 'cancelled', cancelled_at = now() where id = v_flight.id;
    update public.flight_bookings
       set status = 'cancelled', closed_at = now(), closed_by = v_device.user_id
     where id = v_flight.booking_id and status = 'active';
  end if;

  update public.aircraft
     set status = 'available',
         current_airport_id = coalesce(v_airport, current_airport_id),
         last_flight_at = case when p_reason = 'completed' then now() else last_flight_at end
   where id = v_flight.aircraft_id and status in ('assigned', 'in_flight');

  return jsonb_build_object(
    'status', p_reason,
    'flight_id', v_flight.id,
    'final_airport', (select icao_code from public.airports where id = v_airport)
  );
end;
$$;
