-- =============================================================================
-- LAM Virtual ACARS — Fase 4 (3/3): permisos, RLS y tareas programadas
-- Nadie escribe telemetría desde el navegador: el piloto solo lee la suya y el
-- staff la de su aerolínea. La ingesta es exclusiva de service_role (Edge
-- Function `acars`).
-- =============================================================================

revoke all on public.acars_devices, public.acars_link_codes, public.flight_sessions,
  public.flight_positions_live, public.flight_track_points, public.flight_events
  from anon, authenticated;

grant select (id, user_id, name, token_prefix, app_version, created_at, last_used_at, revoked_at, revoked_by)
  on public.acars_devices to authenticated;
grant select on public.flight_sessions, public.flight_positions_live, public.flight_track_points, public.flight_events
  to authenticated;

create policy acars_devices_select on public.acars_devices for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_org_admin()));

create policy flight_sessions_select on public.flight_sessions for select to authenticated
  using (user_id = (select auth.uid()) or private.can_staff_airline(airline_id));
create policy flight_positions_live_select on public.flight_positions_live for select to authenticated
  using (user_id = (select auth.uid()) or private.can_staff_airline(airline_id));
create policy flight_track_points_select on public.flight_track_points for select to authenticated
  using (user_id = (select auth.uid()) or private.can_staff_airline(airline_id));
create policy flight_events_select on public.flight_events for select to authenticated
  using (user_id = (select auth.uid()) or private.can_staff_airline(airline_id));

-- -----------------------------------------------------------------------------
-- Funciones
-- -----------------------------------------------------------------------------
revoke all on function private.is_flight_phase(text) from public;
grant execute on function private.is_flight_phase(text) to authenticated, service_role;
revoke all on function private.ensure_track_partition(date) from public;
revoke all on function private.acars_error(text, text, text) from public;
revoke all on function private.new_link_code() from public;
revoke all on function private.nearest_airport(double precision, double precision, double precision) from public;
revoke all on function private.acars_device(text, integer) from public;
revoke all on function private.acars_active_session(public.acars_devices, uuid) from public;
revoke all on function private.acars_flight_json(uuid) from public;

-- Ingesta: solo la Edge Function (service_role).
revoke all on function public.acars_link_start(text, text, text, text) from public, anon, authenticated;
revoke all on function public.acars_link_poll(text, text, text, text) from public, anon, authenticated;
revoke all on function public.acars_me(text) from public, anon, authenticated;
revoke all on function public.acars_session_start(text, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.acars_position(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.acars_track_batch(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.acars_events(text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.acars_session_end(text, uuid, text, double precision, double precision) from public, anon, authenticated;
grant execute on function public.acars_link_start(text, text, text, text) to service_role;
grant execute on function public.acars_link_poll(text, text, text, text) to service_role;
grant execute on function public.acars_me(text) to service_role;
grant execute on function public.acars_session_start(text, uuid, text, text, text, text) to service_role;
grant execute on function public.acars_position(text, uuid, jsonb) to service_role;
grant execute on function public.acars_track_batch(text, uuid, jsonb) to service_role;
grant execute on function public.acars_events(text, uuid, jsonb) to service_role;
grant execute on function public.acars_session_end(text, uuid, text, double precision, double precision) to service_role;

-- Web: el piloto confirma códigos y revoca dispositivos.
revoke all on function public.approve_acars_link(text) from public, anon;
grant execute on function public.approve_acars_link(text) to authenticated;
revoke all on function public.revoke_acars_device(uuid) from public, anon;
grant execute on function public.revoke_acars_device(uuid) to authenticated;

comment on function public.approve_acars_link(text) is 'Vincula el equipo que muestra el código con la cuenta de quien llama.';
comment on function public.revoke_acars_device(uuid) is 'Revoca un dispositivo ACARS propio (o cualquiera, si es superadministrador). La ingesta se detiene en el siguiente envío.';

-- -----------------------------------------------------------------------------
-- Particiones de la traza: crear con anticipación cada mes.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'lam-track-partitions',
      '0 3 1 * *',
      $job$select private.ensure_track_partition((now() + interval '1 month')::date); select private.ensure_track_partition((now() + interval '2 months')::date);$job$
    );
  end if;
end;
$$;
