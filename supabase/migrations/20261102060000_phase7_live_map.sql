-- =============================================================================
-- LAM Virtual ACARS — Fase 7.1: figura del avión en el mapa por categoría
-- Cada tipo tiene una categoría para el mapa (ligero, jet ejecutivo,
-- turbohélice, jet regional, pasillo único, fuselaje ancho, cuatrimotor). Se
-- calcula por omisión a partir de la estela, el motor, la capacidad y el
-- designador, y el superadministrador puede cambiarla por tipo.
-- =============================================================================

create function private.default_map_category(p_icao text, p_wake text, p_engine text, p_max_passengers integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_engine = 'piston' then 'light'
    when p_engine = 'turboprop' and (p_wake = 'L' or coalesce(p_max_passengers, 0) < 20) then 'light'
    when p_engine = 'turboprop' then 'turboprop'
    when p_wake = 'J' or p_icao ~ '^(B74|A34|A38|IL96|IL76|C5|A124|A225)' then 'jumbo'
    when p_wake = 'H' then 'widebody'
    when p_wake = 'L' or coalesce(p_max_passengers, 999) < 20 then 'business_jet'
    when coalesce(p_max_passengers, 999) <= 110 then 'regional_jet'
    else 'narrowbody'
  end;
$$;

alter table public.aircraft_types
  add column map_category text check (map_category in ('light', 'business_jet', 'turboprop', 'regional_jet', 'narrowbody', 'widebody', 'jumbo'));
comment on column public.aircraft_types.map_category is
  'Figura del avión en el mapa en vivo. Por omisión se calcula con private.default_map_category; el superadministrador puede cambiarla.';

update public.aircraft_types
   set map_category = private.default_map_category(icao_code, wake_category, engine_type, max_passengers)
 where map_category is null;

create function private.aircraft_types_map_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.map_category is null then
    new.map_category := private.default_map_category(new.icao_code, new.wake_category, new.engine_type, new.max_passengers);
  end if;
  return new;
end;
$$;
create trigger aircraft_types_map_category before insert or update on public.aircraft_types
  for each row execute function private.aircraft_types_map_category();

alter table public.aircraft_types alter column map_category set not null;
grant update (map_category) on public.aircraft_types to authenticated;

-- Vuelos en curso con la categoría de su tipo.
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
          'map_category', t.map_category,
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
-- Fase 7.2: traza completa de un vuelo en curso, por partes
--   Puntos: [seq, ms, lat, lon, alt, gs, ias, vs, rumbo, en tierra (0/1), fase,
--            dirección del viento, viento kt, combustible kg], después de p_after_seq.
--   Eventos: los de seq mayor que p_after_event_seq (para los marcadores).
--   Lo ven los miembros de la aerolínea del vuelo mientras está en curso.
-- -----------------------------------------------------------------------------
create function public.get_live_flight_trace(p_flight_id uuid, p_after_seq integer default -1, p_after_event_seq integer default -1)
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
    return jsonb_build_object('active', false, 'points', '[]'::jsonb, 'events', '[]'::jsonb);
  end if;
  if not (private.is_org_admin() or private.is_airline_member(v_session.airline_id)) then
    raise exception 'No tienes acceso a esta aerolínea' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'active', true,
    'session_id', v_session.id,
    'points', coalesce((
      select jsonb_agg(jsonb_build_array(
               t.seq, floor(extract(epoch from t.sampled_at) * 1000)::bigint,
               round(t.latitude::numeric, 5), round(t.longitude::numeric, 5), t.altitude_ft,
               t.gs_kt, t.ias_kt, t.vs_fpm, t.heading_deg, case when t.on_ground then 1 else 0 end, t.phase,
               t.wind_dir_deg, t.wind_kt, t.fuel_kg) order by t.seq)
        from public.flight_track_points t
       where t.flight_id = p_flight_id and t.session_id = v_session.id and t.seq > coalesce(p_after_seq, -1)
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'seq', e.seq, 'type', e.type, 'phase', e.phase, 'occurred_at', e.occurred_at,
               'latitude', e.latitude, 'longitude', e.longitude, 'altitude_ft', e.altitude_ft,
               'data', e.data - 'title' - 'unavailable') order by e.seq)
        from public.flight_events e
       where e.session_id = v_session.id and e.seq > coalesce(p_after_event_seq, -1)
         and e.type in ('block_off', 'takeoff', 'touchdown', 'block_on', 'engine_start', 'engine_shutdown', 'sim_paused',
                        'overspeed', 'stall', 'slew', 'crash', 'phase_change', 'note')
    ), '[]'::jsonb)
  );
end;
$$;
comment on function public.get_live_flight_trace(uuid, integer, integer) is
  'Traza completa y eventos de un vuelo en curso (por partes, después de una secuencia) para los miembros de su aerolínea.';
revoke all on function public.get_live_flight_trace(uuid, integer, integer) from public, anon;
grant execute on function public.get_live_flight_trace(uuid, integer, integer) to authenticated;
revoke all on function private.default_map_category(text, text, text, integer) from public;
