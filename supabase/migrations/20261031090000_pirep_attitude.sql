-- =============================================================================
-- LAM Virtual ACARS — Alabeo y cabeceo excesivos en el PIREP
-- El conector (0.1.19) registra notas {kind: "attitude", axis: bank|pitch_up|
-- pitch_down, peak_deg, seconds, altitude_ft, agl_ft, ias_kt} cuando la actitud
-- pasa sus umbrales de detección (alabeo 30°, cabeceo +18° / −6°) durante 2 s o
-- más. Cuatro reglas nuevas las evalúan; el umbral de cada aerolínea no debe ser
-- menor que el de detección (lo que no se detecta no se puede penalizar).
-- Sin cambios de esquema.
-- =============================================================================

insert into public.pirep_rule_definitions
  (code, label, description, threshold_unit, default_enabled, default_penalty, default_threshold, default_critical, sort_order)
values
  ('bank_excess', 'Alabeo excesivo',
   'Alabeo en vuelo mayor que el umbral durante 2 s o más. La operación normal no pasa de 30°; a 35° suena el aviso BANK ANGLE. Mínimo útil: 30°.',
   '°', true, 5, 35, false, 72),
  ('pitch_up_excess', 'Cabeceo excesivo (nariz arriba)',
   'Cabeceo con nariz arriba mayor que el umbral durante 2 s o más (un despegue normal queda entre 12° y 18°). Mínimo útil: 18°.',
   '°', true, 5, 20, false, 74),
  ('pitch_down_excess', 'Cabeceo excesivo (nariz abajo)',
   'Cabeceo con nariz abajo mayor que el umbral durante 2 s o más (un descenso normal queda entre 0° y −5°). Mínimo útil: 6°.',
   '°', true, 5, 7.5, false, 76),
  ('attitude_upset', 'Actitud anormal (upset)',
   'Alabeo de más de 45°, cabeceo de más de +25° o de menos de −10° (definición de upset de la industria). Envía el PIREP a revisión.',
   null, true, 15, null, true, 78)
on conflict (code) do nothing;

insert into public.pirep_scoring_rules (airline_id, rule_code, enabled, penalty, threshold, critical)
select a.id, d.code, d.default_enabled, d.default_penalty, d.default_threshold, d.default_critical
  from public.airlines a
 cross join public.pirep_rule_definitions d
 where d.code in ('bank_excess', 'pitch_up_excess', 'pitch_down_excess', 'attitude_upset')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- PIREP con actitud
-- -----------------------------------------------------------------------------
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

  -- Combustible: niveles, consumo por etapa y plan de SimBrief
  v_fuel := private.pirep_fuel_metrics(p_session_id);

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
