-- =============================================================================
-- LAM Virtual ACARS — APU no informada por la aeronave
-- Algunos complementos (visto con «A380-800 EA Basic», QTR783 del 2026-11-05)
-- no mueven la variable estándar de la APU: el conector la ve encendida desde
-- que se conecta y nunca la ve apagarse. Si la APU estaba en marcha al conectar,
-- no hubo ningún encendido ni apagado y el vuelo despegó, el PIREP la marca como
-- no informada (apu.unreliable) en lugar de contar todo el vuelo como APU.
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
  v_apu_changes integer := 0;
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
    v_apu_changes := v_apu_changes + case when n.state in ('start', 'stop') then 1 else 0 end;
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
  -- Encendida desde que se conectó el conector y sin un solo cambio en un vuelo que
  -- despegó: la aeronave no informa su APU al simulador (algunos complementos usan
  -- su propio sistema). No se cuentan horas que no son reales.
  if v_apu_first is not null and v_apu_at_start and v_apu_changes = 0
     and exists (select 1 from public.flight_events e where e.session_id = p_session_id and e.type = 'takeoff') then
    v_apu := jsonb_build_object('unreliable', true, 'running_at_start', true);
  elsif v_apu_first is not null then
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
