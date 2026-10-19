-- =============================================================================
-- LAM Virtual ACARS — Fase 1: permisos y políticas RLS
-- Matriz completa en docs/database/permissions.md
-- =============================================================================

alter table public.organizations        enable row level security;
alter table public.airlines             enable row level security;
alter table public.profiles             enable row level security;
alter table public.organization_members enable row level security;
alter table public.airline_memberships  enable row level security;
alter table public.airline_settings     enable row level security;
alter table public.audit_logs           enable row level security;

-- Permisos explícitos: se parte de cero y se concede solo lo necesario.
revoke all on public.organizations, public.airlines, public.profiles,
  public.organization_members, public.airline_memberships,
  public.airline_settings, public.audit_logs
  from anon, authenticated;

grant select on public.organizations to anon, authenticated;
grant update (name) on public.organizations to authenticated;

grant select on public.airlines to anon, authenticated;
grant insert, delete on public.airlines to authenticated;
grant update (
  name, icao_code, iata_code, radio_callsign, description,
  brand_primary_color, brand_secondary_color, logo_path,
  is_unofficial_brand, is_active
) on public.airlines to authenticated;

grant select on public.airline_settings to authenticated;
grant update (
  max_active_bookings, booking_expiry_hours, require_aircraft_at_origin,
  auto_approve_pireps, public_tracking, delay_tolerance_minutes
) on public.airline_settings to authenticated;

grant select, delete on public.airline_memberships to authenticated;
grant insert (airline_id, user_id, roles, status) on public.airline_memberships to authenticated;
grant update (roles, status) on public.airline_memberships to authenticated;

grant select on public.profiles to authenticated;
grant update (display_name, country_code, simbrief_username, primary_airline_id, account_status)
  on public.profiles to authenticated;

grant select, insert, delete on public.organization_members to authenticated;

grant select on public.audit_logs to authenticated;

-- -----------------------------------------------------------------------------
-- organizations
-- -----------------------------------------------------------------------------
create policy organizations_select_all on public.organizations
  for select to anon, authenticated
  using (true);

create policy organizations_update_admin on public.organizations
  for update to authenticated
  using ((select private.is_org_admin()))
  with check ((select private.is_org_admin()));

-- -----------------------------------------------------------------------------
-- airlines
-- -----------------------------------------------------------------------------
create policy airlines_select_public on public.airlines
  for select to anon
  using (is_active);

create policy airlines_select_member on public.airlines
  for select to authenticated
  using (is_active or (select private.is_org_admin()) or private.is_airline_member(id));

create policy airlines_insert_admin on public.airlines
  for insert to authenticated
  with check ((select private.is_org_admin()));

create policy airlines_update_manager on public.airlines
  for update to authenticated
  using (private.can_manage_airline(id))
  with check (private.can_manage_airline(id));

create policy airlines_delete_admin on public.airlines
  for delete to authenticated
  using ((select private.is_org_admin()));

-- -----------------------------------------------------------------------------
-- airline_settings
-- -----------------------------------------------------------------------------
create policy airline_settings_select_member on public.airline_settings
  for select to authenticated
  using ((select private.is_org_admin()) or private.is_airline_member(airline_id));

create policy airline_settings_update_manager on public.airline_settings
  for update to authenticated
  using (private.can_manage_airline(airline_id))
  with check (private.can_manage_airline(airline_id));

-- -----------------------------------------------------------------------------
-- airline_memberships
-- -----------------------------------------------------------------------------
create policy airline_memberships_select on public.airline_memberships
  for select to authenticated
  using (user_id = (select auth.uid()) or private.can_staff_airline(airline_id));

-- Solicitud de ingreso: solo para sí mismo, como piloto, pendiente y a una
-- aerolínea activa.
create policy airline_memberships_insert_request on public.airline_memberships
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and roles = '{pilot}'::public.airline_role[]
    and exists (select 1 from public.airlines a where a.id = airline_id and a.is_active)
  );

-- Alta directa por administradores, nunca sobre sí mismos (salvo superadmin).
create policy airline_memberships_insert_manager on public.airline_memberships
  for insert to authenticated
  with check (
    private.can_manage_airline(airline_id)
    and (user_id <> (select auth.uid()) or (select private.is_org_admin()))
  );

create policy airline_memberships_update_manager on public.airline_memberships
  for update to authenticated
  using (
    private.can_manage_airline(airline_id)
    and (user_id <> (select auth.uid()) or (select private.is_org_admin()))
  )
  with check (
    private.can_manage_airline(airline_id)
    and (user_id <> (select auth.uid()) or (select private.is_org_admin()))
  );

-- Baja: un administrador sobre otros, o la propia persona si solo es piloto
-- (cancelar solicitud o dejar la aerolínea).
create policy airline_memberships_delete on public.airline_memberships
  for delete to authenticated
  using (
    (private.can_manage_airline(airline_id)
      and (user_id <> (select auth.uid()) or (select private.is_org_admin())))
    or (user_id = (select auth.uid()) and roles = '{pilot}'::public.airline_role[])
  );

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.is_staff_for_user(id));

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or (select private.is_org_admin()))
  with check (id = (select auth.uid()) or (select private.is_org_admin()));

-- -----------------------------------------------------------------------------
-- organization_members
-- -----------------------------------------------------------------------------
create policy organization_members_select on public.organization_members
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_org_admin()));

create policy organization_members_insert_admin on public.organization_members
  for insert to authenticated
  with check ((select private.is_org_admin()) and user_id <> (select auth.uid()));

-- Nadie se quita a sí mismo: siempre queda al menos un superadministrador.
create policy organization_members_delete_admin on public.organization_members
  for delete to authenticated
  using ((select private.is_org_admin()) and user_id <> (select auth.uid()));

-- -----------------------------------------------------------------------------
-- audit_logs (solo lectura; lo escriben disparadores)
-- -----------------------------------------------------------------------------
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (
    (select private.is_org_admin())
    or (airline_id is not null and private.can_manage_airline(airline_id))
  );
