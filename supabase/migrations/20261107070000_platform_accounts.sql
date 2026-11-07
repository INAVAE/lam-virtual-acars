-- =============================================================================
-- LAM Virtual ACARS — Cuentas de la plataforma: ver todas y revocar el acceso
--
-- El superadministrador necesita ver todas las cuentas (también las que ya
-- entraron pero no han pedido ingreso a ninguna aerolínea, que no aparecen en
-- Pilots) y poder revocar el acceso de cualquiera.
--
-- - list_platform_accounts: todas las cuentas con su último acceso, sus
--   aerolíneas (y el estado de cada solicitud) y su número de PIREP.
-- - set_account_access: suspende o reactiva la cuenta (profiles.account_status,
--   que ya bloquea todas las funciones de aerolínea y el conector). Al revocar
--   se cancelan las reservas cuyo vuelo no ha comenzado. La Edge Function
--   account-requests además bloquea el inicio de sesión en Supabase Auth.
-- =============================================================================

alter table public.profiles
  add column suspended_at timestamptz,
  add column suspended_by uuid references public.profiles (id) on delete set null,
  add column suspension_note text check (char_length(suspension_note) <= 500);
comment on column public.profiles.suspended_at is 'Cuándo se revocó el acceso (NULL si la cuenta está activa).';
comment on column public.profiles.suspension_note is 'Motivo interno de la revocación; solo lo ve el superadministrador.';
create index profiles_suspended_by_idx on public.profiles (suspended_by);

-- Los cambios de acceso quedan en la bitácora de Administration.
create trigger profiles_access_audit after update of account_status on public.profiles
  for each row when (old.account_status is distinct from new.account_status)
  execute function private.audit_row('-', 'id');

-- -----------------------------------------------------------------------------
-- Lista de cuentas (superadministrador)
-- -----------------------------------------------------------------------------
create function public.list_platform_accounts()
returns table (
  user_id          uuid,
  pilot_number     integer,
  display_name     text,
  email            text,
  account_status   public.account_status,
  created_at       timestamptz,
  last_sign_in_at  timestamptz,
  is_superadmin    boolean,
  suspended_at     timestamptz,
  suspension_note  text,
  suspended_by_name text,
  memberships      jsonb,
  pirep_count      integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_org_admin() then
    raise exception 'Solo el superadministrador ve las cuentas' using errcode = '42501';
  end if;
  return query
  select p.id, p.pilot_number, p.display_name, p.email, p.account_status, p.created_at, u.last_sign_in_at,
         exists (select 1 from public.organization_members m where m.user_id = p.id and m.role = 'superadmin'),
         p.suspended_at, p.suspension_note, sb.display_name,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'airline_id', a.id, 'name', a.name, 'icao_code', a.icao_code,
                    'status', am.status, 'roles', am.roles) order by a.name)
             from public.airline_memberships am
             join public.airlines a on a.id = am.airline_id
            where am.user_id = p.id
         ), '[]'::jsonb),
         (select count(*)::integer from public.pireps r where r.user_id = p.id)
    from public.profiles p
    left join auth.users u on u.id = p.id
    left join public.profiles sb on sb.id = p.suspended_by
   order by p.created_at desc;
end;
$$;
revoke all on function public.list_platform_accounts() from public, anon;
grant execute on function public.list_platform_accounts() to authenticated;
comment on function public.list_platform_accounts() is
  'Todas las cuentas con su último acceso, aerolíneas (con el estado de cada solicitud) y PIREP. Solo superadministrador.';

-- -----------------------------------------------------------------------------
-- Revocar o restaurar el acceso (superadministrador)
-- -----------------------------------------------------------------------------
create function public.set_account_access(p_user_id uuid, p_active boolean, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.profiles;
  v_booking uuid;
  v_cancelled integer := 0;
begin
  if not private.is_org_admin() then
    raise exception 'Solo el superadministrador revoca accesos' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'La cuenta no existe' using errcode = 'P0002';
  end if;
  if p_user_id = v_uid then
    raise exception 'No puedes revocar tu propio acceso' using errcode = 'P0001', hint = 'self';
  end if;
  if not p_active and exists (select 1 from public.organization_members m where m.user_id = p_user_id and m.role = 'superadmin') then
    raise exception 'Quita primero su rol de superadministrador' using errcode = 'P0001', hint = 'superadmin';
  end if;

  if p_active then
    update public.profiles
       set account_status = 'active', suspended_at = null, suspended_by = null, suspension_note = null
     where id = p_user_id;
  else
    update public.profiles
       set account_status = 'suspended',
           suspended_at = coalesce(suspended_at, now()),
           suspended_by = v_uid,
           suspension_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
     where id = p_user_id;
    -- Reservas sin iniciar: se cancelan y liberan la aeronave.
    for v_booking in
      select b.id from public.flight_bookings b
        left join public.flights f on f.booking_id = b.id
       where b.user_id = p_user_id and b.status = 'active' and f.status is not distinct from 'scheduled'
       for update of b
    loop
      perform private.close_booking(v_booking, 'cancelled', v_uid);
      v_cancelled := v_cancelled + 1;
    end loop;
  end if;

  return jsonb_build_object('user_id', p_user_id, 'email', v_profile.email, 'active', p_active, 'bookings_cancelled', v_cancelled);
end;
$$;
revoke all on function public.set_account_access(uuid, boolean, text) from public, anon;
grant execute on function public.set_account_access(uuid, boolean, text) to authenticated;
comment on function public.set_account_access(uuid, boolean, text) is
  'Revoca (suspende y cancela reservas sin iniciar) o restaura el acceso de una cuenta. Solo superadministrador.';
