-- =============================================================================
-- LAM Virtual ACARS — «Cambio de aeronave» solo si cambia el avión
--
-- El A380 de iniBuilds cambia su matrícula ATC (ATC ID) un par de minutos
-- después de cargar. El conector lo tomaba como cambio de aeronave y el PIREP
-- marcaba la falta grave «Cambio de aeronave» (PIREP-2026-00014 y 00019), aunque
-- el título del avión era el mismo de principio a fin.
--
-- - build_pirep cuenta el evento solo si el título es distinto al de la sesión.
--   (El conector 0.1.28 ya solo emite el evento cuando cambia el título.)
-- - Los PIREP ya generados con esa falta sin anular, cuyos eventos tienen todos
--   el mismo título que la sesión, la quedan anulada con el motivo.
-- =============================================================================

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
    -- Solo cuenta si el título cambió: la misma aeronave puede cambiar su matrícula
    -- ATC (ATC ID) al cargar la librea o el EFB, y eso no es un cambio de avión.
    count(*) filter (where e.type = 'aircraft_changed'
                       and coalesce(e.data ->> 'title', '') is distinct from coalesce(v_session.sim_aircraft_title, '')) as aircraft_changed,
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
   set findings = (
         select jsonb_agg(
                  case when f ->> 'code' = 'aircraft_changed'
                       then f || jsonb_build_object(
                              'waived', true,
                              'waived_reason', 'Falso positivo del conector: la misma aeronave cambió su matrícula ATC, no hubo cambio de avión.',
                              'waived_by', null, 'waived_by_name', 'Sistema', 'waived_at', now())
                       else f end order by o)
           from jsonb_array_elements(p.findings) with ordinality as x(f, o)),
       score = greatest(0, 100 - coalesce((
         select sum(coalesce((f ->> 'penalty')::integer, 0)) from jsonb_array_elements(p.findings) f
          where not coalesce((f ->> 'waived')::boolean, false) and f ->> 'code' <> 'aircraft_changed'), 0)),
       has_critical = exists (
         select 1 from jsonb_array_elements(p.findings) f
          where coalesce((f ->> 'critical')::boolean, false) and not coalesce((f ->> 'waived')::boolean, false)
            and f ->> 'code' <> 'aircraft_changed')
 where exists (select 1 from jsonb_array_elements(p.findings) f
                where f ->> 'code' = 'aircraft_changed' and not coalesce((f ->> 'waived')::boolean, false))
   and not exists (select 1 from public.flight_events e
                     join public.flight_sessions s on s.id = e.session_id
                    where e.session_id = p.session_id and e.type = 'aircraft_changed'
                      and coalesce(e.data ->> 'title', '') is distinct from coalesce(s.sim_aircraft_title, ''));
