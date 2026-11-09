-- =============================================================================
-- LAM Virtual ACARS — Legs de tour pendientes del piloto
--
-- Un vuelo solo cuenta para un tour si se reservó desde el tour (book_tour_leg
-- fija flights.tour_leg_id y tour_enrollment_id). Un vuelo normal con la misma
-- ruta no cuenta. Para que el piloto no se equivoque, Flight Booking avisa cuando
-- una ruta coincide con un leg que le falta de un tour en el que está inscrito.
-- =============================================================================

create function public.get_my_tour_legs()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'tour_id', t.id, 'code', t.code, 'name', t.name, 'color', t.color,
    'enrollment_id', e.id, 'airline_id', e.airline_id,
    'leg_id', s.leg_id, 'leg_number', s.leg_number, 'state', s.state,
    'origin_airport_id', l.origin_airport_id, 'destination_airport_id', l.destination_airport_id,
    'origin_icao', o.icao_code, 'destination_icao', d.icao_code
  ) order by t.code, s.leg_number), '[]'::jsonb)
  from public.tour_enrollments e
  join public.tours t on t.id = e.tour_id
  cross join lateral private.tour_leg_states(e.id) s
  join public.tour_legs l on l.id = s.leg_id
  join public.airports o on o.id = l.origin_airport_id
  join public.airports d on d.id = l.destination_airport_id
  where e.user_id = (select auth.uid())
    and e.status = 'approved'
    and t.status = 'published'
    and (t.starts_on is null or t.starts_on <= current_date)
    and (t.ends_on is null or t.ends_on >= current_date)
    and s.state in ('open', 'repeat', 'booked');
$$;
revoke all on function public.get_my_tour_legs() from public, anon;
grant execute on function public.get_my_tour_legs() to authenticated;
