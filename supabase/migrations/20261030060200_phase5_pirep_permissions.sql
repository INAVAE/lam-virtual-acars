-- =============================================================================
-- LAM Virtual ACARS — Fase 5 (3/3): permisos, RLS, tareas y PIREP de vuelos previos
-- =============================================================================

alter table public.pirep_rule_definitions enable row level security;
alter table public.pirep_scoring_rules enable row level security;
alter table public.pireps enable row level security;

revoke all on public.pirep_rule_definitions, public.pirep_scoring_rules, public.pireps, public.pilot_statistics
  from anon, authenticated;

grant select on public.pirep_rule_definitions to authenticated;
grant select on public.pirep_scoring_rules to authenticated;
grant update (enabled, penalty, threshold, critical) on public.pirep_scoring_rules to authenticated;
grant select on public.pireps to authenticated;
grant select on public.pilot_statistics to authenticated;
grant update (pirep_min_score) on public.airline_settings to authenticated;

create policy pirep_rule_definitions_select on public.pirep_rule_definitions for select to authenticated
  using (true);

create policy pirep_scoring_rules_select on public.pirep_scoring_rules for select to authenticated
  using ((select private.is_org_admin()) or private.is_airline_member(airline_id));
create policy pirep_scoring_rules_update on public.pirep_scoring_rules for update to authenticated
  using (private.can_manage_airline(airline_id))
  with check (private.can_manage_airline(airline_id));

-- El piloto ve los suyos; el staff, los de su aerolínea.
create policy pireps_select on public.pireps for select to authenticated
  using (user_id = (select auth.uid()) or private.can_staff_airline(airline_id));

-- -----------------------------------------------------------------------------
-- Funciones
-- -----------------------------------------------------------------------------
revoke all on function private.apply_pirep_acceptance(public.pireps) from public;
revoke all on function private.build_pirep(uuid) from public;
revoke all on function private.build_missing_pireps() from public;

revoke all on function public.review_pirep(uuid, public.pirep_status, text) from public, anon;
revoke all on function public.comment_pirep(uuid, text) from public, anon;
grant execute on function public.review_pirep(uuid, public.pirep_status, text) to authenticated;
grant execute on function public.comment_pirep(uuid, text) to authenticated;

-- Se recreó acars_session_end: mismos permisos que en la Fase 4 (solo la Edge Function).
revoke all on function public.acars_session_end(text, uuid, text, double precision, double precision) from public, anon, authenticated;
grant execute on function public.acars_session_end(text, uuid, text, double precision, double precision) to service_role;

-- -----------------------------------------------------------------------------
-- Dashboard: PIREP pendientes (staff) y horas del piloto
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
    )
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Tarea de respaldo y PIREP de los vuelos completados antes de esta fase
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('lam-build-missing-pireps', '*/10 * * * *', 'select private.build_missing_pireps()');
  end if;
end;
$$;

select private.build_missing_pireps();
