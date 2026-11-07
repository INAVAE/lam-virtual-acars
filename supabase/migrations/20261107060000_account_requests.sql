-- =============================================================================
-- LAM Virtual ACARS — Cuentas de piloto con aprobación previa
--
-- Antes cualquiera creaba su cuenta y, tras confirmar el correo, veía la
-- plataforma aunque no perteneciera a ninguna aerolínea. Ahora:
--
-- 1. Quien quiere entrar llena «Solicitar cuenta de piloto» (sin contraseña):
--    request_pilot_account guarda la solicitud. No se crea ningún usuario ni se
--    manda correo.
-- 2. Un superadministrador la aprueba (Edge Function account-requests): la base
--    la marca aprobada y la función manda la invitación de Supabase Auth. El
--    correo llega solo entonces; el piloto elige su contraseña y entra.
-- 3. Ya dentro, solicita unirse a una aerolínea como siempre.
--
-- Candado: private.guard_auth_signup impide que Supabase Auth cree usuarios sin
-- una solicitud aprobada para ese correo (cubre el registro directo por la API).
-- Solo actúa con la conexión de Supabase Auth (session_user); inserciones directas como postgres
-- (pruebas, mantenimiento) no se tocan.
-- =============================================================================

create table public.account_requests (
  id            uuid primary key default gen_random_uuid(),
  email         text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  display_name  text not null check (char_length(btrim(display_name)) between 2 and 80),
  airline_id    uuid references public.airlines (id) on delete set null,
  ivao_vid      text check (ivao_vid ~ '^[0-9]{4,8}$'),
  message       text check (char_length(message) <= 1000),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note   text check (char_length(review_note) <= 500),
  reviewed_by   uuid references public.profiles (id) on delete set null,
  reviewed_at   timestamptz,
  invited_at    timestamptz,
  last_error    text,
  user_id       uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);
comment on table public.account_requests is
  'Solicitudes de cuenta de piloto. Supabase Auth solo crea usuarios para correos con una solicitud aprobada.';
comment on column public.account_requests.airline_id is 'Aerolínea a la que dice querer unirse (informativo; el ingreso se pide ya con cuenta).';
comment on column public.account_requests.user_id is 'Usuario creado al aceptar la invitación.';

create unique index account_requests_one_open_per_email on public.account_requests (email) where status in ('pending', 'approved');
create index account_requests_status_idx on public.account_requests (status, created_at desc);
create index account_requests_airline_idx on public.account_requests (airline_id);
create index account_requests_reviewed_by_idx on public.account_requests (reviewed_by);
create index account_requests_user_idx on public.account_requests (user_id);

alter table public.account_requests enable row level security;
create policy account_requests_admin_select on public.account_requests
  for select to authenticated using (private.is_org_admin());
revoke all on public.account_requests from anon, authenticated;
grant select on public.account_requests to authenticated;

-- -----------------------------------------------------------------------------
-- Solicitar (sin sesión)
-- -----------------------------------------------------------------------------
create function public.request_pilot_account(
  p_email text,
  p_display_name text,
  p_airline_id uuid default null,
  p_message text default null,
  p_ivao_vid text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_display_name, ''));
  v_vid text := nullif(regexp_replace(coalesce(p_ivao_vid, ''), '\s', '', 'g'), '');
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254 then
    raise exception 'Escribe un correo válido' using errcode = '22023', hint = 'invalid_email';
  end if;
  if char_length(v_name) not between 2 and 80 then
    raise exception 'Escribe tu nombre (de 2 a 80 caracteres)' using errcode = '22023', hint = 'invalid_name';
  end if;
  if v_vid is not null and v_vid !~ '^[0-9]{4,8}$' then
    raise exception 'El VID de IVAO son solo números (de 4 a 8)' using errcode = '22023', hint = 'invalid_vid';
  end if;
  if p_airline_id is not null and not exists (select 1 from public.airlines a where a.id = p_airline_id and a.is_active) then
    raise exception 'Esa aerolínea no está disponible' using errcode = '22023', hint = 'invalid_airline';
  end if;
  -- Freno contra envíos masivos: 30 solicitudes por hora en total.
  if (select count(*) from public.account_requests where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Recibimos muchas solicitudes en la última hora; intenta más tarde' using errcode = 'P0001', hint = 'rate_limited';
  end if;
  -- Correo con cuenta o con solicitud abierta: se responde igual, sin revelar si existe.
  if exists (select 1 from public.profiles p where lower(p.email) = v_email)
     or exists (select 1 from public.account_requests r where r.email = v_email and r.status in ('pending', 'approved')) then
    return;
  end if;
  -- Rechazada hace menos de 24 h: tampoco se repite.
  if exists (select 1 from public.account_requests r where r.email = v_email and r.status = 'rejected' and r.reviewed_at > now() - interval '24 hours') then
    return;
  end if;
  insert into public.account_requests (email, display_name, airline_id, ivao_vid, message)
  values (v_email, v_name, p_airline_id, v_vid, nullif(left(btrim(coalesce(p_message, '')), 1000), ''));
end;
$$;
revoke all on function public.request_pilot_account(text, text, uuid, text, text) from public;
grant execute on function public.request_pilot_account(text, text, uuid, text, text) to anon, authenticated;
comment on function public.request_pilot_account(text, text, uuid, text, text) is
  'Solicitud de cuenta de piloto (sin sesión). No crea usuario ni manda correo; responde igual si el correo ya existe.';

-- -----------------------------------------------------------------------------
-- Revisar (superadministrador)
-- -----------------------------------------------------------------------------
create function public.approve_account_request(p_request_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.account_requests;
begin
  if not private.is_org_admin() then
    raise exception 'Solo el superadministrador aprueba cuentas' using errcode = '42501';
  end if;
  select * into r from public.account_requests where id = p_request_id for update;
  if not found then
    raise exception 'La solicitud no existe' using errcode = 'P0002';
  end if;
  if r.status = 'rejected' then
    raise exception 'La solicitud ya fue rechazada' using errcode = 'P0001', hint = 'already_reviewed';
  end if;
  -- Una invitación sin aceptar se puede reenviar; una cuenta ya activa, no.
  if exists (select 1 from auth.users u where lower(u.email) = r.email and (u.email_confirmed_at is not null or u.last_sign_in_at is not null)) then
    raise exception 'Ese correo ya tiene cuenta' using errcode = 'P0001', hint = 'already_registered';
  end if;
  update public.account_requests
     set status = 'approved', reviewed_by = (select auth.uid()), reviewed_at = coalesce(reviewed_at, now()), last_error = null
   where id = r.id;
  return jsonb_build_object('id', r.id, 'email', r.email, 'display_name', r.display_name);
end;
$$;
revoke all on function public.approve_account_request(uuid) from public, anon;
grant execute on function public.approve_account_request(uuid) to authenticated;

create function public.reject_account_request(p_request_id uuid, p_note text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.is_org_admin() then
    raise exception 'Solo el superadministrador revisa cuentas' using errcode = '42501';
  end if;
  update public.account_requests
     set status = 'rejected', review_note = nullif(left(btrim(coalesce(p_note, '')), 500), ''),
         reviewed_by = (select auth.uid()), reviewed_at = now()
   where id = p_request_id and status = 'pending' and user_id is null;
  if not found then
    raise exception 'Solo se rechazan solicitudes pendientes' using errcode = 'P0001', hint = 'not_pending';
  end if;
end;
$$;
revoke all on function public.reject_account_request(uuid, text) from public, anon;
grant execute on function public.reject_account_request(uuid, text) to authenticated;

-- Invitar directamente (sin que la persona llene el formulario).
create function public.create_account_invitation(p_email text, p_display_name text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid;
begin
  if not private.is_org_admin() then
    raise exception 'Solo el superadministrador invita pilotos' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Escribe un correo válido' using errcode = '22023', hint = 'invalid_email';
  end if;
  if exists (select 1 from auth.users u where lower(u.email) = v_email and (u.email_confirmed_at is not null or u.last_sign_in_at is not null)) then
    raise exception 'Ese correo ya tiene cuenta' using errcode = 'P0001', hint = 'already_registered';
  end if;
  select id into v_id from public.account_requests where email = v_email and status in ('pending', 'approved');
  if v_id is null then
    insert into public.account_requests (email, display_name, status, reviewed_by, reviewed_at)
    values (v_email, btrim(coalesce(p_display_name, '')), 'approved', (select auth.uid()), now())
    returning id into v_id;
  else
    update public.account_requests
       set status = 'approved', reviewed_by = (select auth.uid()), reviewed_at = coalesce(reviewed_at, now())
     where id = v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.create_account_invitation(text, text) from public, anon;
grant execute on function public.create_account_invitation(text, text) to authenticated;

-- La función account-requests anota el resultado de la invitación (clave secreta).
create function public.record_account_invitation(p_request_id uuid, p_error text default null)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.account_requests
     set invited_at = case when p_error is null then now() else invited_at end,
         last_error = left(p_error, 300)
   where id = p_request_id;
$$;
revoke all on function public.record_account_invitation(uuid, text) from public, anon, authenticated;
grant execute on function public.record_account_invitation(uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- Candado en Supabase Auth
-- -----------------------------------------------------------------------------
create function private.guard_auth_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- lam.enforce_signup_guard solo existe para probar el candado desde pgTAP.
  if (session_user = 'supabase_auth_admin' or current_setting('lam.enforce_signup_guard', true) = 'on')
     and not exists (select 1 from public.account_requests r
                      where r.email = lower(btrim(coalesce(new.email, ''))) and r.status = 'approved') then
    raise exception 'Las cuentas de LAM se crean por invitación: solicita tu cuenta de piloto'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_auth_signup() from public;

create trigger before_auth_user_created before insert on auth.users
  for each row execute function private.guard_auth_signup();

-- Al crearse el usuario, la solicitud queda ligada a su perfil.
create function private.link_account_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.account_requests
     set user_id = new.id
   where email = lower(btrim(coalesce(new.email, ''))) and status = 'approved' and user_id is null;
  return new;
end;
$$;
revoke all on function private.link_account_request() from public;

create trigger on_profile_created_link_request after insert on public.profiles
  for each row execute function private.link_account_request();
