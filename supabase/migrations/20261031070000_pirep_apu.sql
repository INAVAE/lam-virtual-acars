-- =============================================================================
-- LAM Virtual ACARS — APU en el PIREP
-- El conector (0.1.17) registra notas {kind: "apu", state: start|stop|running}.
-- El resumen de combustible agrega el tiempo de APU y lo gastado antes del
-- primer arranque de motor. Sin cambios de esquema.
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

  select nullif(e.data ->> 'fuel_kg', '')::numeric into v_off
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
           extract(epoch from sampled_at - prev_at) as secs
      from pts
     where prev_fuel is not null
  ), by_stage as (
    select stage, sum(greatest(delta, 0)) as kg, sum(secs) as secs
      from legs group by stage
  )
  select
    (select count(*) from pts),
    (select coalesce(sum(-delta), 0) from legs where delta < -50),
    (select jsonb_object_agg(stage, jsonb_build_object(
        'kg', round(kg),
        'minutes', round(secs / 60.0, 1),
        'kg_per_hour', case when secs >= 60 then round(kg / (secs / 3600.0)) end))
       from by_stage)
  into v_samples, v_refuel, v_stages;

  -- Combustible gastado antes del primer arranque de motor (APU, normalmente).
  select min(ev.occurred_at) into v_first_engine
    from public.flight_events ev where ev.session_id = p_session_id and ev.type = 'engine_start';
  if v_first_engine is not null then
    select (select p.fuel_kg from public.flight_track_points p
             where p.flight_id = v_session.flight_id and p.session_id = p_session_id and p.fuel_kg is not null
             order by p.seq limit 1)
         - (select p.fuel_kg from public.flight_track_points p
             where p.flight_id = v_session.flight_id and p.session_id = p_session_id and p.fuel_kg is not null
               and p.sampled_at <= v_first_engine
             order by p.sampled_at desc limit 1)
      into v_before_engines;
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
    'refueled_kg', nullif(round(v_refuel), 0),
    'before_engines_kg', case when v_before_engines >= 0 then round(v_before_engines) end,
    'apu', v_apu,
    'stages', v_stages,
    'plan', v_plan
  ));
end;
$$;
revoke all on function private.pirep_fuel_metrics(uuid) from public;

update public.pireps p
   set metrics = p.metrics || jsonb_build_object('fuel', private.pirep_fuel_metrics(p.session_id))
 where private.pirep_fuel_metrics(p.session_id) is not null;
