-- =============================================================================
-- LAM Virtual ACARS — Fase 6 (2.ª parte): viento, rodaje en salida directa,
-- anulación de faltas, archivo de PIREP y estadísticas de aterrizaje
--
--   * Viento: el conector 0.1.21 envía dirección (°, verdadera, de donde sopla) y
--     velocidad (kt) en la traza y en la posición viva. El PIREP resume el viento
--     en despegue y aterrizaje, el máximo y la cizalladura a baja altura.
--   * Rodaje: en una salida directa (sin detenerse en la pista), la aceleración
--     para el despegue ya no cuenta como rodaje rápido.
--   * Anular faltas: mientras el PIREP está en revisión, el staff puede anular
--     una regla con motivo; el puntaje se recalcula y queda quién lo hizo.
--   * Archivar: el staff de la aerolínea (o el superadministrador) archiva un
--     PIREP con motivo. Si estaba aceptado, se restan sus horas y su ciclo. Solo
--     el superadministrador lo ve y puede restaurarlo.
--   * get_pilot_landing_stats: promedios y proporciones de los parámetros del
--     aterrizaje de un piloto, con sus últimos aterrizajes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Viento en la traza y en la posición viva
-- -----------------------------------------------------------------------------
alter table public.flight_track_points
  add column wind_dir_deg smallint check (wind_dir_deg between 0 and 360),
  add column wind_kt smallint check (wind_kt between 0 and 400);
alter table public.flight_positions_live
  add column wind_dir_deg smallint check (wind_dir_deg between 0 and 360),
  add column wind_kt smallint check (wind_kt between 0 and 400);
comment on column public.flight_track_points.wind_dir_deg is 'Dirección verdadera de donde sopla el viento (°). Conector 0.1.21+.';
comment on column public.flight_track_points.wind_kt is 'Velocidad del viento (kt). Conector 0.1.21+.';

create or replace function public.acars_track_batch(p_token_hash text, p_session_id uuid, p_points jsonb)
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
    gs_kt, ias_kt, vs_fpm, heading_deg, on_ground, phase, fuel_kg, wind_dir_deg, wind_kt
  )
  select
    v_session.flight_id, (p ->> 'seq')::integer, (p ->> 'sampled_at')::timestamptz, v_session.id,
    v_session.user_id, v_session.airline_id, (p ->> 'latitude')::double precision, (p ->> 'longitude')::double precision,
    round((p ->> 'altitude_ft')::numeric)::integer, round((p ->> 'gs_kt')::numeric)::smallint,
    round((p ->> 'ias_kt')::numeric)::smallint, round((p ->> 'vs_fpm')::numeric)::integer,
    round((p ->> 'heading_deg')::numeric)::smallint % 361, coalesce((p ->> 'on_ground')::boolean, false), p ->> 'phase',
    round((p ->> 'fuel_kg')::numeric)::integer,
    round((p ->> 'wind_dir_deg')::numeric)::smallint % 361,
    least(round((p ->> 'wind_kt')::numeric), 400)::smallint
  from jsonb_array_elements(p_points) as p
  on conflict do nothing;
  get diagnostics v_inserted = row_count;

  return jsonb_build_object('received', v_count, 'inserted', v_inserted, 'duplicates', v_count - v_inserted);
end;
$$;

create or replace function public.acars_position(p_token_hash text, p_session_id uuid, p_position jsonb)
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
    ias_kt, gs_kt, heading_deg, vs_fpm, on_ground, phase, wind_dir_deg, wind_kt, updated_at
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
    round((p_position ->> 'wind_dir_deg')::numeric)::smallint % 361,
    least(round((p_position ->> 'wind_kt')::numeric), 400)::smallint,
    now()
  )
  on conflict (flight_id) do update set
    session_id = excluded.session_id, sampled_at = excluded.sampled_at, latitude = excluded.latitude,
    longitude = excluded.longitude, altitude_ft = excluded.altitude_ft, agl_ft = excluded.agl_ft,
    ias_kt = excluded.ias_kt, gs_kt = excluded.gs_kt, heading_deg = excluded.heading_deg,
    vs_fpm = excluded.vs_fpm, on_ground = excluded.on_ground, phase = excluded.phase,
    wind_dir_deg = excluded.wind_dir_deg, wind_kt = excluded.wind_kt, updated_at = now()
  where public.flight_positions_live.sampled_at < excluded.sampled_at;

  if v_phase is distinct from v_session.phase then
    update public.flight_sessions set phase = v_phase where id = v_session.id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- Vuelos en curso con el viento de la última posición.
create or replace function public.get_live_flights(p_airline_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_airlines uuid[] := private.scope_airlines(p_airline_id, false);
  v_uid uuid := (select auth.uid());
begin
  return coalesce((
    select jsonb_agg(x.j order by x.started_at)
      from (
        select s.started_at, jsonb_build_object(
          'flight_id', f.id,
          'session_id', s.id,
          'airline', jsonb_build_object('id', a.id, 'icao', a.icao_code, 'name', a.name, 'slug', a.slug,
                                        'color', a.brand_primary_color, 'logo_path', a.logo_path),
          'callsign', f.callsign,
          'flight_number', f.flight_number,
          'network', f.network,
          'pilot', jsonb_build_object('id', pr.id, 'name', pr.display_name, 'number', pr.pilot_number),
          'is_mine', f.user_id = v_uid,
          'aircraft_registration', f.aircraft_registration,
          'aircraft_type', t.icao_code,
          'aircraft_model', t.manufacturer || ' ' || t.model,
          'sim_aircraft_title', s.sim_aircraft_title,
          'origin', jsonb_build_object('icao', o.icao_code, 'name', o.name, 'city', o.city, 'latitude', o.latitude, 'longitude', o.longitude),
          'destination', jsonb_build_object('icao', d.icao_code, 'name', d.name, 'city', d.city, 'latitude', d.latitude, 'longitude', d.longitude),
          'planned_distance_nm', f.planned_distance_nm,
          'planned_minutes', f.planned_minutes,
          'route_nm', round(private.great_circle_nm(o.latitude, o.longitude, d.latitude, d.longitude)::numeric),
          'remaining_nm', case when p.flight_id is not null
                               then round(private.great_circle_nm(p.latitude, p.longitude, d.latitude, d.longitude)::numeric) end,
          'started_at', s.started_at,
          'last_contact_at', s.last_contact_at,
          'phase', coalesce(p.phase, s.phase),
          'position', case when p.flight_id is null then null else jsonb_build_object(
            'sampled_at', p.sampled_at, 'latitude', p.latitude, 'longitude', p.longitude,
            'altitude_ft', p.altitude_ft, 'agl_ft', p.agl_ft, 'ias_kt', p.ias_kt, 'gs_kt', p.gs_kt,
            'heading_deg', p.heading_deg, 'vs_fpm', p.vs_fpm, 'on_ground', p.on_ground,
            'wind_dir_deg', p.wind_dir_deg, 'wind_kt', p.wind_kt) end,
          'alerts', case when private.can_staff_airline(f.airline_id) then private.live_flight_alerts(
            s.id, s.last_contact_at, coalesce(p.phase, s.phase),
            case when p.flight_id is not null then private.great_circle_nm(p.latitude, p.longitude, d.latitude, d.longitude) end,
            s.started_at, f.planned_minutes) end
        ) as j
          from public.flight_sessions s
          join public.flights f on f.id = s.flight_id
          join public.airlines a on a.id = f.airline_id
          join public.profiles pr on pr.id = f.user_id
          join public.aircraft_types t on t.id = f.aircraft_type_id
          join public.airports o on o.id = f.origin_airport_id
          join public.airports d on d.id = f.destination_airport_id
          left join public.flight_positions_live p on p.flight_id = f.id
         where s.status = 'active'
           and s.airline_id = any (v_airlines)
           and s.last_contact_at > now() - interval '12 hours'
      ) x
  ), '[]'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- Viento del vuelo para el PIREP
--   Componentes respecto al rumbo verdadero: cabeza (+) / cola (−) y cruzado
--   desde la derecha (+) / izquierda (−).
--   Cizalladura: en despegue, ascenso inicial, aproximación y aterrizaje, el
--   viento de cabeza cambia 15 kt o más en 30 s (criterio de alerta habitual).
-- -----------------------------------------------------------------------------
create function private.wind_components(p_wind_dir numeric, p_wind_kt numeric, p_heading numeric)
returns table (headwind_kt numeric, crosswind_kt numeric)
language sql
immutable
set search_path = ''
as $$
  select round((p_wind_kt * cos(radians(p_wind_dir - p_heading)))::numeric, 1),
         round((p_wind_kt * sin(radians(p_wind_dir - p_heading)))::numeric, 1);
$$;

create function private.pirep_wind_metrics(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.flight_sessions;
  v_takeoff_at timestamptz;
  v_touchdown_at timestamptz;
  v_samples integer;
  v_takeoff jsonb;
  v_touchdown jsonb;
  v_max jsonb;
  v_shear jsonb;
begin
  select * into v_session from public.flight_sessions where id = p_session_id;
  if not found then
    return null;
  end if;

  select count(*) into v_samples
    from public.flight_track_points p
   where p.flight_id = v_session.flight_id and p.session_id = p_session_id and p.wind_kt is not null;
  if v_samples = 0 then
    return null;
  end if;

  select min(e.occurred_at) filter (where e.type = 'takeoff'), max(e.occurred_at) filter (where e.type = 'touchdown')
    into v_takeoff_at, v_touchdown_at
    from public.flight_events e where e.session_id = p_session_id and e.type in ('takeoff', 'touchdown');

  -- Viento en el punto de traza más cercano (60 s como máximo) al despegue y al contacto.
  select jsonb_build_object('at', p.sampled_at, 'dir_deg', p.wind_dir_deg, 'kt', p.wind_kt, 'heading_deg', p.heading_deg,
                            'headwind_kt', c.headwind_kt, 'crosswind_kt', c.crosswind_kt)
    into v_takeoff
    from public.flight_track_points p,
         lateral private.wind_components(p.wind_dir_deg, p.wind_kt, p.heading_deg) c
   where p.flight_id = v_session.flight_id and p.session_id = p_session_id and p.wind_kt is not null
     and v_takeoff_at is not null and abs(extract(epoch from (p.sampled_at - v_takeoff_at))) <= 60
   order by abs(extract(epoch from (p.sampled_at - v_takeoff_at)))
   limit 1;

  select jsonb_build_object('at', p.sampled_at, 'dir_deg', p.wind_dir_deg, 'kt', p.wind_kt, 'heading_deg', p.heading_deg,
                            'headwind_kt', c.headwind_kt, 'crosswind_kt', c.crosswind_kt)
    into v_touchdown
    from public.flight_track_points p,
         lateral private.wind_components(p.wind_dir_deg, p.wind_kt, p.heading_deg) c
   where p.flight_id = v_session.flight_id and p.session_id = p_session_id and p.wind_kt is not null
     and v_touchdown_at is not null and abs(extract(epoch from (p.sampled_at - v_touchdown_at))) <= 60
   order by abs(extract(epoch from (p.sampled_at - v_touchdown_at)))
   limit 1;

  select jsonb_build_object('at', p.sampled_at, 'dir_deg', p.wind_dir_deg, 'kt', p.wind_kt, 'altitude_ft', p.altitude_ft, 'phase', p.phase)
    into v_max
    from public.flight_track_points p
   where p.flight_id = v_session.flight_id and p.session_id = p_session_id and p.wind_kt is not null and not p.on_ground
   order by p.wind_kt desc, p.sampled_at
   limit 1;

  -- Cizalladura a baja altura: cambio del viento de cabeza en una ventana de 30 s.
  with low as (
    select p.sampled_at, p.phase, p.altitude_ft, c.headwind_kt as head
      from public.flight_track_points p,
           lateral private.wind_components(p.wind_dir_deg, p.wind_kt, p.heading_deg) c
     where p.flight_id = v_session.flight_id and p.session_id = p_session_id
       and p.wind_kt is not null and p.heading_deg is not null
       and p.phase in ('takeoff', 'initial_climb', 'approach', 'landing')
  ), swings as (
    select l.*, l.head - first_value(l.head) over w as change
      from low l
    window w as (order by l.sampled_at range between interval '30 seconds' preceding and current row)
  ), flagged as (
    select s.*, abs(s.change) >= 15 as hit,
           lag(abs(s.change) >= 15) over (order by s.sampled_at) as prev_hit
      from swings s
  )
  select case when count(*) filter (where f.hit) = 0 then null else jsonb_build_object(
           'events', count(*) filter (where f.hit and not coalesce(f.prev_hit, false)),
           'max_change_kt', (array_agg(f.change order by abs(f.change) desc) filter (where f.hit))[1],
           'at', (array_agg(f.sampled_at order by abs(f.change) desc) filter (where f.hit))[1],
           'phase', (array_agg(f.phase order by abs(f.change) desc) filter (where f.hit))[1],
           'altitude_ft', (array_agg(f.altitude_ft order by abs(f.change) desc) filter (where f.hit))[1]) end
    into v_shear
    from flagged f;

  return jsonb_strip_nulls(jsonb_build_object(
    'samples', v_samples,
    'takeoff', v_takeoff,
    'touchdown', v_touchdown,
    'max', v_max,
    'shear', v_shear
  ));
end;
$$;
revoke all on function private.pirep_wind_metrics(uuid) from public;
revoke all on function private.wind_components(numeric, numeric, numeric) from public;

-- -----------------------------------------------------------------------------
-- Archivo y anulación de faltas
-- -----------------------------------------------------------------------------
alter table public.pireps
  add column archived_from public.pirep_status,
  add column archived_at timestamptz,
  add column archived_by uuid references public.profiles (id) on delete set null,
  add column archive_reason text check (char_length(archive_reason) <= 2000);
create index pireps_archived_by_idx on public.pireps (archived_by) where archived_by is not null;
comment on column public.pireps.archived_from is 'Estado que tenía el PIREP antes de archivarse (para restaurarlo).';

-- Los archivados solo los ve el superadministrador.
alter policy pireps_select on public.pireps
  using ((user_id = (select auth.uid()) or private.can_staff_airline(airline_id))
         and (status <> 'archived' or private.is_org_admin()));

-- Inverso de apply_pirep_acceptance.
create function private.revert_pirep_acceptance(p_pirep public.pireps)
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
     set total_minutes = greatest(0, total_minutes - p_pirep.block_minutes),
         cycles = greatest(0, cycles - case when p_pirep.landing_at is not null then 1 else 0 end)
   where id = p_pirep.aircraft_id;
end;
$$;
revoke all on function private.revert_pirep_acceptance(public.pireps) from public;

create function public.archive_pirep(p_pirep_id uuid, p_reason text)
returns public.pireps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_pirep public.pireps;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_uid is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  select * into v_pirep from public.pireps where id = p_pirep_id for update;
  if not found or not private.can_staff_airline(v_pirep.airline_id) then
    raise exception 'PIREP no encontrado o sin permiso para archivarlo' using errcode = '42501', hint = 'not_allowed';
  end if;
  if v_pirep.user_id = v_uid and not private.is_org_admin() then
    raise exception 'No puedes archivar tu propio PIREP' using errcode = '42501', hint = 'own_pirep';
  end if;
  if v_pirep.status = 'archived' then
    raise exception 'Este PIREP ya está archivado' using errcode = '55000', hint = 'already_archived';
  end if;
  if v_reason is null then
    raise exception 'Escribe el motivo' using errcode = '22023', hint = 'reason_required';
  end if;
  if char_length(v_reason) > 2000 then
    raise exception 'El motivo es demasiado largo' using errcode = '22001', hint = 'reason_too_long';
  end if;

  if v_pirep.status = 'accepted' then
    perform private.revert_pirep_acceptance(v_pirep);
  end if;

  update public.pireps
     set archived_from = status, status = 'archived', archived_at = now(), archived_by = v_uid, archive_reason = v_reason
   where id = p_pirep_id
  returning * into v_pirep;
  return v_pirep;
end;
$$;
comment on function public.archive_pirep(uuid, text) is
  'Archiva un PIREP (staff de su aerolínea o superadministrador) con motivo. Si estaba aceptado, resta sus horas y su ciclo.';

create function public.restore_pirep(p_pirep_id uuid)
returns public.pireps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pirep public.pireps;
begin
  if not private.is_org_admin() then
    raise exception 'Solo el superadministrador restaura PIREP archivados' using errcode = '42501', hint = 'not_allowed';
  end if;
  select * into v_pirep from public.pireps where id = p_pirep_id for update;
  if not found or v_pirep.status <> 'archived' then
    raise exception 'El PIREP no está archivado' using errcode = '55000', hint = 'not_archived';
  end if;

  update public.pireps
     set status = coalesce(archived_from, 'pending'), archived_from = null, archived_at = null, archived_by = null, archive_reason = null
   where id = p_pirep_id
  returning * into v_pirep;

  if v_pirep.status = 'accepted' then
    perform private.apply_pirep_acceptance(v_pirep);
  end if;
  return v_pirep;
end;
$$;
comment on function public.restore_pirep(uuid) is 'Restaura un PIREP archivado a su estado anterior (superadministrador). Si estaba aceptado, vuelve a sumar horas y ciclo.';

create function public.waive_pirep_finding(p_pirep_id uuid, p_code text, p_reason text default null, p_waive boolean default true)
returns public.pireps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_pirep public.pireps;
  v_reason text := nullif(btrim(p_reason), '');
  v_name text;
  v_findings jsonb;
begin
  if v_uid is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  select * into v_pirep from public.pireps where id = p_pirep_id for update;
  if not found or not private.can_staff_airline(v_pirep.airline_id) then
    raise exception 'PIREP no encontrado o sin permiso para revisarlo' using errcode = '42501', hint = 'not_allowed';
  end if;
  if v_pirep.user_id = v_uid and not private.is_org_admin() then
    raise exception 'No puedes revisar tu propio PIREP' using errcode = '42501', hint = 'own_pirep';
  end if;
  if v_pirep.status <> 'pending' then
    raise exception 'Solo se anulan faltas de un PIREP en revisión' using errcode = '55000', hint = 'already_reviewed';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_pirep.findings) f where f ->> 'code' = p_code) then
    raise exception 'El PIREP no tiene esa falta' using errcode = '22023', hint = 'finding_not_found';
  end if;
  if p_waive and v_reason is null then
    raise exception 'Escribe el motivo de la anulación' using errcode = '22023', hint = 'reason_required';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'El motivo es demasiado largo' using errcode = '22001', hint = 'reason_too_long';
  end if;

  select display_name into v_name from public.profiles where id = v_uid;

  select jsonb_agg(
           case when f ->> 'code' <> p_code then f
                when p_waive then f || jsonb_build_object('waived', true, 'waived_reason', v_reason, 'waived_by', v_uid,
                                                          'waived_by_name', v_name, 'waived_at', now())
                else f - 'waived' - 'waived_reason' - 'waived_by' - 'waived_by_name' - 'waived_at'
           end order by o)
    into v_findings
    from jsonb_array_elements(v_pirep.findings) with ordinality as x(f, o);

  update public.pireps
     set findings = v_findings,
         score = greatest(0, 100 - coalesce((
                   select sum((f ->> 'penalty')::integer) from jsonb_array_elements(v_findings) f
                    where not coalesce((f ->> 'waived')::boolean, false)), 0)),
         has_critical = exists (
                   select 1 from jsonb_array_elements(v_findings) f
                    where coalesce((f ->> 'critical')::boolean, false) and not coalesce((f ->> 'waived')::boolean, false))
   where id = p_pirep_id
  returning * into v_pirep;
  return v_pirep;
end;
$$;
comment on function public.waive_pirep_finding(uuid, text, text, boolean) is
  'Anula (o restaura) una falta de un PIREP en revisión, con motivo. Recalcula el puntaje y las faltas graves. Staff de la aerolínea.';

-- Estadísticas del piloto sin PIREP archivados (el superadministrador también los lee).
create or replace view public.pilot_statistics
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
where p.status <> 'archived'
group by p.airline_id, p.user_id;

-- -----------------------------------------------------------------------------
-- Estadísticas de aterrizaje de un piloto
--   Cuenta los PIREP aceptados y en revisión con contacto registrado. "Dentro de
--   parámetros" = sin faltas de aterrizaje (duro, firme, G, rebote, cabeceo,
--   alabeo) según las reglas de su aerolínea, sin contar las anuladas.
-- -----------------------------------------------------------------------------
create function public.get_pilot_landing_stats(p_user_id uuid default null, p_airline_id uuid default null, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_target uuid := coalesce(p_user_id, v_uid);
  v_airlines uuid[] := private.scope_airlines(p_airline_id, false);
  v_limit integer := least(greatest(coalesce(p_limit, 30), 5), 200);
begin
  -- Otro piloto: solo si comparte aerolínea (el ranking es visible para todos los miembros).
  if v_target <> v_uid and not private.is_org_admin() and not exists (
       select 1 from public.airline_memberships m
        where m.user_id = v_target and m.airline_id = any (v_airlines)) then
    raise exception 'No tienes acceso a las estadísticas de este piloto' using errcode = '42501';
  end if;

  return (
    with l as (
      select p.id, p.landing_at as at, p.callsign, o.icao_code as origin, coalesce(a.icao_code, d.icao_code) as arrival,
             t.icao_code as aircraft_type, p.status::text as status,
             p.landing_vs_fpm::numeric as vs,
             nullif(p.metrics -> 'touchdown' ->> 'g_force', '')::numeric as g,
             nullif(p.metrics -> 'touchdown' ->> 'pitch_deg', '')::numeric as pitch,
             nullif(p.metrics -> 'touchdown' ->> 'bank_deg', '')::numeric as bank,
             coalesce(p.landing_bounces, 0) as bounces,
             nullif(p.metrics -> 'touchdown' ->> 'ias_kt', '')::numeric as ias,
             nullif(p.metrics -> 'touchdown' ->> 'flaps_deg', '')::numeric as flaps,
             coalesce(nullif(p.metrics -> 'touchdown' ->> 'headwind_kt', '')::numeric,
                      nullif(p.metrics -> 'wind' -> 'touchdown' ->> 'headwind_kt', '')::numeric) as headwind,
             coalesce(nullif(p.metrics -> 'touchdown' ->> 'crosswind_kt', '')::numeric,
                      nullif(p.metrics -> 'wind' -> 'touchdown' ->> 'crosswind_kt', '')::numeric) as crosswind,
             p.score::integer as score,
             array(select f ->> 'code' from jsonb_array_elements(p.findings) f
                    where f ->> 'code' in ('landing_hard', 'landing_firm', 'landing_g', 'landing_bounce', 'landing_pitch', 'landing_bank')
                      and not coalesce((f ->> 'waived')::boolean, false)) as landing_findings
        from public.pireps p
        join public.airports o on o.id = p.origin_airport_id
        join public.airports d on d.id = p.destination_airport_id
        left join public.airports a on a.id = p.arrival_airport_id
        join public.aircraft_types t on t.id = p.aircraft_type_id
       where p.user_id = v_target and p.airline_id = any (v_airlines)
         and p.status in ('accepted', 'pending') and p.landing_vs_fpm is not null
    )
    select jsonb_build_object(
      'user_id', v_target,
      'pilot', (select jsonb_build_object('id', pr.id, 'name', pr.display_name, 'number', pr.pilot_number)
                  from public.profiles pr where pr.id = v_target),
      'summary', (
        select jsonb_build_object(
                 'landings', count(*),
                 'average_vs_fpm', round(avg(l.vs)),
                 'median_vs_fpm', round((percentile_cont(0.5) within group (order by l.vs))::numeric),
                 'best_vs_fpm', max(l.vs),
                 'worst_vs_fpm', min(l.vs),
                 'stddev_vs_fpm', round(stddev_samp(l.vs)),
                 'average_g', round(avg(l.g), 2),
                 'max_g', max(l.g),
                 'average_pitch_deg', round(avg(l.pitch), 1),
                 'average_bank_deg', round(avg(abs(l.bank)), 1),
                 'max_bank_deg', max(abs(l.bank)),
                 'average_ias_kt', round(avg(l.ias)),
                 'average_crosswind_kt', round(avg(abs(l.crosswind)), 1),
                 'max_crosswind_kt', max(abs(l.crosswind)),
                 'bounce_rate', round(avg(case when l.bounces > 0 then 1.0 else 0 end), 3),
                 'firm_rate', round(avg(case when 'landing_firm' = any (l.landing_findings) then 1.0 else 0 end), 3),
                 'hard_rate', round(avg(case when 'landing_hard' = any (l.landing_findings) then 1.0 else 0 end), 3),
                 'within_limits_rate', round(avg(case when cardinality(l.landing_findings) = 0 then 1.0 else 0 end), 3),
                 'average_score', round(avg(l.score), 1),
                 'last_10_average_vs_fpm', (select round(avg(x.vs)) from (select l2.vs from l l2 order by l2.at desc limit 10) x),
                 'previous_10_average_vs_fpm', (select round(avg(x.vs)) from (select l2.vs from l l2 order by l2.at desc offset 10 limit 10) x))
          from l),
      'buckets', (
        select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'label', b.label, 'flights', coalesce(x.n, 0)) order by b.ord)
          from (values
            (1, 'butter', '0 a −100'), (2, 'soft', '−100 a −200'), (3, 'normal', '−200 a −300'),
            (4, 'firm', '−300 a −400'), (5, 'hard', '−400 a −600'), (6, 'very_hard', 'más de −600')
          ) as b(ord, bucket, label)
          left join (
            select case
                     when l.vs > -100 then 'butter'
                     when l.vs > -200 then 'soft'
                     when l.vs > -300 then 'normal'
                     when l.vs > -400 then 'firm'
                     when l.vs > -600 then 'hard'
                     else 'very_hard'
                   end as bucket, count(*) as n
              from l
             group by 1
          ) x on x.bucket = b.bucket),
      'recent', (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'id', r.id, 'at', r.at, 'callsign', r.callsign, 'origin', r.origin, 'arrival', r.arrival,
                 'aircraft_type', r.aircraft_type, 'status', r.status, 'vs_fpm', r.vs, 'g_force', r.g,
                 'pitch_deg', r.pitch, 'bank_deg', r.bank, 'bounces', r.bounces, 'ias_kt', r.ias, 'flaps_deg', r.flaps,
                 'headwind_kt', r.headwind, 'crosswind_kt', r.crosswind, 'score', r.score,
                 'within_limits', cardinality(r.landing_findings) = 0, 'findings', to_jsonb(r.landing_findings))
               order by r.at desc), '[]'::jsonb)
          from (select * from l order by l.at desc limit v_limit) r)
    )
  );
end;
$$;
comment on function public.get_pilot_landing_stats(uuid, uuid, integer) is
  'Promedios y proporciones de los parámetros del aterrizaje de un piloto (aceptados y en revisión), con sus últimos aterrizajes.';

-- -----------------------------------------------------------------------------
-- PIREP con viento y rodaje corregido (salida directa)
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

-- -----------------------------------------------------------------------------
-- Estadísticas y Operations Center sin PIREP archivados ni faltas anuladas
-- -----------------------------------------------------------------------------
create or replace function public.get_airline_statistics(p_airline_id uuid default null, p_months integer default 12)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_airlines uuid[] := private.scope_airlines(p_airline_id, false);
  v_months integer := least(greatest(coalesce(p_months, 12), 1), 36);
  v_from timestamptz := date_trunc('month', now()) - make_interval(months => v_months - 1);
  v_totals jsonb;
  v_last30 jsonb;
  v_monthly jsonb;
  v_routes jsonb;
  v_types jsonb;
  v_landings jsonb;
  v_ranking jsonb;
  v_findings jsonb;
begin
  -- Totales históricos y de los últimos 30 días
  select jsonb_build_object(
           'flights', count(*),
           'block_minutes', coalesce(sum(p.block_minutes), 0),
           'flight_minutes', coalesce(sum(p.flight_minutes), 0),
           'distance_nm', coalesce(sum(p.distance_nm), 0),
           'fuel_used_kg', coalesce(sum(p.fuel_used_kg) filter (where p.fuel_used_kg > 0), 0),
           'average_score', round(avg(p.score), 1),
           'average_landing_vs_fpm', round(avg(p.landing_vs_fpm)),
           'pilots', count(distinct p.user_id),
           'airports', (select count(distinct x) from public.pireps q,
                         lateral unnest(array[q.origin_airport_id, coalesce(q.arrival_airport_id, q.destination_airport_id)]) x
                        where q.airline_id = any (v_airlines) and q.status = 'accepted'))
    into v_totals
    from public.pireps p
   where p.airline_id = any (v_airlines) and p.status = 'accepted';

  select jsonb_build_object(
           'flights', count(*),
           'block_minutes', coalesce(sum(p.block_minutes), 0),
           'distance_nm', coalesce(sum(p.distance_nm), 0),
           'average_score', round(avg(p.score), 1),
           'pilots', count(distinct p.user_id))
    into v_last30
    from public.pireps p
   where p.airline_id = any (v_airlines) and p.status = 'accepted'
     and coalesce(p.block_on_at, p.landing_at, p.created_at) >= now() - interval '30 days';

  -- Por mes (incluye meses sin vuelos)
  select jsonb_agg(jsonb_build_object(
           'month', to_char(m.month, 'YYYY-MM'),
           'flights', coalesce(x.flights, 0),
           'block_minutes', coalesce(x.block_minutes, 0),
           'distance_nm', coalesce(x.distance_nm, 0),
           'average_score', x.average_score,
           'pilots', coalesce(x.pilots, 0))
         order by m.month)
    into v_monthly
    from generate_series(v_from, date_trunc('month', now()), interval '1 month') as m(month)
    left join (
      select date_trunc('month', coalesce(p.block_on_at, p.landing_at, p.created_at)) as month,
             count(*) as flights,
             sum(p.block_minutes) as block_minutes,
             sum(p.distance_nm) as distance_nm,
             round(avg(p.score), 1) as average_score,
             count(distinct p.user_id) as pilots
        from public.pireps p
       where p.airline_id = any (v_airlines) and p.status = 'accepted'
         and coalesce(p.block_on_at, p.landing_at, p.created_at) >= v_from
       group by 1
    ) x on x.month = m.month;

  -- Rutas más voladas
  select coalesce(jsonb_agg(r.j order by r.flights desc, r.block desc), '[]'::jsonb) into v_routes
    from (
      select count(*) as flights, sum(p.block_minutes) as block,
             jsonb_build_object('origin', o.icao_code, 'destination', d.icao_code,
                                'origin_city', o.city, 'destination_city', d.city,
                                'flights', count(*), 'block_minutes', sum(p.block_minutes),
                                'average_score', round(avg(p.score), 1)) as j
        from public.pireps p
        join public.airports o on o.id = p.origin_airport_id
        join public.airports d on d.id = p.destination_airport_id
       where p.airline_id = any (v_airlines) and p.status = 'accepted'
       group by o.icao_code, d.icao_code, o.city, d.city
       order by count(*) desc, sum(p.block_minutes) desc
       limit 10
    ) r;

  -- Tipos de aeronave
  select coalesce(jsonb_agg(r.j order by r.flights desc), '[]'::jsonb) into v_types
    from (
      select count(*) as flights,
             jsonb_build_object('icao', t.icao_code, 'model', t.manufacturer || ' ' || t.model,
                                'flights', count(*), 'block_minutes', sum(p.block_minutes),
                                'average_landing_vs_fpm', round(avg(p.landing_vs_fpm))) as j
        from public.pireps p
        join public.aircraft_types t on t.id = p.aircraft_type_id
       where p.airline_id = any (v_airlines) and p.status = 'accepted'
       group by t.icao_code, t.manufacturer, t.model
    ) r;

  -- Distribución de aterrizajes por velocidad vertical
  select jsonb_agg(jsonb_build_object('bucket', b.bucket, 'label', b.label, 'flights', coalesce(x.n, 0)) order by b.ord)
    into v_landings
    from (values
      (1, 'butter', '0 a −100'), (2, 'soft', '−100 a −200'), (3, 'normal', '−200 a −300'),
      (4, 'firm', '−300 a −400'), (5, 'hard', '−400 a −600'), (6, 'very_hard', 'más de −600')
    ) as b(ord, bucket, label)
    left join (
      select case
               when p.landing_vs_fpm > -100 then 'butter'
               when p.landing_vs_fpm > -200 then 'soft'
               when p.landing_vs_fpm > -300 then 'normal'
               when p.landing_vs_fpm > -400 then 'firm'
               when p.landing_vs_fpm > -600 then 'hard'
               else 'very_hard'
             end as bucket,
             count(*) as n
        from public.pireps p
       where p.airline_id = any (v_airlines) and p.status = 'accepted' and p.landing_vs_fpm is not null
       group by 1
    ) x on x.bucket = b.bucket;

  -- Ranking de pilotos (visible para todos los miembros, por decisión del usuario)
  select coalesce(jsonb_agg(r.j order by r.block desc, r.flights desc), '[]'::jsonb) into v_ranking
    from (
      select sum(p.block_minutes) as block, count(*) as flights,
             jsonb_build_object(
               'user_id', pr.id, 'name', pr.display_name, 'number', pr.pilot_number, 'country_code', pr.country_code,
               'flights', count(*),
               'block_minutes', sum(p.block_minutes),
               'distance_nm', sum(p.distance_nm),
               'average_score', round(avg(p.score), 1),
               'average_landing_vs_fpm', round(avg(p.landing_vs_fpm)),
               'best_landing_vs_fpm', max(p.landing_vs_fpm),
               'last_30_days_minutes', coalesce(sum(p.block_minutes) filter (
                  where coalesce(p.block_on_at, p.landing_at, p.created_at) >= now() - interval '30 days'), 0),
               'last_flight_at', max(coalesce(p.block_on_at, p.landing_at, p.created_at))) as j
        from public.pireps p
        join public.profiles pr on pr.id = p.user_id
       where p.airline_id = any (v_airlines) and p.status = 'accepted'
       group by pr.id, pr.display_name, pr.pilot_number, pr.country_code
       order by sum(p.block_minutes) desc
       limit 200
    ) r;

  -- Faltas más frecuentes del periodo (todos los PIREP, solo las que restan puntos)
  select coalesce(jsonb_agg(r.j order by r.n desc), '[]'::jsonb) into v_findings
    from (
      select count(*) as n, jsonb_build_object('code', f ->> 'code', 'label', max(f ->> 'label'), 'count', count(*)) as j
        from public.pireps p, jsonb_array_elements(p.findings) f
       where p.airline_id = any (v_airlines)
         and p.status <> 'archived'
         and coalesce(p.block_on_at, p.landing_at, p.created_at) >= v_from
         and coalesce((f ->> 'penalty')::integer, 0) > 0
         and not coalesce((f ->> 'waived')::boolean, false)
       group by f ->> 'code'
       order by count(*) desc
       limit 8
    ) r;

  return jsonb_build_object(
    'airlines', to_jsonb(v_airlines),
    'months', v_months,
    'totals', v_totals,
    'last_30_days', v_last30,
    'monthly', coalesce(v_monthly, '[]'::jsonb),
    'top_routes', v_routes,
    'aircraft_types', v_types,
    'landings', coalesce(v_landings, '[]'::jsonb),
    'ranking', v_ranking,
    'common_findings', v_findings
  );
end;
$$;

create or replace function public.get_operations_overview(p_airline_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_airlines uuid[] := private.scope_airlines(p_airline_id, true);
  v_departures jsonb;
  v_queue jsonb;
  v_fleet jsonb;
  v_counts jsonb;
begin
  if cardinality(v_airlines) = 0 then
    raise exception 'El Operations Center es para el jefe de operaciones y el administrador' using errcode = '42501';
  end if;

  -- Vuelos reservados que aún no inician
  select coalesce(jsonb_agg(x.j order by x.sort_at), '[]'::jsonb) into v_departures
    from (
      select coalesce(f.scheduled_departure_at, b.expires_at) as sort_at,
             jsonb_build_object(
               'flight_id', f.id,
               'airline_icao', f.airline_icao,
               'callsign', f.callsign,
               'flight_number', f.flight_number,
               'pilot', jsonb_build_object('id', pr.id, 'name', pr.display_name, 'number', pr.pilot_number),
               'origin', o.icao_code, 'destination', d.icao_code,
               'aircraft_type', t.icao_code, 'aircraft_registration', f.aircraft_registration,
               'network', f.network,
               'scheduled_departure_at', f.scheduled_departure_at,
               'booked_at', b.created_at,
               'booking_expires_at', b.expires_at,
               'has_ofp', exists (select 1 from public.simbrief_ofps s where s.flight_id = f.id),
               'state', case
                          when f.scheduled_departure_at is not null and f.scheduled_departure_at < now() - interval '30 minutes' then 'late'
                          when b.expires_at < now() + interval '3 hours' then 'expiring'
                          else 'on_time'
                        end) as j
        from public.flights f
        join public.flight_bookings b on b.id = f.booking_id
        join public.profiles pr on pr.id = f.user_id
        join public.airports o on o.id = f.origin_airport_id
        join public.airports d on d.id = f.destination_airport_id
        join public.aircraft_types t on t.id = f.aircraft_type_id
       where f.airline_id = any (v_airlines)
         and f.status = 'scheduled'
         and b.status = 'active'
         and b.expires_at > now()
    ) x;

  -- PIREP por revisar, del más antiguo al más nuevo
  select coalesce(jsonb_agg(x.j order by x.created_at), '[]'::jsonb) into v_queue
    from (
      select p.created_at, jsonb_build_object(
               'id', p.id,
               'callsign', p.callsign,
               'flight_number', p.flight_number,
               'pilot', jsonb_build_object('id', pr.id, 'name', pr.display_name, 'number', pr.pilot_number),
               'origin', o.icao_code, 'destination', d.icao_code, 'arrival', a.icao_code,
               'diverted', p.diverted,
               'score', p.score,
               'has_critical', p.has_critical,
               'critical_labels', coalesce((
                  select jsonb_agg(f ->> 'label') from jsonb_array_elements(p.findings) f
                   where coalesce((f ->> 'critical')::boolean, false)
                     and not coalesce((f ->> 'waived')::boolean, false)), '[]'::jsonb),
               'block_minutes', p.block_minutes,
               'landing_vs_fpm', p.landing_vs_fpm,
               'pilot_comment', p.pilot_comment is not null,
               'created_at', p.created_at) as j
        from public.pireps p
        join public.profiles pr on pr.id = p.user_id
        join public.airports o on o.id = p.origin_airport_id
        join public.airports d on d.id = p.destination_airport_id
        left join public.airports a on a.id = p.arrival_airport_id
       where p.airline_id = any (v_airlines) and p.status = 'pending'
    ) x;

  -- Flota: ubicación, uso y desgaste
  select coalesce(jsonb_agg(x.j order by x.registration), '[]'::jsonb) into v_fleet
    from (
      select ac.registration, jsonb_build_object(
               'id', ac.id,
               'airline_icao', al.icao_code,
               'registration', ac.registration,
               'fleet_number', ac.fleet_number,
               'aircraft_type', t.icao_code,
               'status', ac.status,
               'current_airport', cur.icao_code,
               'base_airport', base.icao_code,
               'away_from_base', cur.id is not null and base.id is not null and cur.id <> base.id,
               'total_minutes', ac.total_minutes,
               'cycles', ac.cycles,
               'last_flight_at', ac.last_flight_at,
               'usage', case when fl.id is not null then 'flying' when bk.id is not null then 'booked' end,
               'usage_callsign', coalesce(fl.callsign, bkf.callsign),
               'usage_pilot', coalesce(flp.display_name, bkp.display_name)) as j
        from public.aircraft ac
        join public.airlines al on al.id = ac.airline_id
        join public.aircraft_types t on t.id = ac.aircraft_type_id
        left join public.airports cur on cur.id = ac.current_airport_id
        left join public.airports base on base.id = ac.base_airport_id
        left join lateral (
          select f.id, f.callsign, f.user_id from public.flights f
           where f.aircraft_id = ac.id and f.status = 'in_progress'
           order by f.started_at desc nulls last limit 1
        ) fl on true
        left join public.profiles flp on flp.id = fl.user_id
        left join public.flight_bookings bk on bk.aircraft_id = ac.id and bk.status = 'active' and bk.expires_at > now()
        left join public.flights bkf on bkf.booking_id = bk.id
        left join public.profiles bkp on bkp.id = bk.user_id
       where ac.airline_id = any (v_airlines)
    ) x;

  select jsonb_build_object(
           'flights_completed_24h', (select count(*) from public.flights f
                                      where f.airline_id = any (v_airlines) and f.status = 'completed'
                                        and f.completed_at >= now() - interval '24 hours'),
           'bookings_expired_24h', (select count(*) from public.flight_bookings b
                                     where b.airline_id = any (v_airlines) and b.status = 'expired'
                                       and b.closed_at >= now() - interval '24 hours'),
           'pireps_reviewed_7d', (select count(*) from public.pireps p
                                   where p.airline_id = any (v_airlines) and p.status <> 'pending'
                                     and p.reviewed_at >= now() - interval '7 days'))
    into v_counts;

  return jsonb_build_object(
    'airlines', to_jsonb(v_airlines),
    'departures', v_departures,
    'pirep_queue', v_queue,
    'fleet', v_fleet,
    'counts', v_counts
  );
end;
$$;

create or replace function public.get_pilot_performance(p_airline_id uuid default null, p_days integer default 90)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_airlines uuid[] := private.scope_airlines(p_airline_id, true);
  v_days integer := least(greatest(coalesce(p_days, 90), 7), 365);
  v_from timestamptz := now() - make_interval(days => v_days);
  v_prev timestamptz := now() - make_interval(days => v_days * 2);
begin
  if cardinality(v_airlines) = 0 then
    raise exception 'El rendimiento de pilotos es para el jefe de operaciones y el administrador' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'days', v_days,
    'pilots', coalesce((
      select jsonb_agg(x.j order by x.last_flight_at desc nulls last, x.name)
        from (
          select pr.display_name as name, st.last_flight_at,
                 jsonb_build_object(
                   'user_id', pr.id,
                   'name', pr.display_name,
                   'number', pr.pilot_number,
                   'airlines', m.airlines,
                   'member_since', m.member_since,
                   'flights', coalesce(st.flights, 0),
                   'accepted', coalesce(st.accepted, 0),
                   'rejected', coalesce(st.rejected, 0),
                   'pending', coalesce(st.pending, 0),
                   'block_minutes', coalesce(st.block_minutes, 0),
                   'average_score', st.average_score,
                   'previous_average_score', st.previous_average_score,
                   'average_landing_vs_fpm', st.average_landing_vs_fpm,
                   'critical_findings', coalesce(st.critical_findings, 0),
                   'top_findings', coalesce(tf.labels, '[]'::jsonb),
                   'total_block_minutes', coalesce(st.total_block_minutes, 0),
                   'last_flight_at', st.last_flight_at) as j
            from (
              select mm.user_id,
                     jsonb_agg(distinct al.icao_code) as airlines,
                     min(mm.created_at) as member_since
                from public.airline_memberships mm
                join public.airlines al on al.id = mm.airline_id
               where mm.airline_id = any (v_airlines) and mm.status = 'active' and 'pilot' = any (mm.roles)
               group by mm.user_id
            ) m
            join public.profiles pr on pr.id = m.user_id
            left join lateral (
              select count(*) filter (where coalesce(p.block_on_at, p.landing_at, p.created_at) >= v_from) as flights,
                     count(*) filter (where coalesce(p.block_on_at, p.landing_at, p.created_at) >= v_from and p.status = 'accepted') as accepted,
                     count(*) filter (where coalesce(p.block_on_at, p.landing_at, p.created_at) >= v_from and p.status = 'rejected') as rejected,
                     count(*) filter (where coalesce(p.block_on_at, p.landing_at, p.created_at) >= v_from and p.status = 'pending') as pending,
                     sum(p.block_minutes) filter (where coalesce(p.block_on_at, p.landing_at, p.created_at) >= v_from and p.status = 'accepted') as block_minutes,
                     round(avg(p.score) filter (where coalesce(p.block_on_at, p.landing_at, p.created_at) >= v_from and p.status <> 'rejected'), 1) as average_score,
                     round(avg(p.score) filter (where coalesce(p.block_on_at, p.landing_at, p.created_at) >= v_prev and coalesce(p.block_on_at, p.landing_at, p.created_at) < v_from and p.status <> 'rejected'), 1) as previous_average_score,
                     round(avg(p.landing_vs_fpm) filter (where coalesce(p.block_on_at, p.landing_at, p.created_at) >= v_from and p.status <> 'rejected')) as average_landing_vs_fpm,
                     count(*) filter (where coalesce(p.block_on_at, p.landing_at, p.created_at) >= v_from and p.has_critical) as critical_findings,
                     sum(p.block_minutes) filter (where p.status = 'accepted') as total_block_minutes,
                     max(coalesce(p.block_on_at, p.landing_at, p.created_at)) as last_flight_at
                from public.pireps p
               where p.user_id = m.user_id and p.airline_id = any (v_airlines) and p.status <> 'archived'
            ) st on true
            left join lateral (
              select jsonb_agg(z.label order by z.n desc) as labels
                from (
                  select max(f ->> 'label') as label, count(*) as n
                    from public.pireps p, jsonb_array_elements(p.findings) f
                   where p.user_id = m.user_id and p.airline_id = any (v_airlines) and p.status <> 'archived'
                     and coalesce(p.block_on_at, p.landing_at, p.created_at) >= v_from and coalesce((f ->> 'penalty')::integer, 0) > 0
                     and not coalesce((f ->> 'waived')::boolean, false)
                   group by f ->> 'code'
                   order by count(*) desc
                   limit 3
                ) z
            ) tf on true
        ) x
    ), '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Permisos
-- -----------------------------------------------------------------------------
revoke all on function public.archive_pirep(uuid, text) from public, anon;
revoke all on function public.restore_pirep(uuid) from public, anon;
revoke all on function public.waive_pirep_finding(uuid, text, text, boolean) from public, anon;
revoke all on function public.get_pilot_landing_stats(uuid, uuid, integer) from public, anon;
grant execute on function public.archive_pirep(uuid, text) to authenticated;
grant execute on function public.restore_pirep(uuid) to authenticated;
grant execute on function public.waive_pirep_finding(uuid, text, text, boolean) to authenticated;
grant execute on function public.get_pilot_landing_stats(uuid, uuid, integer) to authenticated;
