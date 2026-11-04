-- =============================================================================
-- LAM Virtual ACARS — Carga de combustible antes y después del pushback
--
-- Antes, el resumen de combustible sumaba como "carga" toda subida de la traza,
-- incluida la carga normal en tierra (PIREP-2026-00006: el A340 arrancó con
-- 19,318 kg y el piloto cargó a 79,118 kg 12 min antes de los calzos fuera; el
-- PIREP mostraba "carga de 59,800 kg" como si fuera una anomalía).
--
-- Ahora:
--   preflight_loaded_kg  subidas antes de los calzos fuera (normal, informativo)
--   refueled_kg          subidas después de los calzos fuera (anomalía)
--   before_engines_kg    solo lo que bajó antes del primer arranque (APU)
-- y la regla nueva fuel_added_after_pushback (activa, 20 puntos, falta grave:
-- el PIREP va a revisión) con umbral de 100 kg para tolerar el ruido del
-- indicador. Los PIREP existentes recalculan su resumen de combustible; su
-- puntaje y sus faltas no cambian.
-- =============================================================================

create or replace function private.pirep_fuel_metrics(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.flight_sessions;
  v_ofp public.simbrief_ofps;
  v_factor numeric;
  v_off numeric;
  v_takeoff numeric;
  v_landing numeric;
  v_on numeric;
  v_landing_at timestamptz;
  v_samples integer;
  v_refuel numeric;
  v_preflight numeric;
  v_off_at timestamptz;
  v_stages jsonb;
  v_plan jsonb;
  v_first_engine timestamptz;
  v_before_engines numeric;
  n record;
  v_apu_since timestamptz;
  v_apu_first timestamptz;
  v_apu_last_stop timestamptz;
  v_apu_secs numeric := 0;
  v_apu_starts integer := 0;
  v_apu_at_start boolean := false;
  v_apu jsonb;
begin
  select * into v_session from public.flight_sessions where id = p_session_id;
  if not found then
    return null;
  end if;

  select nullif(e.data ->> 'fuel_kg', '')::numeric, e.occurred_at into v_off, v_off_at
    from public.flight_events e where e.session_id = p_session_id and e.type = 'block_off'
   order by e.occurred_at, e.seq limit 1;
  select nullif(e.data ->> 'fuel_kg', '')::numeric into v_takeoff
    from public.flight_events e where e.session_id = p_session_id and e.type = 'takeoff'
   order by e.occurred_at, e.seq limit 1;
  select nullif(e.data ->> 'fuel_kg', '')::numeric, e.occurred_at into v_landing, v_landing_at
    from public.flight_events e where e.session_id = p_session_id and e.type = 'touchdown'
   order by e.occurred_at desc, e.seq desc limit 1;
  select nullif(e.data ->> 'fuel_kg', '')::numeric into v_on
    from public.flight_events e where e.session_id = p_session_id and e.type = 'block_on'
   order by e.occurred_at desc, e.seq desc limit 1;

  -- Sin el dato en el contacto (conectores anteriores), el punto de traza más cercano.
  if v_landing is null and v_landing_at is not null then
    select p.fuel_kg into v_landing
      from public.flight_track_points p
     where p.flight_id = v_session.flight_id and p.session_id = p_session_id and p.fuel_kg is not null
     order by abs(extract(epoch from p.sampled_at - v_landing_at))
     limit 1;
  end if;

  -- Consumo por etapa con la traza (cada tramo se asigna a la etapa del punto final).
  with pts as (
    select p.fuel_kg, p.phase, p.sampled_at,
           lag(p.fuel_kg) over w as prev_fuel, lag(p.sampled_at) over w as prev_at
      from public.flight_track_points p
     where p.flight_id = v_session.flight_id and p.session_id = p_session_id and p.fuel_kg is not null
    window w as (order by p.seq)
  ), legs as (
    select case
             when phase in ('takeoff', 'initial_climb', 'climb') then 'climb'
             when phase = 'cruise' then 'cruise'
             when phase in ('descent', 'approach', 'landing') then 'descent'
             when phase in ('taxi_in', 'engines_shutdown', 'flight_completed') then 'taxi_in'
             else 'taxi_out'
           end as stage,
           prev_fuel - fuel_kg as delta,
           extract(epoch from sampled_at - prev_at) as secs,
           sampled_at
      from pts
     where prev_fuel is not null
  ), by_stage as (
    select stage, sum(greatest(delta, 0)) as kg, sum(secs) as secs
      from legs group by stage
  )
  select
    (select count(*) from pts),
    -- Cargas de combustible (subidas de más de 50 kg entre dos puntos): antes de
    -- los calzos fuera son la carga normal del vuelo; después, una anomalía.
    (select coalesce(sum(-delta), 0) from legs where delta < -50 and v_off_at is not null and sampled_at > v_off_at),
    (select coalesce(sum(-delta), 0) from legs where delta < -50 and (v_off_at is null or sampled_at <= v_off_at)),
    (select jsonb_object_agg(stage, jsonb_build_object(
        'kg', round(kg),
        'minutes', round(secs / 60.0, 1),
        'kg_per_hour', case when secs >= 60 then round(kg / (secs / 3600.0)) end))
       from by_stage)
  into v_samples, v_refuel, v_preflight, v_stages;

  -- Combustible gastado antes del primer arranque de motor (APU, normalmente).
  select min(ev.occurred_at) into v_first_engine
    from public.flight_events ev where ev.session_id = p_session_id and ev.type = 'engine_start';
  if v_first_engine is not null then
    -- Solo lo que bajó: una carga en tierra antes del arranque no cuenta como consumo.
    select coalesce(sum(greatest(x.prev_fuel - x.fuel_kg, 0)), 0) into v_before_engines
      from (select p.fuel_kg, lag(p.fuel_kg) over (order by p.seq) as prev_fuel
              from public.flight_track_points p
             where p.flight_id = v_session.flight_id and p.session_id = p_session_id and p.fuel_kg is not null
               and p.sampled_at <= v_first_engine) x
     where x.prev_fuel is not null;
  end if;

  -- APU: intervalos en marcha a partir de las notas del conector.
  for n in
    select ev.occurred_at, ev.data ->> 'state' as state
      from public.flight_events ev
     where ev.session_id = p_session_id and ev.type = 'note' and ev.data ->> 'kind' = 'apu'
     order by ev.occurred_at, ev.seq
  loop
    if n.state in ('start', 'running') then
      if v_apu_since is null then
        v_apu_since := n.occurred_at;
        v_apu_starts := v_apu_starts + case when n.state = 'start' then 1 else 0 end;
      end if;
      v_apu_first := coalesce(v_apu_first, n.occurred_at);
      v_apu_at_start := v_apu_at_start or n.state = 'running';
    elsif n.state = 'stop' and v_apu_since is not null then
      v_apu_secs := v_apu_secs + extract(epoch from n.occurred_at - v_apu_since);
      v_apu_since := null;
      v_apu_last_stop := n.occurred_at;
    end if;
  end loop;
  if v_apu_first is not null then
    if v_apu_since is not null then
      v_apu_secs := v_apu_secs + extract(epoch from coalesce(v_session.ended_at, now()) - v_apu_since);
    end if;
    v_apu := jsonb_strip_nulls(jsonb_build_object(
      'minutes', round(v_apu_secs / 60.0, 1),
      'starts', v_apu_starts,
      'first_on_at', v_apu_first,
      'last_off_at', v_apu_last_stop,
      'running_at_start', v_apu_at_start,
      'running_at_end', v_apu_since is not null
    ));
  end if;

  -- Plan de SimBrief del vuelo (en kg).
  select * into v_ofp from public.simbrief_ofps where flight_id = v_session.flight_id;
  if found then
    v_factor := case when v_ofp.fuel_units = 'lb' then 0.45359237 else 1 end;
    v_plan := jsonb_strip_nulls(jsonb_build_object(
      'block_kg', round(v_ofp.block_fuel * v_factor),
      'trip_kg', round(v_ofp.trip_fuel * v_factor),
      'reserve_kg', round(v_ofp.reserve_fuel * v_factor),
      'landing_kg', round((v_ofp.block_fuel - v_ofp.trip_fuel) * v_factor - coalesce(v_off - v_takeoff, 0)),
      'units', v_ofp.fuel_units
    ));
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'block_off_kg', round(v_off),
    'takeoff_kg', round(v_takeoff),
    'landing_kg', round(v_landing),
    'block_on_kg', round(v_on),
    'taxi_out_kg', round(v_off - v_takeoff),
    'trip_kg', round(v_takeoff - v_landing),
    'taxi_in_kg', round(v_landing - v_on),
    'used_kg', round(v_off - v_on),
    'samples', v_samples,
    'preflight_loaded_kg', nullif(round(v_preflight), 0),
    'refueled_kg', nullif(round(v_refuel), 0),
    'before_engines_kg', case when v_before_engines >= 0 then round(v_before_engines) end,
    'apu', v_apu,
    'stages', v_stages,
    'plan', v_plan
  ));
end;
$$;
revoke all on function private.pirep_fuel_metrics(uuid) from public;

insert into public.pirep_rule_definitions
  (code, label, description, threshold_unit, default_enabled, default_penalty, default_threshold, default_critical, sort_order)
values
  ('fuel_added_after_pushback', 'Combustible agregado después del pushback',
   'Se cargó combustible después de los calzos fuera. La carga del vuelo se hace antes del pushback; el umbral tolera variaciones pequeñas del indicador.',
   'kg', true, 20, 100, true, 106)
on conflict (code) do nothing;

insert into public.pirep_scoring_rules (airline_id, rule_code, enabled, penalty, threshold, critical)
select a.id, 'fuel_added_after_pushback', true, 20, 100, true from public.airlines a
on conflict do nothing;

create or replace function private.build_pirep(p_session_id uuid)
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
  v_fuel jsonb;
  v_threshold numeric;
  v_unit text;
  v_att record;
  v_wind jsonb;
  v_first_takeoff_seq integer;
  v_roll_start_seq integer;

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

  -- Salida directa: la carrera de despegue empieza en el último punto del rodaje
  -- a 20 kt o menos, o después de la última desaceleración, antes del despegue.
  -- Esos puntos (aceleración en la pista) no cuentan como rodaje rápido.
  select min(p.seq) into v_first_takeoff_seq
    from public.flight_track_points p
   where p.flight_id = v_flight.id and p.session_id = p_session_id and p.phase in ('takeoff', 'initial_climb');
  if v_first_takeoff_seq is not null then
    select max(t.seq) into v_roll_start_seq
      from (
        select p.seq, p.phase, p.gs_kt, lead(p.gs_kt) over (order by p.seq) as next_gs
          from public.flight_track_points p
         where p.flight_id = v_flight.id and p.session_id = p_session_id
      ) t
     where t.phase = 'taxi_out' and t.seq < v_first_takeoff_seq
       and (t.gs_kt <= 20 or t.next_gs < t.gs_kt - 2);
  end if;

  -- Traza: distancia recorrida, altitud máxima, rodaje y 250 kt bajo 10,000 ft.
  select
    coalesce(sum(private.great_circle_nm(t.prev_lat, t.prev_lon, t.latitude, t.longitude))
             filter (where t.prev_lat is not null), 0) as distance_nm,
    max(t.altitude_ft) as max_altitude_ft,
    max(t.gs_kt) filter (where t.on_ground and (t.phase = 'taxi_in' or (t.phase = 'taxi_out' and not (
          v_first_takeoff_seq is not null and t.seq > coalesce(v_roll_start_seq, -1) and t.seq < v_first_takeoff_seq))))
      as max_taxi_gs,
    max(t.ias_kt) filter (where not t.on_ground and t.altitude_ft < 10000
                          and t.phase in ('initial_climb', 'climb', 'cruise', 'descent', 'approach')) as max_ias_below_fl100
  into v_track
  from (
    select p.seq, p.latitude, p.longitude, p.altitude_ft, p.gs_kt, p.ias_kt, p.on_ground, p.phase,
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

  -- Combustible: niveles, consumo por etapa y plan de SimBrief
  v_fuel := private.pirep_fuel_metrics(p_session_id);
  v_wind := private.pirep_wind_metrics(p_session_id);

  -- Actitud: excursiones de alabeo y cabeceo que registra el conector (0.1.19+).
  select
    count(*) as excursions,
    max(abs((e.data ->> 'peak_deg')::numeric)) filter (where e.data ->> 'axis' = 'bank') as max_bank,
    max((e.data ->> 'peak_deg')::numeric) filter (where e.data ->> 'axis' = 'pitch_up') as max_pitch_up,
    min((e.data ->> 'peak_deg')::numeric) filter (where e.data ->> 'axis' = 'pitch_down') as min_pitch_down
  into v_att
  from public.flight_events e
  where e.session_id = p_session_id and e.type = 'note'
    and e.data ->> 'kind' = 'attitude'
    and jsonb_typeof(e.data -> 'peak_deg') = 'number';

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
    v_threshold := r.threshold;
    v_unit := r.threshold_unit;
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
      when 'bank_excess' then
        v_value := v_att.max_bank;
        v_hit := v_att.max_bank > r.threshold;
      when 'pitch_up_excess' then
        v_value := v_att.max_pitch_up;
        v_hit := v_att.max_pitch_up > r.threshold;
      when 'pitch_down_excess' then
        v_value := v_att.min_pitch_down;
        v_hit := v_att.min_pitch_down < -r.threshold;
      when 'attitude_upset' then
        -- Límites de "upset" del Airplane Upset Recovery Training Aid (fijos).
        v_hit := v_att.max_bank > 45 or v_att.max_pitch_up > 25 or v_att.min_pitch_down < -10;
      when 'taxi_speed' then
        v_value := v_track.max_taxi_gs;
        v_hit := v_track.max_taxi_gs > r.threshold;
      when 'overspeed' then
        v_value := v_counts.overspeed;
        v_hit := v_counts.overspeed > 0;
      when 'stall' then
        v_value := v_counts.stall;
        v_hit := v_counts.stall > 0;
      when 'landing_below_reserve' then
        -- Combustible al aterrizar (o en calzos) contra la reserva final del plan de SimBrief.
        v_value := coalesce((v_fuel ->> 'landing_kg')::numeric, (v_fuel ->> 'block_on_kg')::numeric);
        v_threshold := (v_fuel -> 'plan' ->> 'reserve_kg')::numeric;
        v_unit := 'kg';
        v_hit := v_value < v_threshold;
      when 'fuel_added_after_pushback' then
        -- Combustible agregado después de los calzos fuera (la carga normal se hace antes del pushback).
        v_value := coalesce((v_fuel ->> 'refueled_kg')::numeric, 0);
        v_unit := 'kg';
        v_hit := v_value > coalesce(r.threshold, 0);
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
        'value', v_value, 'threshold', v_threshold, 'unit', v_unit));
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
      'client_version', v_session.client_version,
      'fuel', v_fuel,
      'wind', v_wind,
      'takeoff_roll_from_seq', case when v_first_takeoff_seq is not null then v_roll_start_seq end,
      'attitude', case when v_att.excursions > 0 then jsonb_strip_nulls(jsonb_build_object(
        'excursions', v_att.excursions,
        'max_bank_deg', v_att.max_bank,
        'max_pitch_up_deg', v_att.max_pitch_up,
        'min_pitch_down_deg', v_att.min_pitch_down)) end
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

update public.pireps p
   set metrics = p.metrics || jsonb_build_object('fuel', private.pirep_fuel_metrics(p.session_id))
 where private.pirep_fuel_metrics(p.session_id) is not null;
