-- =============================================================================
-- LAM Virtual ACARS — Perfil completo del piloto y datos de la cuenta
--
-- - profiles: foto (avatar_url, en el bucket público avatars), VID de IVAO,
--   usuario de Discord y una presentación breve. Los cambia la propia persona.
-- - get_pilot_profile(número LAM): todo lo que muestra el perfil (aerolíneas y
--   roles, totales, horas, tipos, rutas, actividad por mes, PIREP recientes,
--   habilitaciones e insignias). Lo ve la persona, el staff de sus aerolíneas, el
--   superadministrador y los pilotos que comparten aerolínea con ella. El correo
--   y los PIREP no aceptados solo los ven la persona, su staff y el
--   superadministrador.
-- =============================================================================

alter table public.profiles
  add column avatar_url text check (avatar_url ~ '^https://[a-z0-9.-]+/storage/v1/object/public/avatars/[0-9a-f-]{36}/[A-Za-z0-9._-]+$'),
  add column ivao_vid text check (ivao_vid ~ '^[0-9]{4,8}$'),
  add column discord_username text check (discord_username ~ '^[a-z0-9_.]{2,32}$'),
  add column bio text check (char_length(bio) <= 300);
comment on column public.profiles.avatar_url is 'Foto de perfil (bucket público avatars, carpeta del propio usuario).';
comment on column public.profiles.discord_username is 'Usuario de Discord (minúsculas, sin #), para los entrenamientos y eventos.';

grant update (avatar_url, ivao_vid, discord_username, bio) on public.profiles to authenticated;

-- Fotos de perfil: cada quien escribe solo en su carpeta (su id).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Al aceptar la invitación, el VID de IVAO de la solicitud pasa al perfil.
create or replace function private.link_account_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vid text;
begin
  update public.account_requests
     set user_id = new.id
   where email = lower(btrim(coalesce(new.email, ''))) and status = 'approved' and user_id is null
  returning ivao_vid into v_vid;
  if v_vid is not null and new.ivao_vid is null then
    update public.profiles set ivao_vid = v_vid where id = new.id;
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Perfil del piloto
-- -----------------------------------------------------------------------------
create function public.get_pilot_profile(p_pilot_number integer)
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
  v_peer := exists (
    select 1 from public.airline_memberships mine
      join public.airline_memberships theirs on theirs.airline_id = mine.airline_id
      join public.profiles me on me.id = mine.user_id
     where mine.user_id = v_uid and mine.status = 'active' and me.account_status = 'active'
       and theirs.user_id = p.id and theirs.status = 'active'
  );
  if not (v_self or v_staff or v_peer) then
    raise exception 'Solo ves el perfil de pilotos de tus aerolíneas' using errcode = '42501';
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
       where m.user_id = p.id and (v_self or v_staff or m.status = 'active')
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
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('event_id', e.id, 'folio', e.folio, 'name', e.name, 'starts_at', e.starts_at) order by e.starts_at desc)
        from public.event_registrations er join public.events e on e.id = er.event_id
       where er.user_id = p.id and er.status = 'approved' and e.starts_at < now()
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_pilot_profile(integer) from public, anon;
grant execute on function public.get_pilot_profile(integer) to authenticated;
comment on function public.get_pilot_profile(integer) is
  'Perfil completo de un piloto por su número LAM. Lo ven la persona, su staff, el superadministrador y quienes comparten aerolínea con ella.';
