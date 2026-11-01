-- Fase 7.5: Tours.
--
-- Un piloto o un administrador crea un tour con sus legs. Si lo crea un piloto, el
-- administrador de su aerolínea lo aprueba antes de publicarse. Cualquier piloto
-- de cualquier aerolínea se inscribe; el creador aprueba la inscripción (o se
-- aprueba sola si el tour lo permite para su misma aerolínea). Cada leg se vuela
-- con la flota de la aerolínea del piloto y su PIREP cuenta como un vuelo normal.
-- Un leg cuenta con el PIREP aceptado o en revisión; si se rechaza o se archiva,
-- se repite. Con todos los legs aceptados el piloto gana la insignia del tour.
--
-- El avance no se guarda aparte: sale de los vuelos y PIREP de la inscripción.

create type public.tour_status as enum ('draft', 'submitted', 'published', 'closed', 'rejected');
create type public.enrollment_status as enum ('pending', 'approved', 'rejected', 'withdrawn', 'completed');

-- -----------------------------------------------------------------------------
-- Tablas
-- -----------------------------------------------------------------------------
create table public.tours (
  id                        uuid primary key default gen_random_uuid(),
  airline_id                uuid not null references public.airlines (id) on delete restrict,
  created_by                uuid references public.profiles (id) on delete set null,
  code                      text not null unique check (code ~ '^[A-Z0-9][A-Z0-9-]{2,15}$'),
  name                      text not null check (char_length(name) between 3 and 80),
  description               text check (char_length(description) <= 4000),
  color                     text not null default '#a855f7' check (color ~ '^#[0-9a-fA-F]{6}$'),
  badge_path                text check (char_length(badge_path) <= 200),
  aircraft_type_ids         bigint[] not null default '{}',
  starts_on                 date,
  ends_on                   date,
  ordered_legs              boolean not null default true,
  allow_unreviewed_progress boolean not null default true,
  max_unreviewed_legs       smallint not null default 2 check (max_unreviewed_legs between 1 and 20),
  auto_approve_same_airline boolean not null default false,
  status                    public.tour_status not null default 'draft',
  submitted_at              timestamptz,
  reviewed_by               uuid references public.profiles (id) on delete set null,
  reviewed_at               timestamptz,
  review_comment            text check (char_length(review_comment) <= 1000),
  published_at              timestamptz,
  closed_at                 timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint tours_dates check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
comment on table public.tours is 'Tours de varias rutas (legs). Se crean y cambian solo con las funciones save_tour, submit_tour, review_tour y close_tour.';
comment on column public.tours.aircraft_type_ids is 'Tipos de aeronave permitidos; vacío permite cualquiera.';
comment on column public.tours.max_unreviewed_legs is 'Cuántos legs puede tener el piloto con PIREP en revisión antes de volar el siguiente.';
create index tours_airline_id_status_idx on public.tours (airline_id, status);
create index tours_created_by_idx on public.tours (created_by);
create index tours_reviewed_by_idx on public.tours (reviewed_by);
create trigger tours_set_updated_at before update on public.tours
  for each row execute function private.set_updated_at();

create table public.tour_legs (
  id                     uuid primary key default gen_random_uuid(),
  tour_id                uuid not null references public.tours (id) on delete cascade,
  leg_number             smallint not null check (leg_number between 1 and 60),
  origin_airport_id      bigint not null references public.airports (id) on delete restrict,
  destination_airport_id bigint not null references public.airports (id) on delete restrict,
  distance_nm            integer not null check (distance_nm >= 0),
  notes                  text check (char_length(notes) <= 500),
  constraint tour_legs_number_unique unique (tour_id, leg_number),
  constraint tour_legs_distinct_airports check (origin_airport_id <> destination_airport_id)
);
comment on table public.tour_legs is 'Legs de un tour, numerados desde 1. No tienen que existir en routes.';
create index tour_legs_origin_airport_id_idx on public.tour_legs (origin_airport_id);
create index tour_legs_destination_airport_id_idx on public.tour_legs (destination_airport_id);

create table public.tour_enrollments (
  id             uuid primary key default gen_random_uuid(),
  tour_id        uuid not null references public.tours (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  airline_id     uuid not null references public.airlines (id) on delete restrict,
  status         public.enrollment_status not null default 'pending',
  auto_approved  boolean not null default false,
  reviewed_by    uuid references public.profiles (id) on delete set null,
  reviewed_at    timestamptz,
  review_comment text check (char_length(review_comment) <= 1000),
  created_at     timestamptz not null default now(),
  completed_at   timestamptz,
  withdrawn_at   timestamptz
);
comment on table public.tour_enrollments is 'Inscripciones a tours. airline_id es la aerolínea con cuya flota vuela el piloto.';
create unique index tour_enrollments_one_per_pilot on public.tour_enrollments (tour_id, user_id)
  where status in ('pending', 'approved', 'completed');
create index tour_enrollments_user_id_idx on public.tour_enrollments (user_id, status);
create index tour_enrollments_airline_id_idx on public.tour_enrollments (airline_id);
create index tour_enrollments_reviewed_by_idx on public.tour_enrollments (reviewed_by);

alter table public.flights
  add column tour_leg_id uuid references public.tour_legs (id) on delete set null,
  add column tour_enrollment_id uuid references public.tour_enrollments (id) on delete set null;
comment on column public.flights.tour_leg_id is 'Leg de tour que se vuela con este vuelo (lo fija book_tour_leg).';
create index flights_tour_leg_id_idx on public.flights (tour_leg_id);
create index flights_tour_enrollment_id_idx on public.flights (tour_enrollment_id);

create table public.pilot_badges (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  tour_id       uuid not null references public.tours (id) on delete cascade,
  enrollment_id uuid not null unique references public.tour_enrollments (id) on delete cascade,
  awarded_at    timestamptz not null default now(),
  revoked_at    timestamptz
);
comment on table public.pilot_badges is 'Insignias de tours terminados (todos los legs con PIREP aceptado). Se retiran si un PIREP deja de estar aceptado.';
create index pilot_badges_user_id_idx on public.pilot_badges (user_id);
create index pilot_badges_tour_id_idx on public.pilot_badges (tour_id);

-- -----------------------------------------------------------------------------
-- Permisos
-- -----------------------------------------------------------------------------
create function private.can_view_tour(p_tour_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tours t
    where t.id = p_tour_id
      and (t.status in ('published', 'closed')
           or t.created_by = (select auth.uid())
           or private.can_staff_airline(t.airline_id))
  );
$$;

-- El creador o un administrador de la aerolínea del tour.
create function private.can_edit_tour(p_tour_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tours t
    where t.id = p_tour_id
      and (t.created_by = (select auth.uid()) or private.can_manage_airline(t.airline_id))
  );
$$;

create function private.can_edit_tour_folder(p_folder text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_folder is null or p_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.can_edit_tour(p_folder::uuid);
end;
$$;

revoke all on function private.can_view_tour(uuid) from public;
revoke all on function private.can_edit_tour(uuid) from public;
revoke all on function private.can_edit_tour_folder(text) from public;
grant execute on function private.can_view_tour(uuid) to authenticated, service_role;
grant execute on function private.can_edit_tour(uuid) to authenticated, service_role;
grant execute on function private.can_edit_tour_folder(text) to authenticated, service_role;

alter table public.tours enable row level security;
alter table public.tour_legs enable row level security;
alter table public.tour_enrollments enable row level security;
alter table public.pilot_badges enable row level security;

create policy tours_select on public.tours for select to authenticated
  using ((select private.is_org_admin()) or private.can_view_tour(id));
create policy tour_legs_select on public.tour_legs for select to authenticated
  using (private.can_view_tour(tour_id));
create policy tour_enrollments_select on public.tour_enrollments for select to authenticated
  using (user_id = (select auth.uid()) or private.can_edit_tour(tour_id) or private.can_staff_airline(airline_id));
create policy pilot_badges_select on public.pilot_badges for select to authenticated
  using (true);

grant select on public.tours, public.tour_legs, public.tour_enrollments, public.pilot_badges to authenticated;

-- Insignias: bucket público, carpeta por tour.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tour-badges', 'tour-badges', true, 524288, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy tour_badges_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'tour-badges' and private.can_edit_tour_folder((storage.foldername(name))[1]));
create policy tour_badges_update on storage.objects for update to authenticated
  using (bucket_id = 'tour-badges' and private.can_edit_tour_folder((storage.foldername(name))[1]));
create policy tour_badges_delete on storage.objects for delete to authenticated
  using (bucket_id = 'tour-badges' and private.can_edit_tour_folder((storage.foldername(name))[1]));

-- -----------------------------------------------------------------------------
-- Mensajes
-- -----------------------------------------------------------------------------
create function private.program_reason_message(p_reason text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_reason
    when 'tour_not_found' then 'El tour no existe o no tienes acceso'
    when 'tour_locked' then 'El tour ya está publicado: sus legs y tipos de aeronave no se pueden cambiar'
    when 'tour_not_published' then 'El tour no está publicado'
    when 'tour_not_started' then 'El tour todavía no empieza'
    when 'tour_ended' then 'El tour ya terminó'
    when 'tour_no_legs' then 'El tour necesita al menos un leg'
    when 'tour_code_taken' then 'Ya existe un tour con ese código'
    when 'already_enrolled' then 'Ya estás inscrito en este tour'
    when 'enrollment_not_found' then 'La inscripción no existe'
    when 'enrollment_not_approved' then 'Tu inscripción todavía no está aprobada'
    when 'enrollment_closed' then 'La inscripción ya no está activa'
    when 'leg_not_in_tour' then 'El leg no pertenece al tour'
    when 'leg_done' then 'Ese leg ya está volado'
    when 'leg_out_of_order' then 'Este tour se vuela en orden: primero termina el leg anterior'
    when 'previous_unreviewed' then 'Este tour pide que el leg anterior esté revisado antes de volar el siguiente'
    when 'too_many_unreviewed' then 'Tienes el máximo de legs en revisión que permite el tour; espera a que se revisen'
    when 'tour_flight_active' then 'Ya tienes un vuelo de este tour reservado o en curso'
    when 'flight_active' then 'Tienes un vuelo de este tour reservado o en curso: cancélalo antes de retirarte'
    when 'invalid_flight_number' then 'Número de vuelo inválido: de 1 a 4 dígitos y, opcional, una letra'
    when 'program_conflict' then 'No puedes participar en un evento y en un tour a la vez'
    else private.booking_reason_message(p_reason)
  end;
$$;
revoke all on function private.program_reason_message(text) from public;

-- Igual que booking_block_reason, pero sin ruta: aerolínea, disponibilidad, tipo, habilitación y origen.
create function private.program_aircraft_block_reason(p_user_id uuid, p_airline_id uuid, p_aircraft_id uuid, p_type_ids bigint[], p_origin bigint)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ac_airline uuid;
  v_ac_type bigint;
  v_ac_status public.aircraft_status;
  v_ac_location bigint;
  v_require_rating boolean;
  v_require_origin boolean;
begin
  select a.airline_id, a.aircraft_type_id, a.status, coalesce(a.current_airport_id, a.base_airport_id)
    into v_ac_airline, v_ac_type, v_ac_status, v_ac_location
  from public.aircraft a where a.id = p_aircraft_id;
  if not found or v_ac_airline <> p_airline_id then
    return 'aircraft_other_airline';
  end if;
  if v_ac_status <> 'available' then
    return 'aircraft_unavailable';
  end if;
  if coalesce(cardinality(p_type_ids), 0) > 0 and not (v_ac_type = any (p_type_ids)) then
    return 'type_not_allowed';
  end if;
  select s.require_type_rating, s.require_aircraft_at_origin into v_require_rating, v_require_origin
  from public.airline_settings s where s.airline_id = p_airline_id;
  if coalesce(v_require_rating, true) and not exists (
    select 1 from public.pilot_type_ratings pr
    where pr.airline_id = p_airline_id and pr.user_id = p_user_id and pr.aircraft_type_id = v_ac_type
  ) then
    return 'no_rating';
  end if;
  if coalesce(v_require_origin, false) and v_ac_location is distinct from p_origin then
    return 'not_at_origin';
  end if;
  return null;
end;
$$;
revoke all on function private.program_aircraft_block_reason(uuid, uuid, uuid, bigint[], bigint) from public;

-- ¿El piloto está en otro programa (evento) que le impide entrar a un tour? Fase 7.4 la amplía.
create function private.user_in_event(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select false;
$$;
revoke all on function private.user_in_event(uuid) from public;

-- ¿Tiene una inscripción activa en un tour no terminado?
create function private.user_in_tour(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tour_enrollments e
    join public.tours t on t.id = e.tour_id
    where e.user_id = p_user_id
      and e.status in ('pending', 'approved')
      and t.status = 'published'
      and (t.ends_on is null or t.ends_on >= current_date)
  );
$$;
revoke all on function private.user_in_tour(uuid) from public;

-- -----------------------------------------------------------------------------
-- Avance de una inscripción, leg por leg
--   accepted   PIREP aceptado
--   in_review  PIREP pendiente de revisión (cuenta como volado)
--   booked     reservado o en vuelo
--   repeat     tuvo PIREP, pero rechazado o archivado: se repite
--   open       sin volar
-- -----------------------------------------------------------------------------
create function private.tour_leg_states(p_enrollment_id uuid)
returns table (leg_id uuid, leg_number smallint, state text, flight_id uuid, pirep_id uuid, pirep_status text, attempts integer)
language sql
stable
security definer
set search_path = ''
as $$
  select l.id, l.leg_number,
         case
           when bool_or(p.status = 'accepted') then 'accepted'
           when bool_or(p.status = 'pending') then 'in_review'
           when bool_or(f.status in ('scheduled', 'in_progress')) then 'booked'
           when count(p.id) > 0 then 'repeat'
           else 'open'
         end,
         (array_agg(f.id order by (p.status = 'accepted') desc nulls last, (p.status = 'pending') desc nulls last,
                    (f.status in ('scheduled', 'in_progress')) desc, f.created_at desc) filter (where f.id is not null))[1],
         (array_agg(p.id order by (p.status = 'accepted') desc, (p.status = 'pending') desc, p.created_at desc) filter (where p.id is not null))[1],
         (array_agg(p.status::text order by (p.status = 'accepted') desc, (p.status = 'pending') desc, p.created_at desc) filter (where p.id is not null))[1],
         count(p.id)::integer
    from public.tour_enrollments e
    join public.tour_legs l on l.tour_id = e.tour_id
    left join public.flights f on f.tour_enrollment_id = e.id and f.tour_leg_id = l.id and f.status <> 'cancelled'
    left join public.pireps p on p.flight_id = f.id
   where e.id = p_enrollment_id
   group by l.id, l.leg_number
   order by l.leg_number;
$$;
revoke all on function private.tour_leg_states(uuid) from public;

-- Completa la inscripción y da la insignia cuando todos los legs están aceptados;
-- si un PIREP deja de estar aceptado, la inscripción vuelve a quedar aprobada.
create function private.refresh_tour_enrollment(p_enrollment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment public.tour_enrollments;
  v_total integer;
  v_accepted integer;
begin
  select * into v_enrollment from public.tour_enrollments where id = p_enrollment_id for update;
  if not found or v_enrollment.status not in ('approved', 'completed') then
    return;
  end if;
  select count(*), count(*) filter (where s.state = 'accepted') into v_total, v_accepted
  from private.tour_leg_states(p_enrollment_id) s;

  if v_total > 0 and v_accepted = v_total then
    if v_enrollment.status = 'approved' then
      update public.tour_enrollments set status = 'completed', completed_at = now() where id = p_enrollment_id;
    end if;
    insert into public.pilot_badges (user_id, tour_id, enrollment_id)
    values (v_enrollment.user_id, v_enrollment.tour_id, p_enrollment_id)
    on conflict (enrollment_id) do update set revoked_at = null, awarded_at = case when public.pilot_badges.revoked_at is null then public.pilot_badges.awarded_at else now() end;
  elsif v_enrollment.status = 'completed' then
    update public.tour_enrollments set status = 'approved', completed_at = null where id = p_enrollment_id;
    update public.pilot_badges set revoked_at = now() where enrollment_id = p_enrollment_id and revoked_at is null;
  end if;
end;
$$;
revoke all on function private.refresh_tour_enrollment(uuid) from public;

create function private.pireps_refresh_tour()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment uuid;
begin
  select f.tour_enrollment_id into v_enrollment from public.flights f where f.id = new.flight_id;
  if v_enrollment is not null then
    perform private.refresh_tour_enrollment(v_enrollment);
  end if;
  return null;
end;
$$;
create trigger pireps_refresh_tour after insert or update of status on public.pireps
  for each row execute function private.pireps_refresh_tour();

-- -----------------------------------------------------------------------------
-- API: crear y editar
-- p_tour: {airline_id, code, name, description, color, badge_path, aircraft_type_ids,
--          starts_on, ends_on, ordered_legs, allow_unreviewed_progress,
--          max_unreviewed_legs, auto_approve_same_airline}
-- p_legs: [{origin_airport_id, destination_airport_id, notes}] en orden; null no los toca.
-- -----------------------------------------------------------------------------
create function public.save_tour(p_tour_id uuid, p_tour jsonb, p_legs jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_tour public.tours;
  v_id uuid := p_tour_id;
  v_airline uuid;
  v_types bigint[];
  v_leg jsonb;
  v_n integer := 0;
  v_origin public.airports;
  v_dest public.airports;
begin
  if v_uid is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  v_types := coalesce((select array_agg(distinct x::bigint) from jsonb_array_elements_text(coalesce(p_tour -> 'aircraft_type_ids', '[]'::jsonb)) x), '{}');
  if exists (select 1 from unnest(v_types) t where not exists (select 1 from public.aircraft_types a where a.id = t)) then
    raise exception 'Hay un tipo de aeronave que no existe' using errcode = '22023';
  end if;

  if v_id is null then
    v_airline := (p_tour ->> 'airline_id')::uuid;
    if v_airline is null or not (private.is_airline_member(v_airline) or private.is_org_admin()) then
      raise exception 'Solo los miembros de la aerolínea crean tours en ella' using errcode = '42501';
    end if;
    begin
      insert into public.tours (airline_id, created_by, code, name, description, color, badge_path, aircraft_type_ids, starts_on, ends_on,
                                ordered_legs, allow_unreviewed_progress, max_unreviewed_legs, auto_approve_same_airline)
      values (v_airline, v_uid, upper(trim(p_tour ->> 'code')), trim(p_tour ->> 'name'), nullif(trim(p_tour ->> 'description'), ''),
              coalesce(p_tour ->> 'color', '#a855f7'), nullif(p_tour ->> 'badge_path', ''), v_types,
              (p_tour ->> 'starts_on')::date, (p_tour ->> 'ends_on')::date,
              coalesce((p_tour ->> 'ordered_legs')::boolean, true), coalesce((p_tour ->> 'allow_unreviewed_progress')::boolean, true),
              coalesce((p_tour ->> 'max_unreviewed_legs')::smallint, 2), coalesce((p_tour ->> 'auto_approve_same_airline')::boolean, false))
      returning id into v_id;
    exception when unique_violation then
      raise exception '%', private.program_reason_message('tour_code_taken') using errcode = '23505', hint = 'tour_code_taken';
    end;
    select * into v_tour from public.tours where id = v_id;
  else
    select * into v_tour from public.tours where id = v_id for update;
    if not found or not private.can_edit_tour(v_id) then
      raise exception '%', private.program_reason_message('tour_not_found') using errcode = 'P0002', hint = 'tour_not_found';
    end if;
    if v_tour.status in ('published', 'closed') and (p_legs is not null or v_types is distinct from v_tour.aircraft_type_ids
        or upper(trim(p_tour ->> 'code')) is distinct from v_tour.code) then
      raise exception '%', private.program_reason_message('tour_locked') using errcode = 'P0001', hint = 'tour_locked';
    end if;
    begin
      update public.tours set
        code = upper(trim(p_tour ->> 'code')),
        name = trim(p_tour ->> 'name'),
        description = nullif(trim(p_tour ->> 'description'), ''),
        color = coalesce(p_tour ->> 'color', color),
        badge_path = nullif(p_tour ->> 'badge_path', ''),
        aircraft_type_ids = v_types,
        starts_on = (p_tour ->> 'starts_on')::date,
        ends_on = (p_tour ->> 'ends_on')::date,
        ordered_legs = coalesce((p_tour ->> 'ordered_legs')::boolean, ordered_legs),
        allow_unreviewed_progress = coalesce((p_tour ->> 'allow_unreviewed_progress')::boolean, allow_unreviewed_progress),
        max_unreviewed_legs = coalesce((p_tour ->> 'max_unreviewed_legs')::smallint, max_unreviewed_legs),
        auto_approve_same_airline = coalesce((p_tour ->> 'auto_approve_same_airline')::boolean, auto_approve_same_airline)
      where id = v_id;
    exception when unique_violation then
      raise exception '%', private.program_reason_message('tour_code_taken') using errcode = '23505', hint = 'tour_code_taken';
    end;
  end if;

  if p_legs is not null then
    if jsonb_typeof(p_legs) <> 'array' or jsonb_array_length(p_legs) > 60 then
      raise exception 'Un tour tiene de 1 a 60 legs' using errcode = '22023';
    end if;
    delete from public.tour_legs where tour_id = v_id;
    for v_leg in select value from jsonb_array_elements(p_legs) loop
      v_n := v_n + 1;
      select * into v_origin from public.airports where id = (v_leg ->> 'origin_airport_id')::bigint;
      select * into v_dest from public.airports where id = (v_leg ->> 'destination_airport_id')::bigint;
      if v_origin.id is null or v_dest.id is null then
        raise exception 'El leg % tiene un aeropuerto que no existe', v_n using errcode = '22023';
      end if;
      if v_origin.id = v_dest.id then
        raise exception 'El leg % sale y llega al mismo aeropuerto', v_n using errcode = '22023';
      end if;
      insert into public.tour_legs (tour_id, leg_number, origin_airport_id, destination_airport_id, distance_nm, notes)
      values (v_id, v_n, v_origin.id, v_dest.id,
              round(private.great_circle_nm(v_origin.latitude, v_origin.longitude, v_dest.latitude, v_dest.longitude))::integer,
              nullif(trim(v_leg ->> 'notes'), ''));
    end loop;
  end if;
  return v_id;
end;
$$;

-- Enviar: si quien envía administra la aerolínea, se publica directo; si no, espera aprobación.
create function public.submit_tour(p_tour_id uuid)
returns public.tour_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_tour public.tours;
  v_status public.tour_status;
begin
  select * into v_tour from public.tours where id = p_tour_id for update;
  if not found or not private.can_edit_tour(p_tour_id) then
    raise exception '%', private.program_reason_message('tour_not_found') using errcode = 'P0002', hint = 'tour_not_found';
  end if;
  if v_tour.status not in ('draft', 'rejected') then
    raise exception 'El tour ya fue enviado' using errcode = 'P0001', hint = 'not_draft';
  end if;
  if not exists (select 1 from public.tour_legs where tour_id = p_tour_id) then
    raise exception '%', private.program_reason_message('tour_no_legs') using errcode = 'P0001', hint = 'tour_no_legs';
  end if;
  if private.can_manage_airline(v_tour.airline_id) then
    update public.tours set status = 'published', submitted_at = now(), published_at = now(), reviewed_by = v_uid, reviewed_at = now(), review_comment = null
    where id = p_tour_id returning status into v_status;
  else
    update public.tours set status = 'submitted', submitted_at = now(), review_comment = null
    where id = p_tour_id returning status into v_status;
  end if;
  return v_status;
end;
$$;

-- Aprobar o rechazar la publicación de un tour creado por un piloto.
create function public.review_tour(p_tour_id uuid, p_approve boolean, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tour public.tours;
begin
  select * into v_tour from public.tours where id = p_tour_id for update;
  if not found or not private.can_manage_airline(v_tour.airline_id) then
    raise exception 'Solo un administrador de la aerolínea del tour lo aprueba' using errcode = '42501';
  end if;
  if v_tour.status <> 'submitted' then
    raise exception 'El tour no está esperando aprobación' using errcode = 'P0001', hint = 'not_submitted';
  end if;
  if not p_approve and nullif(trim(p_comment), '') is null then
    raise exception 'Escribe el motivo del rechazo' using errcode = '22023', hint = 'comment_required';
  end if;
  update public.tours set
    status = case when p_approve then 'published'::public.tour_status else 'rejected'::public.tour_status end,
    published_at = case when p_approve then now() end,
    reviewed_by = (select auth.uid()), reviewed_at = now(), review_comment = nullif(trim(p_comment), '')
  where id = p_tour_id;
end;
$$;

-- Cerrar: no admite inscripciones ni reservas nuevas; lo ya volado se conserva.
create function public.close_tour(p_tour_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_edit_tour(p_tour_id) then
    raise exception '%', private.program_reason_message('tour_not_found') using errcode = 'P0002', hint = 'tour_not_found';
  end if;
  update public.tours set status = 'closed', closed_at = now() where id = p_tour_id and status = 'published';
  if not found then
    raise exception '%', private.program_reason_message('tour_not_published') using errcode = 'P0001', hint = 'tour_not_published';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- API: inscripciones
-- -----------------------------------------------------------------------------
create function public.enroll_tour(p_tour_id uuid, p_airline_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_tour public.tours;
  v_auto boolean;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  select * into v_tour from public.tours where id = p_tour_id;
  if not found or v_tour.status <> 'published' then
    raise exception '%', private.program_reason_message('tour_not_published') using errcode = 'P0001', hint = 'tour_not_published';
  end if;
  if v_tour.ends_on is not null and v_tour.ends_on < current_date then
    raise exception '%', private.program_reason_message('tour_ended') using errcode = 'P0001', hint = 'tour_ended';
  end if;
  if not private.is_airline_member(p_airline_id) then
    raise exception '%', private.booking_reason_message('not_member') using errcode = '42501', hint = 'not_member';
  end if;
  -- Serializa las inscripciones del piloto.
  perform 1 from public.profiles where id = v_uid for update;
  if private.user_in_event(v_uid) then
    raise exception '%', private.program_reason_message('program_conflict') using errcode = 'P0001', hint = 'program_conflict';
  end if;
  if exists (select 1 from public.tour_enrollments e where e.tour_id = p_tour_id and e.user_id = v_uid and e.status in ('pending', 'approved', 'completed')) then
    raise exception '%', private.program_reason_message('already_enrolled') using errcode = 'P0001', hint = 'already_enrolled';
  end if;
  v_auto := v_tour.created_by = v_uid or (v_tour.auto_approve_same_airline and p_airline_id = v_tour.airline_id);
  insert into public.tour_enrollments (tour_id, user_id, airline_id, status, auto_approved, reviewed_at)
  values (p_tour_id, v_uid, p_airline_id, case when v_auto then 'approved'::public.enrollment_status else 'pending'::public.enrollment_status end,
          v_auto, case when v_auto then now() end)
  returning id into v_id;
  return jsonb_build_object('enrollment_id', v_id, 'status', case when v_auto then 'approved' else 'pending' end);
end;
$$;

create function public.review_tour_enrollment(p_enrollment_id uuid, p_approve boolean, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment public.tour_enrollments;
begin
  select * into v_enrollment from public.tour_enrollments where id = p_enrollment_id for update;
  if not found or not private.can_edit_tour(v_enrollment.tour_id) then
    raise exception '%', private.program_reason_message('enrollment_not_found') using errcode = 'P0002', hint = 'enrollment_not_found';
  end if;
  if v_enrollment.status <> 'pending' then
    raise exception 'La inscripción ya fue revisada' using errcode = 'P0001', hint = 'not_pending';
  end if;
  update public.tour_enrollments set
    status = case when p_approve then 'approved'::public.enrollment_status else 'rejected'::public.enrollment_status end,
    reviewed_by = (select auth.uid()), reviewed_at = now(), review_comment = nullif(trim(p_comment), '')
  where id = p_enrollment_id;
end;
$$;

create function public.withdraw_tour_enrollment(p_enrollment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_enrollment public.tour_enrollments;
begin
  select * into v_enrollment from public.tour_enrollments where id = p_enrollment_id for update;
  if not found or v_enrollment.user_id <> (select auth.uid()) then
    raise exception '%', private.program_reason_message('enrollment_not_found') using errcode = 'P0002', hint = 'enrollment_not_found';
  end if;
  if v_enrollment.status not in ('pending', 'approved') then
    raise exception '%', private.program_reason_message('enrollment_closed') using errcode = 'P0001', hint = 'enrollment_closed';
  end if;
  if exists (select 1 from public.flights f where f.tour_enrollment_id = p_enrollment_id and f.status in ('scheduled', 'in_progress')) then
    raise exception '%', private.program_reason_message('flight_active') using errcode = 'P0001', hint = 'flight_active';
  end if;
  update public.tour_enrollments set status = 'withdrawn', withdrawn_at = now() where id = p_enrollment_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- API: reservar un leg con la flota de la aerolínea de la inscripción
-- -----------------------------------------------------------------------------
create function public.book_tour_leg(p_enrollment_id uuid, p_leg_id uuid, p_aircraft_id uuid, p_callsign text, p_flight_number text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_callsign text := upper(regexp_replace(coalesce(p_callsign, ''), '\s', '', 'g'));
  v_number text := upper(regexp_replace(coalesce(p_flight_number, ''), '\s', '', 'g'));
  v_enrollment public.tour_enrollments;
  v_tour public.tours;
  v_leg public.tour_legs;
  v_airline public.airlines;
  v_state text;
  v_reason text;
  v_unreviewed integer;
  v_type bigint;
  v_registration text;
  v_operation text;
  v_cruise smallint;
  v_max smallint;
  v_hours smallint;
  v_active integer;
  v_expires timestamptz;
  v_booking uuid;
  v_flight uuid;
begin
  if v_uid is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  if v_callsign !~ '^[A-Z0-9]{3,10}$' then
    raise exception 'Callsign inválido: de 3 a 10 letras o números, sin espacios' using errcode = '22023', hint = 'invalid_callsign';
  end if;
  if v_number !~ '^[0-9]{1,4}[A-Z]?$' then
    raise exception '%', private.program_reason_message('invalid_flight_number') using errcode = '22023', hint = 'invalid_flight_number';
  end if;

  -- Serializa las reservas del piloto.
  perform 1 from public.profiles where id = v_uid for update;
  select * into v_enrollment from public.tour_enrollments where id = p_enrollment_id;
  if not found or v_enrollment.user_id <> v_uid then
    raise exception '%', private.program_reason_message('enrollment_not_found') using errcode = 'P0002', hint = 'enrollment_not_found';
  end if;
  if v_enrollment.status <> 'approved' then
    raise exception '%', private.program_reason_message('enrollment_not_approved') using errcode = 'P0001', hint = 'enrollment_not_approved';
  end if;
  select * into v_tour from public.tours where id = v_enrollment.tour_id;
  if v_tour.status <> 'published' then
    raise exception '%', private.program_reason_message('tour_not_published') using errcode = 'P0001', hint = 'tour_not_published';
  end if;
  if v_tour.starts_on is not null and v_tour.starts_on > current_date then
    raise exception '%', private.program_reason_message('tour_not_started') using errcode = 'P0001', hint = 'tour_not_started';
  end if;
  if v_tour.ends_on is not null and v_tour.ends_on < current_date then
    raise exception '%', private.program_reason_message('tour_ended') using errcode = 'P0001', hint = 'tour_ended';
  end if;
  select * into v_leg from public.tour_legs where id = p_leg_id and tour_id = v_tour.id;
  if not found then
    raise exception '%', private.program_reason_message('leg_not_in_tour') using errcode = 'P0002', hint = 'leg_not_in_tour';
  end if;
  select * into v_airline from public.airlines where id = v_enrollment.airline_id;
  if not v_airline.is_active or not private.is_airline_member(v_airline.id) then
    raise exception '%', private.booking_reason_message('not_member') using errcode = '42501', hint = 'not_member';
  end if;

  perform private.expire_bookings();

  -- Estado del tour para este piloto.
  if exists (select 1 from private.tour_leg_states(p_enrollment_id) s where s.state = 'booked') then
    v_reason := 'tour_flight_active';
  else
    select s.state into v_state from private.tour_leg_states(p_enrollment_id) s where s.leg_id = p_leg_id;
    select count(*) into v_unreviewed from private.tour_leg_states(p_enrollment_id) s where s.state = 'in_review';
    if v_state in ('accepted', 'in_review') then
      v_reason := 'leg_done';
    elsif v_tour.ordered_legs and exists (
      select 1 from private.tour_leg_states(p_enrollment_id) s
      where s.leg_number < v_leg.leg_number and s.state not in ('accepted', 'in_review')
    ) then
      v_reason := 'leg_out_of_order';
    elsif not v_tour.allow_unreviewed_progress and v_unreviewed > 0 then
      v_reason := 'previous_unreviewed';
    elsif v_tour.allow_unreviewed_progress and v_unreviewed >= v_tour.max_unreviewed_legs then
      v_reason := 'too_many_unreviewed';
    end if;
  end if;
  if v_reason is not null then
    raise exception '%', private.program_reason_message(v_reason) using errcode = 'P0001', hint = v_reason;
  end if;

  select a.aircraft_type_id, a.registration, a.operation_type into v_type, v_registration, v_operation
  from public.aircraft a where a.id = p_aircraft_id for update;
  v_reason := private.program_aircraft_block_reason(v_uid, v_airline.id, p_aircraft_id, v_tour.aircraft_type_ids, v_leg.origin_airport_id);
  if v_reason is not null then
    raise exception '%', private.program_reason_message(v_reason) using errcode = 'P0001', hint = v_reason;
  end if;

  select s.max_active_bookings, s.booking_expiry_hours into v_max, v_hours
  from public.airline_settings s where s.airline_id = v_airline.id;
  select count(*) into v_active from public.flight_bookings b
  where b.user_id = v_uid and b.airline_id = v_airline.id and b.status = 'active';
  if v_active >= coalesce(v_max, 1) then
    raise exception 'Ya tienes % reserva(s) activa(s) en esta aerolínea; el máximo es %', v_active, coalesce(v_max, 1)
      using errcode = 'P0001', hint = 'max_bookings';
  end if;
  v_expires := now() + make_interval(hours => coalesce(v_hours, 24));
  select t.cruise_speed_kts into v_cruise from public.aircraft_types t where t.id = v_type;

  insert into public.flight_bookings (airline_id, user_id, route_id, aircraft_id, expires_at)
  values (v_airline.id, v_uid, null, p_aircraft_id, v_expires)
  returning id into v_booking;

  insert into public.flights (
    booking_id, airline_id, user_id, route_id, aircraft_id, aircraft_type_id, aircraft_registration,
    airline_icao, flight_number, callsign, origin_airport_id, destination_airport_id,
    planned_distance_nm, planned_minutes, scheduled_departure_at, operation_type, network, flight_plan_remarks,
    tour_leg_id, tour_enrollment_id
  ) values (
    v_booking, v_airline.id, v_uid, null, p_aircraft_id, v_type, v_registration,
    v_airline.icao_code, v_number, v_callsign, v_leg.origin_airport_id, v_leg.destination_airport_id,
    v_leg.distance_nm, least(32000, ceil(v_leg.distance_nm::numeric / coalesce(nullif(v_cruise, 0), 420) * 60) + 25)::smallint,
    now(), coalesce(v_operation, 'passenger'), v_airline.network,
    concat_ws(' ', v_airline.flight_plan_remarks, 'TOUR/' || v_tour.code || ' LEG' || v_leg.leg_number),
    v_leg.id, v_enrollment.id
  )
  returning id into v_flight;

  update public.aircraft set status = 'assigned' where id = p_aircraft_id;
  return jsonb_build_object('booking_id', v_booking, 'flight_id', v_flight, 'expires_at', v_expires);
end;
$$;

-- -----------------------------------------------------------------------------
-- API: lectura
-- -----------------------------------------------------------------------------
create function private.tour_summary(p_tour public.tours)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_tour.id, 'code', p_tour.code, 'name', p_tour.name, 'description', p_tour.description, 'color', p_tour.color,
    'badge_path', p_tour.badge_path, 'status', p_tour.status, 'starts_on', p_tour.starts_on, 'ends_on', p_tour.ends_on,
    'ordered_legs', p_tour.ordered_legs, 'allow_unreviewed_progress', p_tour.allow_unreviewed_progress,
    'max_unreviewed_legs', p_tour.max_unreviewed_legs, 'auto_approve_same_airline', p_tour.auto_approve_same_airline,
    'aircraft_type_ids', to_jsonb(p_tour.aircraft_type_ids),
    'aircraft_types', coalesce((select jsonb_agg(t.icao_code order by t.icao_code) from public.aircraft_types t where t.id = any (p_tour.aircraft_type_ids)), '[]'::jsonb),
    'review_comment', p_tour.review_comment, 'submitted_at', p_tour.submitted_at, 'published_at', p_tour.published_at,
    'airline', (select jsonb_build_object('id', a.id, 'name', a.name, 'icao', a.icao_code, 'slug', a.slug, 'logo_path', a.logo_path, 'color', a.brand_primary_color)
                  from public.airlines a where a.id = p_tour.airline_id),
    'creator', (select jsonb_build_object('id', pr.id, 'name', pr.display_name) from public.profiles pr where pr.id = p_tour.created_by),
    'legs_count', (select count(*) from public.tour_legs l where l.tour_id = p_tour.id),
    'distance_nm', (select coalesce(sum(l.distance_nm), 0) from public.tour_legs l where l.tour_id = p_tour.id),
    'participants', (select count(*) from public.tour_enrollments e where e.tour_id = p_tour.id and e.status in ('approved', 'completed')),
    'finishers', (select count(*) from public.tour_enrollments e where e.tour_id = p_tour.id and e.status = 'completed'),
    'can_edit', private.can_edit_tour(p_tour.id),
    'can_approve', p_tour.status = 'submitted' and private.can_manage_airline(p_tour.airline_id),
    'pending_enrollments', case when private.can_edit_tour(p_tour.id)
      then (select count(*) from public.tour_enrollments e where e.tour_id = p_tour.id and e.status = 'pending') end,
    'my_enrollment', (
      select jsonb_build_object('id', e.id, 'status', e.status, 'airline_id', e.airline_id,
               'legs_accepted', (select count(*) from private.tour_leg_states(e.id) s where s.state = 'accepted'),
               'legs_flown', (select count(*) from private.tour_leg_states(e.id) s where s.state in ('accepted', 'in_review')))
        from public.tour_enrollments e
       where e.tour_id = p_tour.id and e.user_id = (select auth.uid())
       order by (e.status in ('pending', 'approved', 'completed')) desc, e.created_at desc
       limit 1)
  );
$$;
revoke all on function private.tour_summary(public.tours) from public;

create function public.get_tours()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.tour_summary(t) order by (t.status = 'published') desc, t.published_at desc nulls last, t.created_at desc), '[]'::jsonb)
    from public.tours t
   where (select auth.uid()) is not null
     and (private.is_org_admin() or private.can_view_tour(t.id));
$$;

create function public.get_tour(p_tour_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tour public.tours;
  v_edit boolean;
  v_mine uuid;
begin
  select * into v_tour from public.tours where id = p_tour_id;
  if not found or (select auth.uid()) is null or not (private.is_org_admin() or private.can_view_tour(p_tour_id)) then
    raise exception '%', private.program_reason_message('tour_not_found') using errcode = 'P0002', hint = 'tour_not_found';
  end if;
  v_edit := private.can_edit_tour(p_tour_id);
  select e.id into v_mine from public.tour_enrollments e
   where e.tour_id = p_tour_id and e.user_id = (select auth.uid())
   order by (e.status in ('pending', 'approved', 'completed')) desc, e.created_at desc limit 1;

  return private.tour_summary(v_tour) || jsonb_build_object(
    'legs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'leg_number', l.leg_number, 'distance_nm', l.distance_nm, 'notes', l.notes,
        'origin', jsonb_build_object('id', o.id, 'icao', o.icao_code, 'name', o.name, 'city', o.city, 'latitude', o.latitude, 'longitude', o.longitude),
        'destination', jsonb_build_object('id', d.id, 'icao', d.icao_code, 'name', d.name, 'city', d.city, 'latitude', d.latitude, 'longitude', d.longitude)
      ) order by l.leg_number)
        from public.tour_legs l
        join public.airports o on o.id = l.origin_airport_id
        join public.airports d on d.id = l.destination_airport_id
       where l.tour_id = p_tour_id), '[]'::jsonb),
    'my_legs', case when v_mine is not null then coalesce((
      select jsonb_agg(jsonb_build_object('leg_id', s.leg_id, 'leg_number', s.leg_number, 'state', s.state, 'flight_id', s.flight_id,
                                          'pirep_id', s.pirep_id, 'pirep_status', s.pirep_status, 'attempts', s.attempts) order by s.leg_number)
        from private.tour_leg_states(v_mine) s), '[]'::jsonb) end,
    'participants_list', coalesce((
      select jsonb_agg(jsonb_build_object(
        'enrollment_id', e.id, 'user_id', e.user_id, 'name', pr.display_name, 'number', pr.pilot_number,
        'airline_icao', a.icao_code, 'airline_name', a.name, 'status', e.status, 'auto_approved', e.auto_approved,
        'created_at', e.created_at, 'completed_at', e.completed_at,
        'legs_accepted', (select count(*) from private.tour_leg_states(e.id) s where s.state = 'accepted'),
        'legs_flown', (select count(*) from private.tour_leg_states(e.id) s where s.state in ('accepted', 'in_review'))
      ) order by (e.status = 'completed') desc, e.completed_at nulls last, e.created_at)
        from public.tour_enrollments e
        join public.profiles pr on pr.id = e.user_id
        join public.airlines a on a.id = e.airline_id
       where e.tour_id = p_tour_id
         and (e.status in ('approved', 'completed') or (v_edit and e.status = 'pending'))), '[]'::jsonb)
  );
end;
$$;

create function public.get_pilot_badges(p_user_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'tour_id', t.id, 'code', t.code, 'name', t.name, 'color', t.color, 'badge_path', t.badge_path,
           'airline_icao', a.icao_code, 'awarded_at', b.awarded_at,
           'legs', (select count(*) from public.tour_legs l where l.tour_id = t.id)
         ) order by b.awarded_at desc), '[]'::jsonb)
    from public.pilot_badges b
    join public.tours t on t.id = b.tour_id
    join public.airlines a on a.id = t.airline_id
   where (select auth.uid()) is not null
     and b.user_id = coalesce(p_user_id, (select auth.uid()))
     and b.revoked_at is null;
$$;

-- -----------------------------------------------------------------------------
-- Mapa en vivo: el vuelo de un leg de tour trae el tour y el número de leg.
-- -----------------------------------------------------------------------------
create or replace function public.get_live_flights(p_airline_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_airlines uuid[] := private.scope_airlines(p_airline_id, false);
  v_uid uuid := (select auth.uid());
begin
  return coalesce((
    select jsonb_agg(x.j order by x.started_at)
    from (
      select s.started_at, jsonb_build_object(
        'flight_id', f.id,
        'session_id', s.id,
        'airline', jsonb_build_object('id', a.id, 'icao', a.icao_code, 'name', a.name, 'slug', a.slug,
                                      'color', a.brand_primary_color, 'logo_path', a.logo_path),
        'callsign', f.callsign,
        'flight_number', f.flight_number,
        'network', f.network,
        'pilot', jsonb_build_object('id', pr.id, 'name', pr.display_name, 'number', pr.pilot_number),
        'is_mine', f.user_id = v_uid,
        'aircraft_registration', f.aircraft_registration,
        'aircraft_type', t.icao_code,
        'aircraft_model', t.manufacturer || ' ' || t.model,
        'map_category', t.map_category,
        'sim_aircraft_title', s.sim_aircraft_title,
        'origin', jsonb_build_object('icao', o.icao_code, 'name', o.name, 'city', o.city, 'latitude', o.latitude, 'longitude', o.longitude),
        'destination', jsonb_build_object('icao', d.icao_code, 'name', d.name, 'city', d.city, 'latitude', d.latitude, 'longitude', d.longitude),
        'planned_distance_nm', f.planned_distance_nm,
        'planned_minutes', f.planned_minutes,
        'route_nm', round(private.great_circle_nm(o.latitude, o.longitude, d.latitude, d.longitude)::numeric),
        'remaining_nm', case when p.flight_id is not null
          then round(private.great_circle_nm(p.latitude, p.longitude, d.latitude, d.longitude)::numeric) end,
        'started_at', s.started_at,
        'last_contact_at', s.last_contact_at,
        'phase', coalesce(p.phase, s.phase),
        'position', case when p.flight_id is null then null else jsonb_build_object(
          'sampled_at', p.sampled_at, 'latitude', p.latitude, 'longitude', p.longitude,
          'altitude_ft', p.altitude_ft, 'agl_ft', p.agl_ft, 'ias_kt', p.ias_kt, 'gs_kt', p.gs_kt,
          'heading_deg', p.heading_deg, 'vs_fpm', p.vs_fpm, 'on_ground', p.on_ground,
          'wind_dir_deg', p.wind_dir_deg, 'wind_kt', p.wind_kt) end,
        'alerts', case when private.can_staff_airline(f.airline_id) then private.live_flight_alerts(
          s.id, s.last_contact_at, coalesce(p.phase, s.phase),
          case when p.flight_id is not null then private.great_circle_nm(p.latitude, p.longitude, d.latitude, d.longitude) end,
          s.started_at, f.planned_minutes) end,
        'tour', case when tl.id is null then null else jsonb_build_object(
          'id', tr.id, 'code', tr.code, 'name', tr.name, 'color', tr.color, 'leg', tl.leg_number,
          'legs', (select count(*) from public.tour_legs x where x.tour_id = tr.id)) end,
        'event', null
      ) as j
      from public.flight_sessions s
      join public.flights f on f.id = s.flight_id
      join public.airlines a on a.id = f.airline_id
      join public.profiles pr on pr.id = f.user_id
      join public.aircraft_types t on t.id = f.aircraft_type_id
      join public.airports o on o.id = f.origin_airport_id
      join public.airports d on d.id = f.destination_airport_id
      left join public.flight_positions_live p on p.flight_id = f.id
      left join public.tour_legs tl on tl.id = f.tour_leg_id
      left join public.tours tr on tr.id = tl.tour_id
      where s.status = 'active'
        and s.airline_id = any (v_airlines)
        and s.last_contact_at > now() - interval '12 hours'
    ) x
  ), '[]'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- Permisos de las funciones
-- -----------------------------------------------------------------------------
revoke all on function public.save_tour(uuid, jsonb, jsonb) from public, anon;
revoke all on function public.submit_tour(uuid) from public, anon;
revoke all on function public.review_tour(uuid, boolean, text) from public, anon;
revoke all on function public.close_tour(uuid) from public, anon;
revoke all on function public.enroll_tour(uuid, uuid) from public, anon;
revoke all on function public.review_tour_enrollment(uuid, boolean, text) from public, anon;
revoke all on function public.withdraw_tour_enrollment(uuid) from public, anon;
revoke all on function public.book_tour_leg(uuid, uuid, uuid, text, text) from public, anon;
revoke all on function public.get_tours() from public, anon;
revoke all on function public.get_tour(uuid) from public, anon;
revoke all on function public.get_pilot_badges(uuid) from public, anon;
grant execute on function public.save_tour(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.submit_tour(uuid) to authenticated;
grant execute on function public.review_tour(uuid, boolean, text) to authenticated;
grant execute on function public.close_tour(uuid) to authenticated;
grant execute on function public.enroll_tour(uuid, uuid) to authenticated;
grant execute on function public.review_tour_enrollment(uuid, boolean, text) to authenticated;
grant execute on function public.withdraw_tour_enrollment(uuid) to authenticated;
grant execute on function public.book_tour_leg(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.get_tours() to authenticated;
grant execute on function public.get_tour(uuid) to authenticated;
grant execute on function public.get_pilot_badges(uuid) to authenticated;
