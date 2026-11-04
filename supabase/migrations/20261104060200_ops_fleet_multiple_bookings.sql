-- =============================================================================
-- Operations Center: con la flota libre una aeronave puede tener varias reservas
-- activas. La flota muestra una fila por aeronave, la primera reserva y cuántas
-- tiene (active_bookings). (2026-11-04)
-- =============================================================================
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
               'usage_callsign', coalesce(fl.callsign, bk.callsign),
               'active_bookings', coalesce(bk.n, 0),
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
        left join lateral (
          select b.id, b.user_id, bf.callsign, count(*) over () as n
            from public.flight_bookings b
            left join public.flights bf on bf.booking_id = b.id
           where b.aircraft_id = ac.id and b.status = 'active' and b.expires_at > now()
           order by b.created_at
           limit 1
        ) bk on true
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
