-- =============================================================================
-- LAM Virtual ACARS — El PIREP dice si fue de un tour o de un evento
--
-- get_pirep_programs(ids) devuelve, por cada PIREP que quien llama puede ver
-- (las mismas reglas que pireps_select), el tour (código, nombre, color, leg
-- y total de legs) o el evento (folio, nombre, color) de su vuelo. La lista de
-- PIREP y el detalle lo muestran como etiqueta con enlace.
-- =============================================================================

create function public.get_pirep_programs(p_pirep_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(p.id::text, jsonb_build_object(
    'tour', case when l.id is not null then jsonb_build_object(
      'id', t.id, 'code', t.code, 'name', t.name, 'color', t.color, 'leg', l.leg_number,
      'legs', (select count(*) from public.tour_legs x where x.tour_id = t.id)) end,
    'event', case when ev.id is not null then jsonb_build_object(
      'id', ev.id, 'folio', ev.folio, 'name', ev.name, 'color', ev.color) end
  )), '{}'::jsonb)
  from public.pireps p
  join public.flights f on f.id = p.flight_id
  left join public.tour_legs l on l.id = f.tour_leg_id
  left join public.tours t on t.id = l.tour_id
  left join public.event_registrations r on r.id = f.event_registration_id
  left join public.events ev on ev.id = r.event_id
  where p.id = any (p_pirep_ids[1:500])
    and (l.id is not null or ev.id is not null)
    and (p.user_id = (select auth.uid()) or private.can_staff_airline(p.airline_id))
    and (p.status <> 'archived' or private.is_org_admin());
$$;
revoke all on function public.get_pirep_programs(uuid[]) from public, anon;
grant execute on function public.get_pirep_programs(uuid[]) to authenticated;
