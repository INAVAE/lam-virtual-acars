-- =============================================================================
-- LAM Virtual ACARS — Training: entrenamientos con instructor y reconocimientos
--
-- - Cualquier administrador o jefe de operaciones de una aerolínea (o el
--   superadministrador) programa un entrenamiento: tema, categoría, nivel,
--   fecha y hora (UTC), instructor (piloto de LAM o externo), cupo, canal de
--   Discord y material.
-- - Cualquier piloto con membresía activa en cualquier aerolínea se inscribe;
--   el creador o el instructor aprueba o rechaza. El piloto ve el estado.
-- - Al terminar, el creador o el instructor marca a cada participante como
--   «Completó» o «No asistió». Completar es el reconocimiento que aparece en el
--   perfil del piloto.
-- - Todo pasa por funciones: las tablas no se leen ni se escriben directo.
-- =============================================================================

create sequence public.trainings_folio_seq;

create table public.trainings (
  id               uuid primary key default gen_random_uuid(),
  folio            text not null unique
                   default ('TRN-' || to_char(now() at time zone 'UTC', 'YYYY') || '-' || lpad(nextval('public.trainings_folio_seq')::text, 4, '0')),
  title            text not null check (char_length(btrim(title)) between 3 and 120),
  category         text not null check (category in ('flight_ops', 'aircraft', 'procedures', 'navigation', 'atc', 'weather', 'theory', 'safety', 'simulator', 'other')),
  level            text not null default 'basic' check (level in ('basic', 'intermediate', 'advanced')),
  description      text check (char_length(description) <= 4000),
  aircraft_type_id bigint references public.aircraft_types (id) on delete set null,
  airline_id       uuid references public.airlines (id) on delete set null,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  capacity         smallint check (capacity between 1 and 500),
  instructor_id    uuid references public.profiles (id) on delete set null,
  instructor_name  text check (char_length(btrim(instructor_name)) between 2 and 80),
  discord_url      text check (discord_url ~ '^https://(www\.)?(discord\.com|discord\.gg|discordapp\.com)/[A-Za-z0-9/_-]+$'),
  discord_channel  text check (char_length(discord_channel) <= 80),
  materials_url    text check (materials_url ~ '^https://[^\s]+$' and char_length(materials_url) <= 500),
  status           text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  cancel_reason    text check (char_length(cancel_reason) <= 500),
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (ends_at > starts_at and ends_at <= starts_at + interval '24 hours'),
  check (instructor_id is not null or instructor_name is not null)
);
comment on table public.trainings is 'Entrenamientos (folio TRN-AAAA-NNNN): tema, horario UTC, instructor, cupo y canal de Discord.';
create index trainings_starts_at_idx on public.trainings (starts_at);
create index trainings_instructor_idx on public.trainings (instructor_id);
create index trainings_created_by_idx on public.trainings (created_by);
create index trainings_airline_idx on public.trainings (airline_id);
create index trainings_aircraft_type_idx on public.trainings (aircraft_type_id);

create table public.training_registrations (
  id              uuid primary key default gen_random_uuid(),
  training_id     uuid not null references public.trainings (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  notes           text check (char_length(notes) <= 500),
  review_comment  text check (char_length(review_comment) <= 500),
  reviewed_by     uuid references public.profiles (id) on delete set null,
  reviewed_at     timestamptz,
  result          text check (result in ('completed', 'absent')),
  result_by       uuid references public.profiles (id) on delete set null,
  result_at       timestamptz,
  created_at      timestamptz not null default now(),
  withdrawn_at    timestamptz,
  unique (training_id, user_id),
  check (result is null or status = 'approved')
);
comment on table public.training_registrations is 'Inscripciones a entrenamientos. result = completed es el reconocimiento del perfil.';
create index training_registrations_user_idx on public.training_registrations (user_id);
create index training_registrations_reviewed_by_idx on public.training_registrations (reviewed_by);
create index training_registrations_result_by_idx on public.training_registrations (result_by);

alter table public.trainings enable row level security;
alter table public.training_registrations enable row level security;
revoke all on public.trainings, public.training_registrations from anon, authenticated;

create trigger trainings_set_updated_at before update on public.trainings
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Permisos
-- -----------------------------------------------------------------------------
create function private.can_create_training()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_admin() or exists (
    select 1 from public.airline_memberships m
      join public.profiles p on p.id = m.user_id
     where m.user_id = (select auth.uid()) and m.status = 'active' and p.account_status = 'active'
       and m.roles && '{airline_admin,ops_chief}'::public.airline_role[]
  );
$$;

create function private.can_manage_training(p_training_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_admin() or exists (
    select 1 from public.trainings t
      join public.profiles p on p.id = (select auth.uid())
     where t.id = p_training_id and p.account_status = 'active'
       and (t.created_by = p.id or t.instructor_id = p.id)
  );
$$;

-- Puede inscribirse: cuenta activa con al menos una membresía activa.
create function private.can_join_trainings()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.airline_memberships m join public.profiles p on p.id = m.user_id
     where m.user_id = (select auth.uid()) and m.status = 'active' and p.account_status = 'active'
  );
$$;

revoke all on function private.can_create_training() from public;
revoke all on function private.can_manage_training(uuid) from public;
revoke all on function private.can_join_trainings() from public;
grant execute on function private.can_create_training() to authenticated;
grant execute on function private.can_manage_training(uuid) to authenticated;
grant execute on function private.can_join_trainings() to authenticated;

-- Resumen de un entrenamiento para las listas.
create function private.training_json(t public.trainings)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id, 'folio', t.folio, 'title', t.title, 'category', t.category, 'level', t.level,
    'description', t.description, 'starts_at', t.starts_at, 'ends_at', t.ends_at, 'capacity', t.capacity,
    'status', t.status, 'cancel_reason', t.cancel_reason,
    'discord_url', t.discord_url, 'discord_channel', t.discord_channel, 'materials_url', t.materials_url,
    'aircraft_type', (select jsonb_build_object('id', at.id, 'icao_code', at.icao_code, 'model', at.model) from public.aircraft_types at where at.id = t.aircraft_type_id),
    'airline', (select jsonb_build_object('id', a.id, 'name', a.name, 'icao_code', a.icao_code, 'logo_path', a.logo_path, 'brand_primary_color', a.brand_primary_color)
                  from public.airlines a where a.id = t.airline_id),
    'instructor', case when t.instructor_id is not null then (
                    select jsonb_build_object('user_id', p.id, 'display_name', p.display_name, 'pilot_number', p.pilot_number, 'avatar_url', p.avatar_url)
                      from public.profiles p where p.id = t.instructor_id)
                  else jsonb_build_object('user_id', null, 'display_name', t.instructor_name, 'pilot_number', null, 'avatar_url', null) end,
    'created_by', (select jsonb_build_object('user_id', p.id, 'display_name', p.display_name, 'pilot_number', p.pilot_number)
                     from public.profiles p where p.id = t.created_by),
    'approved', (select count(*) from public.training_registrations r where r.training_id = t.id and r.status = 'approved'),
    'pending', (select count(*) from public.training_registrations r where r.training_id = t.id and r.status = 'pending'),
    'completed', (select count(*) from public.training_registrations r where r.training_id = t.id and r.result = 'completed'),
    'my_registration', (select jsonb_build_object('id', r.id, 'status', r.status, 'result', r.result, 'review_comment', r.review_comment,
                                                  'notes', r.notes, 'created_at', r.created_at)
                          from public.training_registrations r where r.training_id = t.id and r.user_id = (select auth.uid())),
    'can_manage', private.can_manage_training(t.id)
  );
$$;
revoke all on function private.training_json(public.trainings) from public;
grant execute on function private.training_json(public.trainings) to authenticated;

-- -----------------------------------------------------------------------------
-- Consultar
-- -----------------------------------------------------------------------------
create function public.get_trainings(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not exists (select 1 from public.profiles p where p.id = v_uid and p.account_status = 'active') then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  return jsonb_build_object(
    'can_create', private.can_create_training(),
    'can_join', private.can_join_trainings(),
    'trainings', coalesce((
      select jsonb_agg(private.training_json(t) order by t.starts_at)
        from public.trainings t
       where (p_from is null or t.ends_at >= p_from) and (p_to is null or t.starts_at < p_to)
    ), '[]'::jsonb)
  );
end;
$$;

create function public.get_training(p_training_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  t public.trainings;
  v_manage boolean;
begin
  if v_uid is null or not exists (select 1 from public.profiles p where p.id = v_uid and p.account_status = 'active') then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  select * into t from public.trainings where id = p_training_id;
  if not found then
    raise exception 'El entrenamiento no existe' using errcode = 'P0002';
  end if;
  v_manage := private.can_manage_training(t.id);
  return private.training_json(t) || jsonb_build_object(
    'can_join', private.can_join_trainings(),
    'aircraft_type_id', t.aircraft_type_id,
    'airline_id', t.airline_id,
    'instructor_id', t.instructor_id,
    'instructor_name', t.instructor_name,
    -- Quien administra ve todas las inscripciones; los demás, solo los participantes aprobados.
    'registrations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'status', r.status, 'result', r.result,
               'notes', case when v_manage or r.user_id = v_uid then r.notes end,
               'review_comment', case when v_manage or r.user_id = v_uid then r.review_comment end,
               'created_at', r.created_at, 'reviewed_at', r.reviewed_at, 'result_at', r.result_at,
               'pilot', jsonb_build_object('user_id', p.id, 'display_name', p.display_name, 'pilot_number', p.pilot_number,
                                           'avatar_url', p.avatar_url,
                                           'discord_username', case when v_manage then p.discord_username end,
                                           'airlines', (select string_agg(a.icao_code, ', ' order by a.icao_code)
                                                          from public.airline_memberships m join public.airlines a on a.id = m.airline_id
                                                         where m.user_id = p.id and m.status = 'active')))
             order by case r.status when 'pending' then 0 when 'approved' then 1 when 'rejected' then 2 else 3 end, r.created_at)
        from public.training_registrations r join public.profiles p on p.id = r.user_id
       where r.training_id = t.id and (v_manage or r.status = 'approved' or r.user_id = v_uid)
    ), '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Programar, editar y cancelar
-- -----------------------------------------------------------------------------
create function public.save_training(p_training_id uuid, p_training jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid := p_training_id;
  v_starts timestamptz;
  v_ends timestamptz;
  v_instructor uuid := nullif(p_training ->> 'instructor_id', '')::uuid;
  v_instructor_name text := nullif(btrim(coalesce(p_training ->> 'instructor_name', '')), '');
  v_airline uuid := nullif(p_training ->> 'airline_id', '')::uuid;
  v_type bigint := nullif(p_training ->> 'aircraft_type_id', '')::bigint;
  v_capacity smallint := nullif(p_training ->> 'capacity', '')::smallint;
  v_approved integer;
  t public.trainings;
begin
  if v_id is null then
    if not private.can_create_training() then
      raise exception 'Solo los administradores y jefes de operaciones programan entrenamientos' using errcode = '42501';
    end if;
  else
    select * into t from public.trainings where id = v_id for update;
    if not found then
      raise exception 'El entrenamiento no existe' using errcode = 'P0002';
    end if;
    if not private.can_manage_training(v_id) then
      raise exception 'Solo quien lo creó o su instructor lo modifican' using errcode = '42501';
    end if;
    if t.status = 'cancelled' then
      raise exception 'Está cancelado; ya no se modifica' using errcode = 'P0001', hint = 'cancelled';
    end if;
  end if;

  begin
    v_starts := (p_training ->> 'starts_at')::timestamptz;
    v_ends := (p_training ->> 'ends_at')::timestamptz;
  exception when others then
    raise exception 'Revisa la fecha y la hora' using errcode = '22023', hint = 'invalid_time';
  end;
  if v_starts is null or v_ends is null or v_ends <= v_starts then
    raise exception 'La hora de fin debe ser posterior a la de inicio' using errcode = '22023', hint = 'invalid_time';
  end if;
  if v_ends > v_starts + interval '24 hours' then
    raise exception 'Un entrenamiento dura como máximo 24 horas' using errcode = '22023', hint = 'too_long';
  end if;
  if v_id is null and v_starts < now() - interval '5 minutes' then
    raise exception 'Programa el entrenamiento en una fecha futura' using errcode = '22023', hint = 'past';
  end if;
  if v_instructor is not null then
    if not exists (select 1 from public.profiles p where p.id = v_instructor and p.account_status = 'active') then
      raise exception 'El instructor no tiene una cuenta activa' using errcode = '22023', hint = 'invalid_instructor';
    end if;
    v_instructor_name := null;
  elsif v_instructor_name is null then
    raise exception 'Elige un instructor de LAM o escribe su nombre' using errcode = '22023', hint = 'instructor_required';
  end if;
  if v_airline is not null and not (private.is_org_admin() or private.is_airline_member(v_airline)) then
    raise exception 'Solo organizas a nombre de una aerolínea donde eres miembro' using errcode = '42501';
  end if;
  if v_id is not null and v_capacity is not null then
    select count(*) into v_approved from public.training_registrations where training_id = v_id and status = 'approved';
    if v_capacity < v_approved then
      raise exception 'Ya hay % participantes aprobados; el cupo no puede ser menor', v_approved using errcode = 'P0001', hint = 'capacity';
    end if;
  end if;

  if v_id is null then
    insert into public.trainings (title, category, level, description, aircraft_type_id, airline_id, starts_at, ends_at, capacity,
                                  instructor_id, instructor_name, discord_url, discord_channel, materials_url, created_by)
    values (btrim(p_training ->> 'title'), p_training ->> 'category', coalesce(p_training ->> 'level', 'basic'),
            nullif(btrim(coalesce(p_training ->> 'description', '')), ''), v_type, v_airline, v_starts, v_ends, v_capacity,
            v_instructor, v_instructor_name, nullif(btrim(coalesce(p_training ->> 'discord_url', '')), ''),
            nullif(btrim(coalesce(p_training ->> 'discord_channel', '')), ''), nullif(btrim(coalesce(p_training ->> 'materials_url', '')), ''), v_uid)
    returning id into v_id;
  else
    update public.trainings
       set title = btrim(p_training ->> 'title'), category = p_training ->> 'category', level = coalesce(p_training ->> 'level', 'basic'),
           description = nullif(btrim(coalesce(p_training ->> 'description', '')), ''), aircraft_type_id = v_type, airline_id = v_airline,
           starts_at = v_starts, ends_at = v_ends, capacity = v_capacity, instructor_id = v_instructor, instructor_name = v_instructor_name,
           discord_url = nullif(btrim(coalesce(p_training ->> 'discord_url', '')), ''),
           discord_channel = nullif(btrim(coalesce(p_training ->> 'discord_channel', '')), ''),
           materials_url = nullif(btrim(coalesce(p_training ->> 'materials_url', '')), '')
     where id = v_id;
  end if;
  return v_id;
end;
$$;

create function public.cancel_training(p_training_id uuid, p_reason text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.can_manage_training(p_training_id) then
    raise exception 'Solo quien lo creó o su instructor lo cancelan' using errcode = '42501';
  end if;
  update public.trainings
     set status = 'cancelled', cancel_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), '')
   where id = p_training_id and status = 'scheduled' and ends_at > now();
  if not found then
    raise exception 'Solo se cancela un entrenamiento programado que no ha terminado' using errcode = 'P0001', hint = 'not_cancellable';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Inscripción
-- -----------------------------------------------------------------------------
create function public.register_training(p_training_id uuid, p_notes text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  t public.trainings;
  v_id uuid;
begin
  if not private.can_join_trainings() then
    raise exception 'Para inscribirte necesitas ser miembro activo de alguna aerolínea' using errcode = '42501', hint = 'no_airline';
  end if;
  select * into t from public.trainings where id = p_training_id;
  if not found then
    raise exception 'El entrenamiento no existe' using errcode = 'P0002';
  end if;
  if t.status <> 'scheduled' or t.starts_at <= now() then
    raise exception 'Las inscripciones cierran al empezar el entrenamiento' using errcode = 'P0001', hint = 'closed';
  end if;
  if t.instructor_id = v_uid then
    raise exception 'Eres el instructor de este entrenamiento' using errcode = 'P0001', hint = 'instructor';
  end if;
  insert into public.training_registrations (training_id, user_id, notes)
  values (t.id, v_uid, nullif(left(btrim(coalesce(p_notes, '')), 500), ''))
  on conflict (training_id, user_id) do update
     set status = 'pending', notes = excluded.notes, withdrawn_at = null, review_comment = null, reviewed_by = null, reviewed_at = null,
         created_at = now()
   where public.training_registrations.status = 'withdrawn'
  returning id into v_id;
  if v_id is null then
    raise exception 'Ya tienes una inscripción en este entrenamiento' using errcode = 'P0001', hint = 'already_registered';
  end if;
  return v_id;
end;
$$;

create function public.withdraw_training_registration(p_registration_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.training_registrations r
     set status = 'withdrawn', withdrawn_at = now()
   where r.id = p_registration_id and r.user_id = (select auth.uid()) and r.status in ('pending', 'approved') and r.result is null
     and exists (select 1 from public.trainings t where t.id = r.training_id and t.ends_at > now());
  if not found then
    raise exception 'No hay una inscripción activa que retirar' using errcode = 'P0001', hint = 'not_withdrawable';
  end if;
end;
$$;

create function public.review_training_registration(p_registration_id uuid, p_approve boolean, p_comment text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.training_registrations;
  t public.trainings;
  v_approved integer;
begin
  select * into r from public.training_registrations where id = p_registration_id for update;
  if not found then
    raise exception 'La inscripción no existe' using errcode = 'P0002';
  end if;
  if not private.can_manage_training(r.training_id) then
    raise exception 'Solo quien lo creó o su instructor revisan las inscripciones' using errcode = '42501';
  end if;
  if r.status not in ('pending', 'approved', 'rejected') or r.result is not null then
    raise exception 'Esta inscripción ya no se puede revisar' using errcode = 'P0001', hint = 'not_reviewable';
  end if;
  select * into t from public.trainings where id = r.training_id for update;
  if t.status = 'cancelled' then
    raise exception 'El entrenamiento está cancelado' using errcode = 'P0001', hint = 'cancelled';
  end if;
  if p_approve and r.status <> 'approved' and t.capacity is not null then
    select count(*) into v_approved from public.training_registrations where training_id = t.id and status = 'approved';
    if v_approved >= t.capacity then
      raise exception 'El cupo de % participantes está lleno', t.capacity using errcode = 'P0001', hint = 'full';
    end if;
  end if;
  update public.training_registrations
     set status = case when p_approve then 'approved' else 'rejected' end,
         review_comment = nullif(left(btrim(coalesce(p_comment, '')), 500), ''),
         reviewed_by = (select auth.uid()), reviewed_at = now()
   where id = r.id;
end;
$$;

-- Resultado: «Completó» es el reconocimiento del perfil; «No asistió» no cuenta.
create function public.set_training_result(p_registration_id uuid, p_result text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  r public.training_registrations;
  t public.trainings;
begin
  if p_result is not null and p_result not in ('completed', 'absent') then
    raise exception 'Resultado inválido' using errcode = '22023';
  end if;
  select * into r from public.training_registrations where id = p_registration_id for update;
  if not found then
    raise exception 'La inscripción no existe' using errcode = 'P0002';
  end if;
  if not private.can_manage_training(r.training_id) then
    raise exception 'Solo quien lo creó o su instructor registran la asistencia' using errcode = '42501';
  end if;
  select * into t from public.trainings where id = r.training_id;
  if t.status = 'cancelled' then
    raise exception 'El entrenamiento está cancelado' using errcode = 'P0001', hint = 'cancelled';
  end if;
  if t.starts_at > now() then
    raise exception 'La asistencia se registra cuando el entrenamiento ya empezó' using errcode = 'P0001', hint = 'not_started';
  end if;
  if r.status <> 'approved' then
    raise exception 'Solo los participantes aprobados reciben resultado' using errcode = 'P0001', hint = 'not_approved';
  end if;
  update public.training_registrations
     set result = p_result,
         result_by = case when p_result is null then null else (select auth.uid()) end,
         result_at = case when p_result is null then null else now() end
   where id = r.id;
end;
$$;

-- Pilotos de LAM para elegir instructor (solo quien programa entrenamientos).
create function public.search_training_instructors(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
begin
  if not private.can_create_training() then
    raise exception 'Solo quien programa entrenamientos busca instructores' using errcode = '42501';
  end if;
  if char_length(v_q) < 2 then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_id', p.id, 'display_name', p.display_name, 'pilot_number', p.pilot_number, 'avatar_url', p.avatar_url)
           order by p.display_name)
      from (select * from public.profiles p
             where p.account_status = 'active'
               and (p.display_name ilike '%' || v_q || '%' or ('LAM' || p.pilot_number::text) ilike '%' || v_q || '%' or p.pilot_number::text = v_q)
             order by p.display_name limit 10) p
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.get_trainings(timestamptz, timestamptz) from public, anon;
revoke all on function public.get_training(uuid) from public, anon;
revoke all on function public.save_training(uuid, jsonb) from public, anon;
revoke all on function public.cancel_training(uuid, text) from public, anon;
revoke all on function public.register_training(uuid, text) from public, anon;
revoke all on function public.withdraw_training_registration(uuid) from public, anon;
revoke all on function public.review_training_registration(uuid, boolean, text) from public, anon;
revoke all on function public.set_training_result(uuid, text) from public, anon;
revoke all on function public.search_training_instructors(text) from public, anon;
grant execute on function public.get_trainings(timestamptz, timestamptz) to authenticated;
grant execute on function public.get_training(uuid) to authenticated;
grant execute on function public.save_training(uuid, jsonb) to authenticated;
grant execute on function public.cancel_training(uuid, text) to authenticated;
grant execute on function public.register_training(uuid, text) to authenticated;
grant execute on function public.withdraw_training_registration(uuid) to authenticated;
grant execute on function public.review_training_registration(uuid, boolean, text) to authenticated;
grant execute on function public.set_training_result(uuid, text) to authenticated;
grant execute on function public.search_training_instructors(text) to authenticated;

-- Entrenamientos completados de un piloto (reconocimientos de su perfil).
create function public.get_pilot_trainings(p_pilot_number integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'training_id', t.id, 'folio', t.folio, 'title', t.title, 'category', t.category, 'level', t.level,
           'starts_at', t.starts_at, 'completed_at', r.result_at,
           'instructor', coalesce((select p.display_name from public.profiles p where p.id = t.instructor_id), t.instructor_name))
         order by t.starts_at desc), '[]'::jsonb)
    from public.training_registrations r
    join public.trainings t on t.id = r.training_id
    join public.profiles me on me.id = (select auth.uid()) and me.account_status = 'active'
   where r.user_id = (select p.id from public.profiles p where p.pilot_number = p_pilot_number)
     and r.result = 'completed';
$$;
revoke all on function public.get_pilot_trainings(integer) from public, anon;
grant execute on function public.get_pilot_trainings(integer) to authenticated;
