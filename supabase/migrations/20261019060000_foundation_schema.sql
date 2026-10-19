-- =============================================================================
-- LAM Virtual ACARS — Fase 1: esquema de fundación
-- Organización, aerolíneas, perfiles, membresías, configuración y auditoría.
-- Las políticas RLS y los permisos están en la migración siguiente.
-- =============================================================================

-- Esquema privado para funciones de apoyo. No se expone en la Data API.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
create type public.org_role as enum ('superadmin');
create type public.airline_role as enum ('airline_admin', 'ops_chief', 'pilot');
create type public.membership_status as enum ('pending', 'active', 'suspended', 'rejected');
create type public.account_status as enum ('active', 'suspended');

-- -----------------------------------------------------------------------------
-- Tablas
-- -----------------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name        text not null check (char_length(name) between 2 and 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.organizations is 'Organización raíz (LAM). Agrupa aerolíneas virtuales.';

create table public.airlines (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations (id) on delete restrict,
  slug                   text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name                   text not null check (char_length(name) between 2 and 80),
  icao_code              text unique check (icao_code ~ '^[A-Z]{3}$'),
  iata_code              text unique check (iata_code ~ '^[A-Z0-9]{2}$'),
  radio_callsign         text check (char_length(radio_callsign) between 2 and 40),
  description            text check (char_length(description) <= 1000),
  brand_primary_color    text not null default '#2563EB' check (brand_primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  brand_secondary_color  text check (brand_secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  logo_path              text check (char_length(logo_path) <= 300),
  is_unofficial_brand    boolean not null default false,
  is_active              boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint airlines_active_requires_icao check (not is_active or icao_code is not null)
);
comment on table public.airlines is 'Aerolíneas virtuales dentro de la organización.';
comment on column public.airlines.is_unofficial_brand is 'Inspirada en una marca real: la interfaz muestra el aviso de operación virtual no oficial.';
comment on column public.airlines.is_active is 'Solo las aerolíneas activas son visibles para visitantes y aceptan solicitudes de ingreso.';
create index airlines_organization_id_idx on public.airlines (organization_id);

create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  pilot_number        integer not null unique generated always as identity (start with 1001),
  email               text not null,
  display_name        text not null check (char_length(display_name) between 2 and 80),
  country_code        text check (country_code ~ '^[A-Z]{2}$'),
  simbrief_username   text check (char_length(simbrief_username) between 1 and 64),
  primary_airline_id  uuid references public.airlines (id) on delete set null,
  account_status      public.account_status not null default 'active',
  joined_at           timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table public.profiles is 'Perfil único de cada persona en LAM. Se crea al registrarse.';
comment on column public.profiles.pilot_number is 'Número de piloto LAM. Se muestra como LAM + 4 dígitos.';
create index profiles_primary_airline_id_idx on public.profiles (primary_airline_id);

create table public.organization_members (
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  role             public.org_role not null,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.profiles (id) on delete set null,
  primary key (organization_id, user_id)
);
comment on table public.organization_members is 'Roles a nivel organización (superadministradores LAM).';
create index organization_members_user_id_idx on public.organization_members (user_id);
create index organization_members_created_by_idx on public.organization_members (created_by);

create table public.airline_memberships (
  id            uuid primary key default gen_random_uuid(),
  airline_id    uuid not null references public.airlines (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  roles         public.airline_role[] not null default '{pilot}',
  status        public.membership_status not null default 'pending',
  requested_at  timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint airline_memberships_unique unique (airline_id, user_id),
  constraint airline_memberships_roles_valid check (
    cardinality(roles) between 1 and 3 and array_position(roles, null) is null
  )
);
comment on table public.airline_memberships is 'Pertenencia de una persona a una aerolínea, con sus roles en ella.';
create index airline_memberships_user_id_status_idx on public.airline_memberships (user_id, status);
create index airline_memberships_decided_by_idx on public.airline_memberships (decided_by);

create table public.airline_settings (
  airline_id                  uuid primary key references public.airlines (id) on delete cascade,
  max_active_bookings         smallint not null default 1 check (max_active_bookings between 1 and 10),
  booking_expiry_hours        smallint not null default 24 check (booking_expiry_hours between 1 and 168),
  require_aircraft_at_origin  boolean not null default false,
  auto_approve_pireps         boolean not null default false,
  public_tracking             boolean not null default true,
  delay_tolerance_minutes     smallint not null default 30 check (delay_tolerance_minutes between 0 and 600),
  updated_at                  timestamptz not null default now(),
  updated_by                  uuid references public.profiles (id) on delete set null
);
comment on table public.airline_settings is 'Políticas operacionales por aerolínea. Se crea automáticamente con la aerolínea.';
create index airline_settings_updated_by_idx on public.airline_settings (updated_by);

-- Auditoría inmutable: sin claves foráneas para conservar el historial
-- aunque se borre la persona o la aerolínea.
create table public.audit_logs (
  id           bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  actor_id     uuid,
  airline_id   uuid,
  action       text not null check (action in ('insert', 'update', 'delete')),
  entity_type  text not null,
  entity_id    text not null,
  old_data     jsonb,
  new_data     jsonb
);
comment on table public.audit_logs is 'Registro de cambios administrativos. Solo lo escriben disparadores.';
create index audit_logs_airline_id_occurred_at_idx on public.audit_logs (airline_id, occurred_at desc);
create index audit_logs_occurred_at_idx on public.audit_logs (occurred_at desc);
create index audit_logs_actor_id_idx on public.audit_logs (actor_id);

-- -----------------------------------------------------------------------------
-- Funciones de autorización (usadas por RLS)
-- SECURITY DEFINER para leer membresías sin recursión de RLS; siempre
-- evalúan la identidad de quien llama con auth.uid().
-- -----------------------------------------------------------------------------
create function private.is_org_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    join public.profiles p on p.id = m.user_id
    where m.user_id = (select auth.uid())
      and m.role = 'superadmin'
      and p.account_status = 'active'
  );
$$;

create function private.has_airline_role(p_airline_id uuid, p_roles public.airline_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.airline_memberships m
    join public.profiles p on p.id = m.user_id
    where m.airline_id = p_airline_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.roles && p_roles
      and p.account_status = 'active'
  );
$$;

create function private.is_airline_member(p_airline_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_airline_role(p_airline_id, '{airline_admin,ops_chief,pilot}');
$$;

create function private.can_manage_airline(p_airline_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_admin() or private.has_airline_role(p_airline_id, '{airline_admin}');
$$;

create function private.can_staff_airline(p_airline_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_admin() or private.has_airline_role(p_airline_id, '{airline_admin,ops_chief}');
$$;

-- ¿Quien llama administra o supervisa alguna aerolínea a la que pertenece p_user_id?
create function private.is_staff_for_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_admin() or exists (
    select 1
    from public.airline_memberships target
    where target.user_id = p_user_id
      and private.has_airline_role(target.airline_id, '{airline_admin,ops_chief}')
  );
$$;

revoke all on function private.is_org_admin() from public;
revoke all on function private.has_airline_role(uuid, public.airline_role[]) from public;
revoke all on function private.is_airline_member(uuid) from public;
revoke all on function private.can_manage_airline(uuid) from public;
revoke all on function private.can_staff_airline(uuid) from public;
revoke all on function private.is_staff_for_user(uuid) from public;
grant execute on function private.is_org_admin() to authenticated, service_role;
grant execute on function private.has_airline_role(uuid, public.airline_role[]) to authenticated, service_role;
grant execute on function private.is_airline_member(uuid) to authenticated, service_role;
grant execute on function private.can_manage_airline(uuid) to authenticated, service_role;
grant execute on function private.can_staff_airline(uuid) to authenticated, service_role;
grant execute on function private.is_staff_for_user(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Disparadores genéricos
-- -----------------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger organizations_set_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();
create trigger airlines_set_updated_at before update on public.airlines
  for each row execute function private.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger airline_memberships_set_updated_at before update on public.airline_memberships
  for each row execute function private.set_updated_at();
create trigger airline_settings_set_updated_at before update on public.airline_settings
  for each row execute function private.set_updated_at();

create function private.set_updated_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

create trigger airline_settings_set_updated_by before update on public.airline_settings
  for each row execute function private.set_updated_by();

-- Auditoría. tg_argv[0] = columna con el id de aerolínea ('-' si no aplica),
-- tg_argv[1] = columna que identifica la entidad.
create function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_airline uuid;
begin
  if tg_op = 'DELETE' then
    v_row := to_jsonb(old);
  else
    v_row := to_jsonb(new);
  end if;

  if tg_argv[0] <> '-' then
    v_airline := nullif(v_row ->> tg_argv[0], '')::uuid;
  end if;

  insert into public.audit_logs (actor_id, airline_id, action, entity_type, entity_id, old_data, new_data)
  values (
    (select auth.uid()),
    v_airline,
    lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> tg_argv[1], ''),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return null;
end;
$$;
revoke all on function private.audit_row() from public;

create trigger airlines_audit after insert or update or delete on public.airlines
  for each row execute function private.audit_row('id', 'id');
create trigger airline_settings_audit after update on public.airline_settings
  for each row execute function private.audit_row('airline_id', 'airline_id');
create trigger airline_memberships_audit after insert or update or delete on public.airline_memberships
  for each row execute function private.audit_row('airline_id', 'id');
create trigger organization_members_audit after insert or update or delete on public.organization_members
  for each row execute function private.audit_row('-', 'user_id');

-- -----------------------------------------------------------------------------
-- Perfiles: creación al registrarse y sincronización de correo
-- -----------------------------------------------------------------------------
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(new.raw_user_meta_data ->> 'display_name'), '');
begin
  if v_name is null then
    v_name := split_part(coalesce(new.email, ''), '@', 1);
  end if;
  if char_length(coalesce(v_name, '')) < 2 then
    v_name := 'Piloto';
  end if;

  insert into public.profiles (id, email, display_name)
  values (new.id, coalesce(new.email, ''), left(v_name, 80));
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

create function private.sync_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end;
$$;
revoke all on function private.sync_user_email() from public;

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.sync_user_email();

-- -----------------------------------------------------------------------------
-- Reglas de negocio protegidas en la base de datos
-- -----------------------------------------------------------------------------

-- Configuración por defecto al crear una aerolínea.
create function private.create_airline_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.airline_settings (airline_id) values (new.id);
  return null;
end;
$$;
revoke all on function private.create_airline_settings() from public;

create trigger airlines_create_settings after insert on public.airlines
  for each row execute function private.create_airline_settings();

-- Solo el superadministrador cambia identidad estructural de una aerolínea.
create function private.guard_airline_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not private.is_org_admin() then
    if new.organization_id is distinct from old.organization_id
       or new.slug is distinct from old.slug
       or new.icao_code is distinct from old.icao_code
       or new.iata_code is distinct from old.iata_code
       or new.is_active is distinct from old.is_active
       or new.is_unofficial_brand is distinct from old.is_unofficial_brand then
      raise exception 'Solo un superadministrador puede cambiar códigos, estado u organización de la aerolínea'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger airlines_guard_update before update on public.airlines
  for each row execute function private.guard_airline_update();

-- Datos protegidos del perfil y validación de aerolínea principal.
create function private.guard_profile_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'El id del perfil no se puede cambiar' using errcode = '42501';
  end if;

  if (select auth.uid()) is not null and not private.is_org_admin() then
    if new.email is distinct from old.email
       or new.account_status is distinct from old.account_status
       or new.joined_at is distinct from old.joined_at then
      raise exception 'Este dato del perfil solo lo puede cambiar un superadministrador'
        using errcode = '42501';
    end if;
  end if;

  if new.primary_airline_id is not null
     and new.primary_airline_id is distinct from old.primary_airline_id
     and not exists (
       select 1 from public.airline_memberships m
       where m.user_id = new.id
         and m.airline_id = new.primary_airline_id
         and m.status = 'active'
     ) then
    raise exception 'La aerolínea principal debe ser una aerolínea donde la membresía esté activa'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_update before update on public.profiles
  for each row execute function private.guard_profile_update();

-- Reglas de membresías: inmutabilidad de claves, decisión registrada y
-- administración de administradores reservada al superadministrador.
create function private.guard_membership_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_org_admin boolean := v_uid is not null and private.is_org_admin();
begin
  if tg_op = 'UPDATE' then
    if new.airline_id is distinct from old.airline_id or new.user_id is distinct from old.user_id then
      raise exception 'La aerolínea y la persona de una membresía no se pueden cambiar' using errcode = '42501';
    end if;
    if new.status is distinct from old.status then
      new.decided_at := now();
      new.decided_by := v_uid;
    end if;
  end if;

  if v_uid is not null and not v_is_org_admin then
    if 'airline_admin' = any (new.roles)
       and (tg_op = 'INSERT' or not ('airline_admin' = any (old.roles))) then
      raise exception 'Solo un superadministrador puede asignar administradores de aerolínea' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and 'airline_admin' = any (old.roles) then
      raise exception 'Solo un superadministrador puede modificar a un administrador de aerolínea' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger airline_memberships_guard_write before insert or update on public.airline_memberships
  for each row execute function private.guard_membership_write();

-- Si la membresía deja de estar activa, se limpia la aerolínea principal.
create function private.clear_primary_airline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_airline uuid;
begin
  if tg_op = 'DELETE' then
    v_user := old.user_id;
    v_airline := old.airline_id;
  elsif new.status <> 'active' then
    v_user := new.user_id;
    v_airline := new.airline_id;
  else
    return null;
  end if;

  update public.profiles
  set primary_airline_id = null
  where id = v_user and primary_airline_id = v_airline;
  return null;
end;
$$;
revoke all on function private.clear_primary_airline() from public;

create trigger airline_memberships_clear_primary after update or delete on public.airline_memberships
  for each row execute function private.clear_primary_airline();

-- -----------------------------------------------------------------------------
-- Funciones públicas (RPC)
-- -----------------------------------------------------------------------------

-- Resumen del dashboard. Devuelve solo conteos agregados del ámbito que
-- quien llama puede ver; nunca datos personales.
create function public.get_dashboard_summary(p_airline_id uuid default null)
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
    end
  );
end;
$$;
revoke all on function public.get_dashboard_summary(uuid) from public, anon;
grant execute on function public.get_dashboard_summary(uuid) to authenticated;
comment on function public.get_dashboard_summary(uuid) is 'Conteos agregados para el dashboard según el ámbito de quien llama.';

-- Alta del primer superadministrador. Solo se ejecuta desde SQL con un rol
-- privilegiado (SQL Editor o migración), nunca desde la API.
create function private.grant_superadmin(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_org uuid;
begin
  select id into v_user from public.profiles where lower(email) = lower(p_email);
  if v_user is null then
    raise exception 'No existe un perfil con el correo %', p_email;
  end if;
  select id into v_org from public.organizations where slug = 'lam';
  if v_org is null then
    raise exception 'No existe la organización LAM';
  end if;
  insert into public.organization_members (organization_id, user_id, role)
  values (v_org, v_user, 'superadmin')
  on conflict (organization_id, user_id) do update set role = excluded.role;
end;
$$;
revoke all on function private.grant_superadmin(text) from public, authenticated, service_role;
