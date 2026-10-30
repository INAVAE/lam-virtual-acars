-- =============================================================================
-- LAM Virtual ACARS — Fase 5 (2/3): generación, puntuación y revisión de PIREP
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Aceptación: suma block time y un ciclo a la aeronave.
-- Las horas del piloto no se guardan aparte: salen de sus PIREP aceptados.
-- -----------------------------------------------------------------------------
create function private.apply_pirep_acceptance(p_pirep public.pireps)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_pirep.aircraft_id is null then
    return;
  end if;
  update public.aircraft
     set total_minutes = total_minutes + p_pirep.block_minutes,
         cycles = cycles + case when p_pirep.landing_at is not null then 1 else 0 end,
         last_flight_at = greatest(last_flight_at, coalesce(p_pirep.block_on_at, p_pirep.created_at))
   where id = p_pirep.aircraft_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Construcción del PIREP a partir de la sesión completada (idempotente).
-- -----------------------------------------------------------------------------
create function private.build_pirep(p_session_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.flight_sessions;
  v_flight public.flights;
  v_settings public.airline_settings;
  v_existing uuid;
  v_pirep public.pireps;

  v_block_off record;
  v_block_on record;
  v_takeoff record;
  v_touchdown record;
  v_counts record;
  v_track record;
  v_engines_at_start boolean;

  v_block_minutes integer;
  v_block_estimated boolean := false;
  v_flight_minutes integer;
  v_fuel_used integer;
  v_vs integer;
  v_g numeric;
  v_pitch numeric;
  v_bank numeric;
  v_bounces integer;
  v_diverted boolean;
  v_hard_threshold numeric;

  r record;
  v_hit boolean;
  v_value numeric;
  v_findings jsonb := '[]'::jsonb;
  v_penalty integer := 0;
  v_critical boolean := false;
  v_score smallint;
  v_status public.pirep_status := 'pending';
begin
  select id into v_existing from public.pireps where session_id = p_session_id;
  if found then
    return v_existing;
  end if;

  select * into v_session from public.flight_sessions where id = p_session_id;
  if not found or v_session.status <> 'completed' then
    return null;
  end if;
  select * into v_flight from public.flights where id = v_session.flight_id;
  select * into v_settings from public.airline_settings where airline_id = v_flight.airline_id;

  -- Hitos del vuelo
  select e.occurred_at, nullif(e.data ->> 'fuel_kg', '')::numeric as fuel_kg into v_block_off
    from public.flight_events e where e.session_id = p_session_id and e.type = 'block_off'
   order by e.occurred_at, e.seq limit 1;
  select e.occurred_at, nullif(e.data ->> 'fuel_kg', '')::numeric as fuel_kg into v_block_on
    from public.flight_events e where e.session_id = p_session_id and e.type = 'block_on'
   order by e.occurred_at desc, e.seq desc limit 1;
  select e.occurred_at, e.data into v_takeoff
    from public.flight_events e where e.session_id = p_session_id and e.type = 'takeoff'
   order by e.occurred_at, e.seq limit 1;
  -- Aterrizaje final: el último contacto (después de un toque y despegue o un motor y al aire).
  select e.occurred_at, e.data into v_touchdown
    from public.flight_events e where e.session_id = p_session_id and e.type = 'touchdown'
   order by e.occurred_at desc, e.seq desc limit 1;

  select
    count(*) filter (where e.type = 'overspeed') as overspeed,
    count(*) filter (where e.type = 'stall') as stall,
    count(*) filter (where e.type = 'slew') as slew,
    count(*) filter (where e.type = 'crash') as crash,
    count(*) filter (where e.type = 'sim_paused') as paused,
    count(*) filter (where e.type = 'aircraft_changed') as aircraft_changed,
    count(*) filter (where e.type = 'phase_change' and e.data ->> 'reason' in ('go_around', 'touch_and_go')) as go_around,
    count(*) filter (where e.type = 'engine_start') as engine_starts
  into v_counts
  from public.flight_events e where e.session_id = p_session_id;

  v_engines_at_start := exists (
    select 1 from public.flight_events e
     where e.session_id = p_session_id and e.type = 'phase_change'
       and e.data ->> 'reason' = 'connected_on_ground'
       and e.data ->> 'to' in ('engines_started', 'taxi_out')
  );

  -- Traza: distancia recorrida, altitud máxima, rodaje y 250 kt bajo 10,000 ft.
  select
    coalesce(sum(private.great_circle_nm(t.prev_lat, t.prev_lon, t.latitude, t.longitude))
             filter (where t.prev_lat is not null), 0) as distance_nm,
    max(t.altitude_ft) as max_altitude_ft,
    max(t.gs_kt) filter (where t.on_ground and t.phase in ('taxi_out', 'taxi_in')) as max_taxi_gs,
    max(t.ias_kt) filter (where not t.on_ground and t.altitude_ft < 10000
                          and t.phase in ('initial_climb', 'climb', 'cruise', 'descent', 'approach')) as max_ias_below_fl100
  into v_track
  from (
    select p.latitude, p.longitude, p.altitude_ft, p.gs_kt, p.ias_kt, p.on_ground, p.phase,
           lag(p.latitude) over w as prev_lat, lag(p.longitude) over w as prev_lon
      from public.flight_track_points p
     where p.flight_id = v_flight.id and p.session_id = p_session_id
    window w as (order by p.seq)
  ) t;

  -- Tiempos y combustible
  v_block_minutes := round(extract(epoch from (
    coalesce(v_block_on.occurred_at, v_session.ended_at) - coalesce(v_block_off.occurred_at, v_session.started_at)
  )) / 60.0);
  v_block_estimated := v_block_off.occurred_at is null or v_block_on.occurred_at is null;
  v_block_minutes := greatest(coalesce(v_block_minutes, 0), 0);
  if v_takeoff.occurred_at is not null and v_touchdown.occurred_at is not null then
    v_flight_minutes := greatest(round(extract(epoch from (v_touchdown.occurred_at - v_takeoff.occurred_at)) / 60.0), 0);
  end if;
  if v_block_off.fuel_kg is not null and v_block_on.fuel_kg is not null then
    v_fuel_used := round(v_block_off.fuel_kg - v_block_on.fuel_kg);
  end if;

  -- Aterrizaje
  v_vs := round(nullif(v_touchdown.data ->> 'vs_fpm', '')::numeric);
  v_g := nullif(v_touchdown.data ->> 'g_force', '')::numeric;
  v_pitch := nullif(v_touchdown.data ->> 'pitch_deg', '')::numeric;
  v_bank := nullif(v_touchdown.data ->> 'bank_deg', '')::numeric;
  v_bounces := coalesce(nullif(v_touchdown.data ->> 'bounces', '')::integer, 0);
  v_diverted := v_session.final_airport_id is distinct from v_flight.destination_airport_id;

  -- Reglas de la aerolínea
  select s.threshold into v_hard_threshold
    from public.pirep_scoring_rules s
   where s.airline_id = v_flight.airline_id and s.rule_code = 'landing_hard' and s.enabled;

  for r in
    select s.rule_code, s.penalty, s.threshold, s.critical, d.label, d.threshold_unit
      from public.pirep_scoring_rules s
      join public.pirep_rule_definitions d on d.code = s.rule_code
     where s.airline_id = v_flight.airline_id and s.enabled
     order by d.sort_order
  loop
    v_hit := false;
    v_value := null;
    case r.rule_code
      when 'landing_hard' then
        v_value := v_vs;
        v_hit := v_vs <= -r.threshold;
      when 'landing_firm' then
        v_value := v_vs;
        v_hit := v_vs <= -r.threshold and (v_hard_threshold is null or v_vs > -v_hard_threshold);
      when 'landing_g' then
        v_value := v_g;
        v_hit := v_g > r.threshold;
      when 'landing_bounce' then
        v_value := v_bounces;
        v_hit := v_bounces > 0;
      when 'landing_pitch' then
        v_value := v_pitch;
        v_hit := v_pitch > r.threshold;
      when 'landing_bank' then
        v_value := v_bank;
        v_hit := abs(v_bank) > r.threshold;
      when 'speed_below_fl100' then
        v_value := v_track.max_ias_below_fl100;
        v_hit := v_track.max_ias_below_fl100 > r.threshold;
      when 'taxi_speed' then
        v_value := v_track.max_taxi_gs;
        v_hit := v_track.max_taxi_gs > r.threshold;
      when 'overspeed' then
        v_value := v_counts.overspeed;
        v_hit := v_counts.overspeed > 0;
      when 'stall' then
        v_value := v_counts.stall;
        v_hit := v_counts.stall > 0;
      when 'engines_at_start' then
        v_hit := v_engines_at_start;
      when 'sim_paused' then
        v_value := v_counts.paused;
        v_hit := v_counts.paused > 0;
      when 'go_around' then
        v_value := v_counts.go_around;
        v_hit := v_counts.go_around > 0;
      when 'aircraft_changed' then
        v_value := v_counts.aircraft_changed;
        v_hit := v_counts.aircraft_changed > 0;
      when 'diversion' then
        v_hit := v_diverted;
      when 'no_flight' then
        v_hit := v_takeoff.occurred_at is null or v_touchdown.occurred_at is null;
      when 'slew' then
        v_value := v_counts.slew;
        v_hit := v_counts.slew > 0;
      when 'crash' then
        v_value := v_counts.crash;
        v_hit := v_counts.crash > 0;
      else
        v_hit := false;
    end case;

    if coalesce(v_hit, false) then
      v_penalty := v_penalty + r.penalty;
      v_critical := v_critical or r.critical;
      v_findings := v_findings || jsonb_build_array(jsonb_build_object(
        'code', r.rule_code, 'label', r.label, 'penalty', r.penalty, 'critical', r.critical,
        'value', v_value, 'threshold', r.threshold, 'unit', r.threshold_unit));
    end if;
  end loop;

  v_score := greatest(0, 100 - v_penalty);
  if v_settings.auto_approve_pireps and v_score >= v_settings.pirep_min_score and not v_critical then
    v_status := 'accepted';
  end if;

  insert into public.pireps (
    flight_id, session_id, airline_id, user_id, aircraft_id, aircraft_type_id, aircraft_registration,
    callsign, flight_number, origin_airport_id, destination_airport_id, arrival_airport_id, diverted,
    block_off_at, takeoff_at, landing_at, block_on_at, block_minutes, flight_minutes,
    distance_nm, planned_distance_nm, fuel_used_kg, max_altitude_ft,
    landing_vs_fpm, landing_g, landing_bounces,
    score, findings, metrics, has_critical, status, auto_approved, reviewed_at
  ) values (
    v_flight.id, p_session_id, v_flight.airline_id, v_flight.user_id, v_flight.aircraft_id, v_flight.aircraft_type_id,
    v_flight.aircraft_registration, v_flight.callsign, v_flight.flight_number, v_flight.origin_airport_id,
    v_flight.destination_airport_id, v_session.final_airport_id, v_diverted,
    v_block_off.occurred_at, v_takeoff.occurred_at, v_touchdown.occurred_at, v_block_on.occurred_at,
    v_block_minutes, v_flight_minutes,
    round(v_track.distance_nm), v_flight.planned_distance_nm, v_fuel_used, v_track.max_altitude_ft,
    v_vs, round(v_g, 2), v_bounces,
    v_score, v_findings,
    jsonb_strip_nulls(jsonb_build_object(
      'block_estimated', v_block_estimated,
      'fuel_block_off_kg', round(v_block_off.fuel_kg),
      'fuel_block_on_kg', round(v_block_on.fuel_kg),
      'takeoff', v_takeoff.data,
      'touchdown', v_touchdown.data,
      'max_taxi_gs_kt', v_track.max_taxi_gs,
      'max_ias_below_fl100_kt', v_track.max_ias_below_fl100,
      'engines_running_at_start', v_engines_at_start,
      'engine_starts', v_counts.engine_starts,
      'pauses', v_counts.paused,
      'go_arounds', v_counts.go_around,
      'sim_aircraft_title', v_session.sim_aircraft_title,
      'sim_aircraft_icao', v_session.sim_aircraft_icao,
      'client_version', v_session.client_version
    )),
    v_critical, v_status, v_status = 'accepted',
    case when v_status = 'accepted' then now() end
  )
  on conflict (session_id) do nothing
  returning * into v_pirep;

  if v_pirep.id is null then
    select id into v_existing from public.pireps where session_id = p_session_id;
    return v_existing;
  end if;

  if v_pirep.status = 'accepted' then
    perform private.apply_pirep_acceptance(v_pirep);
  end if;
  return v_pirep.id;
end;
$$;

-- Respaldo: sesiones completadas sin PIREP (si la generación falló al cerrar).
create function private.build_missing_pireps()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_id uuid;
begin
  for v_id in
    select s.id from public.flight_sessions s
     where s.status = 'completed'
       and not exists (select 1 from public.pireps p where p.session_id = s.id)
     order by s.ended_at
  loop
    begin
      perform private.build_pirep(v_id);
      v_count := v_count + 1;
    exception when others then
      raise warning 'PIREP de la sesión % no generado: %', v_id, sqlerrm;
    end;
  end loop;
  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Cierre de sesión: ahora genera el PIREP del vuelo completado.
-- -----------------------------------------------------------------------------
create or replace function public.acars_session_end(
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
  v_pirep public.pireps;
  v_pirep_id uuid;
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
    select * into v_pirep from public.pireps where session_id = v_session.id;
    return jsonb_build_object('status', v_session.status, 'already_closed', true,
      'pirep', case when v_pirep.id is not null then jsonb_build_object('id', v_pirep.id, 'score', v_pirep.score, 'status', v_pirep.status) end);
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

  if p_reason = 'completed' then
    -- Un error al generar el PIREP no debe impedir el cierre: la tarea de respaldo lo reintenta.
    begin
      v_pirep_id := private.build_pirep(v_session.id);
      select * into v_pirep from public.pireps where id = v_pirep_id;
    exception when others then
      raise warning 'PIREP de la sesión % no generado: %', v_session.id, sqlerrm;
    end;
  end if;

  return jsonb_build_object(
    'status', p_reason,
    'flight_id', v_flight.id,
    'final_airport', (select icao_code from public.airports where id = v_airport),
    'pirep', case when v_pirep.id is not null then jsonb_build_object('id', v_pirep.id, 'score', v_pirep.score, 'status', v_pirep.status) end
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Revisión y comentarios (web)
-- -----------------------------------------------------------------------------
create function public.review_pirep(p_pirep_id uuid, p_decision public.pirep_status, p_comment text default null)
returns public.pireps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_pirep public.pireps;
  v_comment text := nullif(btrim(p_comment), '');
begin
  if v_uid is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  if p_decision not in ('accepted', 'rejected') then
    raise exception 'La decisión debe ser aceptar o rechazar' using errcode = '22023', hint = 'bad_decision';
  end if;

  select * into v_pirep from public.pireps where id = p_pirep_id for update;
  if not found or not private.can_staff_airline(v_pirep.airline_id) then
    raise exception 'PIREP no encontrado o sin permiso para revisarlo' using errcode = '42501', hint = 'not_allowed';
  end if;
  if v_pirep.user_id = v_uid and not private.is_org_admin() then
    raise exception 'No puedes revisar tu propio PIREP' using errcode = '42501', hint = 'own_pirep';
  end if;
  if v_pirep.status <> 'pending' then
    raise exception 'Este PIREP ya fue revisado' using errcode = '55000', hint = 'already_reviewed';
  end if;
  if p_decision = 'rejected' and v_comment is null then
    raise exception 'Escribe el motivo del rechazo' using errcode = '22023', hint = 'comment_required';
  end if;
  if char_length(v_comment) > 2000 then
    raise exception 'El comentario es demasiado largo' using errcode = '22001', hint = 'comment_too_long';
  end if;

  update public.pireps
     set status = p_decision, review_comment = v_comment, reviewed_by = v_uid, reviewed_at = now()
   where id = p_pirep_id
  returning * into v_pirep;

  if p_decision = 'accepted' then
    perform private.apply_pirep_acceptance(v_pirep);
  end if;
  return v_pirep;
end;
$$;
comment on function public.review_pirep(uuid, public.pirep_status, text) is
  'Acepta o rechaza un PIREP pendiente (jefe de operaciones o administrador de la aerolínea). Aceptar suma block time y ciclo a la aeronave.';

create function public.comment_pirep(p_pirep_id uuid, p_comment text)
returns public.pireps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_pirep public.pireps;
  v_comment text := nullif(btrim(p_comment), '');
begin
  select * into v_pirep from public.pireps where id = p_pirep_id for update;
  if not found or v_pirep.user_id is distinct from v_uid then
    raise exception 'PIREP no encontrado' using errcode = '42501', hint = 'not_allowed';
  end if;
  if v_pirep.status <> 'pending' then
    raise exception 'Solo puedes comentar un PIREP pendiente de revisión' using errcode = '55000', hint = 'already_reviewed';
  end if;
  if char_length(v_comment) > 2000 then
    raise exception 'El comentario es demasiado largo' using errcode = '22001', hint = 'comment_too_long';
  end if;

  update public.pireps set pilot_comment = v_comment where id = p_pirep_id returning * into v_pirep;
  return v_pirep;
end;
$$;
comment on function public.comment_pirep(uuid, text) is 'El piloto agrega o cambia su comentario mientras el PIREP espera revisión.';

-- -----------------------------------------------------------------------------
-- Estadísticas del piloto (por aerolínea). Respeta la RLS de pireps.
-- -----------------------------------------------------------------------------
create view public.pilot_statistics
with (security_invoker = true)
as
select
  p.airline_id,
  p.user_id,
  count(*)::integer as pireps_total,
  count(*) filter (where p.status = 'accepted')::integer as pireps_accepted,
  count(*) filter (where p.status = 'pending')::integer as pireps_pending,
  count(*) filter (where p.status = 'rejected')::integer as pireps_rejected,
  coalesce(sum(p.block_minutes) filter (where p.status = 'accepted'), 0)::integer as block_minutes,
  coalesce(sum(p.flight_minutes) filter (where p.status = 'accepted'), 0)::integer as flight_minutes,
  coalesce(sum(p.distance_nm) filter (where p.status = 'accepted'), 0)::integer as distance_nm,
  coalesce(sum(p.fuel_used_kg) filter (where p.status = 'accepted' and p.fuel_used_kg > 0), 0)::integer as fuel_used_kg,
  round(avg(p.score) filter (where p.status = 'accepted'), 1) as average_score,
  round(avg(p.landing_vs_fpm) filter (where p.status = 'accepted'))::integer as average_landing_vs_fpm,
  max(p.landing_vs_fpm) filter (where p.status = 'accepted') as best_landing_vs_fpm,
  max(coalesce(p.block_on_at, p.created_at)) as last_flight_at
from public.pireps p
group by p.airline_id, p.user_id;
comment on view public.pilot_statistics is
  'Horas, ciclos, distancia y promedios por piloto y aerolínea, a partir de los PIREP (solo aceptados para los totales).';
