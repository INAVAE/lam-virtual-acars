-- =============================================================================
-- LAM Virtual ACARS — Fase 6: mapa en vivo, estadísticas y Operations Center
--
-- Todo se lee con funciones SECURITY DEFINER que comprueban el acceso y
-- devuelven solo lo necesario, sin abrir las tablas a más lectores:
--   * get_live_flights        miembros: vuelos en curso de sus aerolíneas
--                             (el staff recibe además las alertas).
--   * get_live_flight_track   miembros: traza de un vuelo mientras está en curso.
--   * get_airline_statistics  miembros: totales, meses, rutas, aeronaves,
--                             aterrizajes y ranking de pilotos (PIREP aceptados).
--   * get_operations_overview staff: salidas y reservas, cola de PIREP y flota.
--   * get_pilot_performance   staff: rendimiento de cada piloto en un periodo.
-- La web consulta cada 10 s (mapa) o cada minuto (resto); no usa Realtime (ADR 0008).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Aerolíneas a las que aplica una consulta
-- -----------------------------------------------------------------------------
create function private.scope_airlines(p_airline_id uuid, p_staff boolean default false)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_admin boolean;
  v_airlines uuid[];
begin
  if v_uid is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  v_admin := private.is_org_admin();

  if p_airline_id is not null then
    if not (v_admin or (case when p_staff then private.can_staff_airline(p_airline_id) else private.is_airline_member(p_airline_id) end)) then
      raise exception 'No tienes acceso a esta aerolínea' using errcode = '42501';
    end if;
    return array[p_airline_id];
  end if;

  if v_admin then
    select coalesce(array_agg(a.id), '{}') into v_airlines from public.airlines a;
    return v_airlines;
  end if;

  select coalesce(array_agg(m.airline_id), '{}') into v_airlines
    from public.airline_memberships m
    join public.profiles p on p.id = m.user_id
   where m.user_id = v_uid
     and m.status = 'active'
     and p.account_status = 'active'
     and (not p_staff or m.roles && '{airline_admin,ops_chief}'::public.airline_role[]);
  return v_airlines;
end;
$$;
comment on function private.scope_airlines(uuid, boolean) is
  'Aerolíneas que consulta quien llama: la pedida (si tiene acceso) o todas las suyas. Con p_staff, solo donde es staff.';

-- -----------------------------------------------------------------------------
-- Alertas de un vuelo en curso (para el staff)
-- -----------------------------------------------------------------------------
create function private.live_flight_alerts(
  p_session_id uuid,
  p_last_contact timestamptz,
  p_phase text,
  p_remaining_nm double precision,
  p_started_at timestamptz,
  p_planned_minutes integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_alerts jsonb := '[]'::jsonb;
  v_silence numeric := extract(epoch from (now() - p_last_contact)) / 60.0;
  v_pause record;
  v_elapsed numeric := extract(epoch from (now() - p_started_at)) / 60.0;
begin
  -- Conector sin enviar datos
  if v_silence >= 15 then
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'code', 'connection_lost', 'level', 'danger', 'at', p_last_contact, 'value', floor(v_silence)));
  elsif v_silence >= 2 then
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'code', 'no_signal', 'level', 'warn', 'at', p_last_contact, 'value', floor(v_silence)));
  end if;

  -- Simulador en pausa (último evento de pausa sin reanudar)
  select e.type, e.occurred_at into v_pause
    from public.flight_events e
   where e.session_id = p_session_id and e.type in ('sim_paused', 'sim_resumed')
   order by e.occurred_at desc, e.seq desc
   limit 1;
  if found and v_pause.type = 'sim_paused' then
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'code', 'paused',
      'level', case when now() - v_pause.occurred_at > interval '10 minutes' then 'warn' else 'info' end,
      'at', v_pause.occurred_at,
      'value', floor(extract(epoch from (now() - v_pause.occurred_at)) / 60.0)));
  end if;

  -- Aproximación lejos del destino: posible desvío
  if p_phase in ('approach', 'landing') and p_remaining_nm > 25 then
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'code', 'diversion_risk', 'level', 'warn', 'value', round(p_remaining_nm::numeric)));
  end if;

  -- Vuelo mucho más largo que lo previsto
  if p_planned_minutes > 0 and v_elapsed > p_planned_minutes * 1.5 + 45 then
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'code', 'overdue', 'level', 'info', 'value', floor(v_elapsed)));
  end if;

  -- Avisos del vuelo: sobrevelocidad, pérdida, slew, choque, actitud
  v_alerts := v_alerts || coalesce((
    select jsonb_agg(jsonb_build_object(
             'code', case when e.type = 'note' then 'attitude' else e.type end,
             'level', case when e.type in ('crash', 'slew', 'stall') then 'danger' else 'warn' end,
             'at', e.occurred_at,
             'value', case when e.type = 'note' then e.data -> 'peak_deg' else e.data -> 'ias_kt' end,
             'axis', e.data ->> 'axis')
           order by e.occurred_at desc)
      from (
        select e.*
          from public.flight_events e
         where e.session_id = p_session_id
           and (e.type in ('overspeed', 'stall', 'slew', 'crash')
                or (e.type = 'note' and e.data ->> 'kind' = 'attitude'))
         order by e.occurred_at desc
         limit 5
      ) e
  ), '[]'::jsonb);

  return v_alerts;
end;
$$;

-- -----------------------------------------------------------------------------
-- Vuelos en curso
-- -----------------------------------------------------------------------------
create function public.get_live_flights(p_airline_id uuid default null)
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
            'heading_deg', p.heading_deg, 'vs_fpm', p.vs_fpm, 'on_ground', p.on_ground) end,
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
comment on function public.get_live_flights(uuid) is
  'Vuelos en curso de las aerolíneas de quien llama (o de una). El staff recibe también las alertas de cada vuelo.';

-- Traza de un vuelo en curso: [lat, lon, altitud, fase] por punto.
create function public.get_live_flight_track(p_flight_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_session public.flight_sessions;
begin
  if (select auth.uid()) is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  select * into v_session from public.flight_sessions s where s.flight_id = p_flight_id and s.status = 'active';
  if not found then
    return '[]'::jsonb;
  end if;
  if not (private.is_org_admin() or private.is_airline_member(v_session.airline_id)) then
    raise exception 'No tienes acceso a esta aerolínea' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_array(round(t.latitude::numeric, 5), round(t.longitude::numeric, 5), t.altitude_ft, t.phase) order by t.seq)
      from public.flight_track_points t
     where t.flight_id = p_flight_id and t.session_id = v_session.id
  ), '[]'::jsonb);
end;
$$;
comment on function public.get_live_flight_track(uuid) is
  'Traza de un vuelo mientras está en curso, para los miembros de su aerolínea. Al terminar, la traza solo la ven el piloto y el staff.';

-- -----------------------------------------------------------------------------
-- Estadísticas de la aerolínea (PIREP aceptados)
-- -----------------------------------------------------------------------------
create function public.get_airline_statistics(p_airline_id uuid default null, p_months integer default 12)
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
         and coalesce(p.block_on_at, p.landing_at, p.created_at) >= v_from
         and coalesce((f ->> 'penalty')::integer, 0) > 0
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
comment on function public.get_airline_statistics(uuid, integer) is
  'Estadísticas de las aerolíneas de quien llama (o de una) a partir de los PIREP aceptados, con ranking de pilotos.';

-- -----------------------------------------------------------------------------
-- Operations Center: salidas y reservas, cola de PIREP y flota (staff)
-- -----------------------------------------------------------------------------
create function public.get_operations_overview(p_airline_id uuid default null)
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
                   where coalesce((f ->> 'critical')::boolean, false)), '[]'::jsonb),
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
comment on function public.get_operations_overview(uuid) is
  'Operations Center (staff): vuelos reservados por iniciar, PIREP por revisar, flota y conteos del día.';

-- -----------------------------------------------------------------------------
-- Rendimiento de los pilotos en un periodo (staff)
-- -----------------------------------------------------------------------------
create function public.get_pilot_performance(p_airline_id uuid default null, p_days integer default 90)
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
               where p.user_id = m.user_id and p.airline_id = any (v_airlines)
            ) st on true
            left join lateral (
              select jsonb_agg(z.label order by z.n desc) as labels
                from (
                  select max(f ->> 'label') as label, count(*) as n
                    from public.pireps p, jsonb_array_elements(p.findings) f
                   where p.user_id = m.user_id and p.airline_id = any (v_airlines)
                     and coalesce(p.block_on_at, p.landing_at, p.created_at) >= v_from and coalesce((f ->> 'penalty')::integer, 0) > 0
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
comment on function public.get_pilot_performance(uuid, integer) is
  'Rendimiento de cada piloto en los últimos p_days días (staff): vuelos, puntaje y su tendencia, aterrizajes y faltas frecuentes.';

-- -----------------------------------------------------------------------------
-- Dashboard: vuelos en el aire y horas de la aerolínea en 30 días
-- -----------------------------------------------------------------------------
create or replace function public.get_dashboard_summary(p_airline_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_admin boolean;
  v_airlines uuid[];
  v_scope text;
begin
  if v_uid is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;

  v_is_admin := private.is_org_admin();

  if p_airline_id is not null then
    if not (v_is_admin or private.is_airline_member(p_airline_id)) then
      raise exception 'No tienes acceso a esta aerolínea' using errcode = '42501';
    end if;
    v_airlines := array[p_airline_id];
    v_scope := 'airline';
  elsif v_is_admin then
    select coalesce(array_agg(a.id), '{}') into v_airlines from public.airlines a;
    v_scope := 'organization';
  else
    select coalesce(array_agg(m.airline_id), '{}') into v_airlines
    from public.airline_memberships m
    where m.user_id = v_uid and m.status = 'active';
    v_scope := 'member';
  end if;

  return jsonb_build_object(
    'scope', v_scope,
    'airlines_total', (select count(*) from public.airlines a where a.id = any (v_airlines)),
    'airlines_active', (select count(*) from public.airlines a where a.id = any (v_airlines) and a.is_active),
    'pilots_active_members', (
      select count(distinct m.user_id)
      from public.airline_memberships m
      where m.airline_id = any (v_airlines) and m.status = 'active' and 'pilot' = any (m.roles)
    ),
    'pending_requests', (
      select count(*)
      from public.airline_memberships m
      where m.airline_id = any (v_airlines)
        and m.status = 'pending'
        and private.can_manage_airline(m.airline_id)
    ),
    'profiles_total', case
      when v_is_admin and p_airline_id is null then (select count(*) from public.profiles)
    end,
    'bookings_active', (
      select count(*)
      from public.flight_bookings b
      where b.airline_id = any (v_airlines) and b.status = 'active' and b.expires_at > now()
    ),
    'my_bookings_active', (
      select count(*)
      from public.flight_bookings b
      where b.user_id = v_uid and b.airline_id = any (v_airlines) and b.status = 'active' and b.expires_at > now()
    ),
    'pireps_pending_review', (
      select count(*)
      from public.pireps p
      where p.airline_id = any (v_airlines) and p.status = 'pending' and private.can_staff_airline(p.airline_id)
    ),
    'my_pireps_pending', (
      select count(*)
      from public.pireps p
      where p.user_id = v_uid and p.airline_id = any (v_airlines) and p.status = 'pending'
    ),
    'my_block_minutes', (
      select coalesce(sum(p.block_minutes), 0)
      from public.pireps p
      where p.user_id = v_uid and p.airline_id = any (v_airlines) and p.status = 'accepted'
    ),
    'my_flights_accepted', (
      select count(*)
      from public.pireps p
      where p.user_id = v_uid and p.airline_id = any (v_airlines) and p.status = 'accepted'
    ),
    'live_flights', (
      select count(*)
      from public.flight_sessions s
      where s.airline_id = any (v_airlines) and s.status = 'active'
        and s.last_contact_at > now() - interval '12 hours'
    ),
    'airline_block_minutes_30d', (
      select coalesce(sum(p.block_minutes), 0)
      from public.pireps p
      where p.airline_id = any (v_airlines) and p.status = 'accepted'
        and coalesce(p.block_on_at, p.landing_at, p.created_at) >= now() - interval '30 days'
    ),
    'airline_flights_30d', (
      select count(*)
      from public.pireps p
      where p.airline_id = any (v_airlines) and p.status = 'accepted'
        and coalesce(p.block_on_at, p.landing_at, p.created_at) >= now() - interval '30 days'
    )
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Permisos
-- -----------------------------------------------------------------------------
revoke all on function private.scope_airlines(uuid, boolean) from public;
revoke all on function private.live_flight_alerts(uuid, timestamptz, text, double precision, timestamptz, integer) from public;

revoke all on function public.get_live_flights(uuid) from public, anon;
revoke all on function public.get_live_flight_track(uuid) from public, anon;
revoke all on function public.get_airline_statistics(uuid, integer) from public, anon;
revoke all on function public.get_operations_overview(uuid) from public, anon;
revoke all on function public.get_pilot_performance(uuid, integer) from public, anon;
grant execute on function public.get_live_flights(uuid) to authenticated;
grant execute on function public.get_live_flight_track(uuid) to authenticated;
grant execute on function public.get_airline_statistics(uuid, integer) to authenticated;
grant execute on function public.get_operations_overview(uuid) to authenticated;
grant execute on function public.get_pilot_performance(uuid, integer) to authenticated;
