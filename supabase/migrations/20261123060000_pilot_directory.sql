-- =============================================================================
-- LAM Virtual ACARS — directorio de pilotos, tours en el perfil y penalizaciones
--
-- 1. get_pilot_directory(): pilotos activos y solicitudes pendientes de todas
--    las aerolíneas, con su aerolínea. Lo ve cualquier piloto activo de alguna
--    aerolínea (y el superadministrador). Sin correos: esos siguen siendo solo
--    para el staff (lista de Pilots de cada aerolínea).
-- 2. get_pilot_profile(): cualquier piloto activo ve el perfil de cualquier
--    piloto con membresía activa o pendiente (antes solo los de su misma
--    aerolínea). Las membresías pendientes se ven (así se sabe que aún no lo
--    aprueban). Nuevo: tours en los que participa o que terminó, con su avance.
-- 3. waive_pirep_finding(): el superadministrador anula o restaura faltas de
--    cualquier PIREP, aunque ya esté calificado o archivado; el administrador de
--    la aerolínea, en cualquier PIREP de su aerolínea; el jefe de operaciones,
--    como antes, solo en PIREP en revisión.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ¿Quién puede ver a los demás pilotos? Superadministrador o piloto activo
-- (cuenta activa y al menos una membresía activa).
-- -----------------------------------------------------------------------------
create function private.can_see_pilot_directory()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_admin() or exists (
    select 1
      from public.airline_memberships m
      join public.profiles p on p.id = m.user_id
     where m.user_id = (select auth.uid()) and m.status = 'active' and p.account_status = 'active'
  );
$$;
revoke all on function private.can_see_pilot_directory() from public, anon;
grant execute on function private.can_see_pilot_directory() to authenticated;

-- -----------------------------------------------------------------------------
-- 1. Directorio
-- -----------------------------------------------------------------------------
create function public.get_pilot_directory()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  if not private.can_see_pilot_directory() then
    raise exception 'El directorio de pilotos se ve cuando ya eres miembro activo de una aerolínea'
      using errcode = '42501', hint = 'not_member';
  end if;

  return coalesce((
    select jsonb_agg(x order by x ->> 'airline_name', (x ->> 'status') = 'pending', x ->> 'display_name')
      from (
        select jsonb_build_object(
                 'membership_id', m.id,
                 'airline_id', a.id,
                 'airline_name', a.name,
                 'airline_icao', a.icao_code,
                 'airline_color', a.brand_primary_color,
                 'status', m.status,
                 'roles', m.roles,
                 'requested_at', m.requested_at,
                 'decided_at', m.decided_at,
                 'user_id', p.id,
                 'pilot_number', p.pilot_number,
                 'display_name', p.display_name,
                 'country_code', p.country_code,
                 'avatar_url', p.avatar_url,
                 'ivao_vid', p.ivao_vid,
                 'flights', coalesce(s.flights, 0),
                 'block_minutes', coalesce(s.block_minutes, 0),
                 'last_flight_at', s.last_flight_at) x
          from public.airline_memberships m
          join public.airlines a on a.id = m.airline_id
          join public.profiles p on p.id = m.user_id
          left join lateral (
            select count(*) as flights, sum(r.block_minutes) as block_minutes, max(coalesce(r.block_on_at, r.created_at)) as last_flight_at
              from public.pireps r
             where r.user_id = m.user_id and r.airline_id = m.airline_id and r.status = 'accepted'
          ) s on true
         where m.status in ('active', 'pending')
           and p.account_status = 'active'
           and a.is_active
      ) d
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.get_pilot_directory() from public, anon;
grant execute on function public.get_pilot_directory() to authenticated;
comment on function public.get_pilot_directory() is
  'Pilotos activos y solicitudes pendientes de todas las aerolíneas activas, con su aerolínea, país, VID de IVAO y vuelos aceptados. Sin correos. Para pilotos activos y el superadministrador.';

-- -----------------------------------------------------------------------------
-- 2. Perfil del piloto
-- -----------------------------------------------------------------------------
create or replace function public.get_pilot_profile(p_pilot_number integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  p public.profiles;
  v_self boolean;
  v_staff boolean;
  v_admin boolean;
  v_peer boolean;
begin
  if v_uid is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  select * into p from public.profiles where pilot_number = p_pilot_number;
  if not found then
    raise exception 'No existe el piloto LAM%', p_pilot_number using errcode = 'P0002';
  end if;

  v_self := p.id = v_uid;
  v_admin := private.is_org_admin();
  v_staff := v_admin or private.is_staff_for_user(p.id);
  -- Cualquier piloto activo ve a quien ya es miembro o solicitó ingreso a una aerolínea.
  v_peer := private.can_see_pilot_directory()
    and p.account_status = 'active'
    and exists (select 1 from public.airline_memberships theirs where theirs.user_id = p.id and theirs.status in ('active', 'pending'));
  if not (v_self or v_staff or v_peer) then
    raise exception 'Solo ves el perfil de pilotos de LAM cuando ya eres miembro activo de una aerolínea' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'viewer', jsonb_build_object('self', v_self, 'staff', v_staff, 'admin', v_admin),
    'profile', jsonb_build_object(
      'user_id', p.id,
      'pilot_number', p.pilot_number,
      'display_name', p.display_name,
      'email', case when v_self or v_staff then p.email end,
      'country_code', p.country_code,
      'avatar_url', p.avatar_url,
      'bio', p.bio,
      'ivao_vid', p.ivao_vid,
      'discord_username', p.discord_username,
      'simbrief_username', case when v_self or v_staff then p.simbrief_username end,
      'time_zone', p.time_zone,
      'joined_at', p.joined_at,
      'account_status', p.account_status,
      'last_sign_in_at', case when v_self or v_staff then (select u.last_sign_in_at from auth.users u where u.id = p.id) end,
      'is_superadmin', exists (select 1 from public.organization_members m where m.user_id = p.id and m.role = 'superadmin'),
      'primary_airline_id', p.primary_airline_id
    ),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
               'airline_id', a.id, 'name', a.name, 'icao_code', a.icao_code, 'slug', a.slug, 'logo_path', a.logo_path, 'brand_primary_color', a.brand_primary_color,
               'status', m.status, 'roles', m.roles, 'requested_at', m.requested_at, 'decided_at', m.decided_at)
             order by (m.status = 'active') desc, a.name)
        from public.airline_memberships m join public.airlines a on a.id = m.airline_id
       where m.user_id = p.id and (v_self or v_staff or m.status in ('active', 'pending'))
    ), '[]'::jsonb),
    'totals', (
      select jsonb_build_object(
               'flights', count(*),
               'block_minutes', coalesce(sum(r.block_minutes), 0),
               'flight_minutes', coalesce(sum(r.flight_minutes), 0),
               'distance_nm', coalesce(sum(r.distance_nm), 0),
               'fuel_used_kg', coalesce(sum(r.fuel_used_kg) filter (where r.fuel_used_kg > 0), 0),
               'average_score', round(avg(r.score), 1),
               'average_landing_vs_fpm', round(avg(r.landing_vs_fpm)),
               'best_landing_vs_fpm', max(r.landing_vs_fpm),
               'airports', (select count(distinct x) from public.pireps q, lateral (values (q.origin_airport_id), (coalesce(q.arrival_airport_id, q.destination_airport_id))) v(x)
                             where q.user_id = p.id and q.status = 'accepted'),
               'first_flight_at', min(coalesce(r.block_on_at, r.created_at)),
               'last_flight_at', max(coalesce(r.block_on_at, r.created_at)),
               'pending', (select count(*) from public.pireps q where q.user_id = p.id and q.status = 'pending'),
               'rejected', (select count(*) from public.pireps q where q.user_id = p.id and q.status = 'rejected'))
        from public.pireps r where r.user_id = p.id and r.status = 'accepted'
    ),
    'by_airline', coalesce((
      select jsonb_agg(x order by (x ->> 'flights')::int desc) from (
        select jsonb_build_object('icao_code', a.icao_code, 'name', a.name, 'flights', count(*),
                                  'block_minutes', coalesce(sum(r.block_minutes), 0), 'distance_nm', coalesce(sum(r.distance_nm), 0)) x
          from public.pireps r join public.airlines a on a.id = r.airline_id
         where r.user_id = p.id and r.status = 'accepted'
         group by a.id) s
    ), '[]'::jsonb),
    'aircraft_types', coalesce((
      select jsonb_agg(x order by (x ->> 'flights')::int desc, x ->> 'icao_code') from (
        select jsonb_build_object('icao_code', t.icao_code, 'model', t.model, 'manufacturer', t.manufacturer, 'flights', count(*),
                                  'block_minutes', coalesce(sum(r.block_minutes), 0), 'distance_nm', coalesce(sum(r.distance_nm), 0),
                                  'last_at', max(coalesce(r.block_on_at, r.created_at))) x
          from public.pireps r join public.aircraft_types t on t.id = r.aircraft_type_id
         where r.user_id = p.id and r.status = 'accepted'
         group by t.id) s
    ), '[]'::jsonb),
    'routes', coalesce((
      select jsonb_agg(x order by (x ->> 'flights')::int desc, x ->> 'last_at' desc) from (
        select jsonb_build_object('origin', o.icao_code, 'destination', d.icao_code, 'origin_city', o.city, 'destination_city', d.city,
                                  'flights', count(*), 'distance_nm', round(avg(r.distance_nm)),
                                  'last_at', max(coalesce(r.block_on_at, r.created_at))) x
          from public.pireps r
          join public.airports o on o.id = r.origin_airport_id
          join public.airports d on d.id = coalesce(r.arrival_airport_id, r.destination_airport_id)
         where r.user_id = p.id and r.status = 'accepted'
         group by o.id, d.id
         order by count(*) desc, max(coalesce(r.block_on_at, r.created_at)) desc
         limit 30) s
    ), '[]'::jsonb),
    'monthly', coalesce((
      select jsonb_agg(jsonb_build_object('month', to_char(m.month, 'YYYY-MM'), 'flights', coalesce(s.flights, 0),
                                          'block_minutes', coalesce(s.block_minutes, 0)) order by m.month)
        from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m(month)
        left join (
          select date_trunc('month', coalesce(r.block_on_at, r.created_at)) as month, count(*) as flights, sum(r.block_minutes) as block_minutes
            from public.pireps r where r.user_id = p.id and r.status = 'accepted'
           group by 1) s on s.month = m.month
    ), '[]'::jsonb),
    'recent_pireps', coalesce((
      select jsonb_agg(x order by x ->> 'date' desc) from (
        select jsonb_build_object(
                 'id', r.id, 'folio', r.folio, 'callsign', r.callsign, 'status', r.status,
                 'airline_icao', a.icao_code, 'origin', o.icao_code, 'destination', d.icao_code,
                 'aircraft_icao', t.icao_code, 'registration', r.aircraft_registration,
                 'block_minutes', r.block_minutes, 'flight_minutes', r.flight_minutes, 'distance_nm', r.distance_nm,
                 'landing_vs_fpm', r.landing_vs_fpm, 'score', r.score,
                 'date', coalesce(r.block_on_at, r.created_at),
                 'can_open', v_self or v_admin or private.can_staff_airline(r.airline_id)) x
          from public.pireps r
          join public.airlines a on a.id = r.airline_id
          left join public.airports o on o.id = r.origin_airport_id
          left join public.airports d on d.id = coalesce(r.arrival_airport_id, r.destination_airport_id)
          left join public.aircraft_types t on t.id = r.aircraft_type_id
         where r.user_id = p.id
           and (r.status = 'accepted' or ((v_self or v_staff) and r.status in ('pending', 'rejected')))
         order by coalesce(r.block_on_at, r.created_at) desc
         limit 50) s
    ), '[]'::jsonb),
    'type_ratings', coalesce((
      select jsonb_agg(jsonb_build_object('airline_icao', a.icao_code, 'icao_code', t.icao_code, 'model', t.model, 'granted_at', tr.granted_at)
             order by a.icao_code, t.icao_code)
        from public.pilot_type_ratings tr
        join public.airlines a on a.id = tr.airline_id
        join public.aircraft_types t on t.id = tr.aircraft_type_id
       where tr.user_id = p.id
    ), '[]'::jsonb),
    'tour_badges', coalesce((
      select jsonb_agg(jsonb_build_object('tour_id', t.id, 'code', t.code, 'name', t.name, 'color', t.color, 'badge_path', t.badge_path,
                                          'airline_icao', a.icao_code, 'awarded_at', b.awarded_at) order by b.awarded_at desc)
        from public.pilot_badges b join public.tours t on t.id = b.tour_id join public.airlines a on a.id = t.airline_id
       where b.user_id = p.id and b.revoked_at is null
    ), '[]'::jsonb),
    -- Tours: en curso (inscripción aprobada o por aprobar) y terminados, con el avance por legs.
    'tours', coalesce((
      select jsonb_agg(x order by (x ->> 'enrollment_status') = 'completed', x ->> 'enrolled_at' desc) from (
        select jsonb_build_object(
                 'tour_id', t.id, 'code', t.code, 'name', t.name, 'color', t.color, 'badge_path', t.badge_path,
                 'airline_icao', a.icao_code, 'tour_status', t.status, 'starts_on', t.starts_on, 'ends_on', t.ends_on,
                 'enrollment_status', e.status, 'enrolled_at', e.created_at, 'completed_at', e.completed_at,
                 'legs', coalesce(s.legs, 0), 'accepted', coalesce(s.accepted, 0),
                 'in_review', coalesce(s.in_review, 0), 'booked', coalesce(s.booked, 0)) x
          from public.tour_enrollments e
          join public.tours t on t.id = e.tour_id
          join public.airlines a on a.id = t.airline_id
          left join lateral (
            select count(*) as legs,
                   count(*) filter (where ls.state = 'accepted') as accepted,
                   count(*) filter (where ls.state = 'in_review') as in_review,
                   count(*) filter (where ls.state = 'booked') as booked
              from private.tour_leg_states(e.id) ls
          ) s on true
         where e.user_id = p.id
           and e.status in ('pending', 'approved', 'completed')
           and t.status in ('published', 'closed')
      ) d
    ), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('event_id', e.id, 'folio', e.folio, 'name', e.name, 'starts_at', e.starts_at) order by e.starts_at desc)
        from public.event_registrations er join public.events e on e.id = er.event_id
       where er.user_id = p.id and er.status = 'approved' and e.starts_at < now()
    ), '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Anular o restaurar una falta (penalización) del PIREP
-- -----------------------------------------------------------------------------
create or replace function public.waive_pirep_finding(p_pirep_id uuid, p_code text, p_reason text default null, p_waive boolean default true)
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
  v_org_admin boolean := private.is_org_admin();
begin
  if v_uid is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  select * into v_pirep from public.pireps where id = p_pirep_id for update;
  if not found or not private.can_staff_airline(v_pirep.airline_id) then
    raise exception 'PIREP no encontrado o sin permiso para revisarlo' using errcode = '42501', hint = 'not_allowed';
  end if;
  if v_pirep.user_id = v_uid and not v_org_admin then
    raise exception 'No puedes revisar tu propio PIREP' using errcode = '42501', hint = 'own_pirep';
  end if;
  -- En revisión: el staff de la aerolínea. Ya calificado o archivado: el
  -- superadministrador (cualquier aerolínea) o el administrador de la aerolínea del vuelo.
  if v_pirep.status <> 'pending' and not (v_org_admin or (private.can_manage_airline(v_pirep.airline_id) and v_pirep.status <> 'archived')) then
    raise exception 'Solo el administrador de la aerolínea o el superadministrador cambian faltas de un PIREP ya calificado'
      using errcode = '55000', hint = 'already_reviewed';
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
