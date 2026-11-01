-- Fase 7.4: Eventos.
--
-- Cualquier piloto crea un evento; el administrador de su aerolínea lo aprueba
-- antes de publicarse. Pilotos de cualquier aerolínea (o de las que el evento
-- admita) se registran y el creador aprueba cada registro. Cada piloto vuela con
-- la flota de su aerolínea y una reserva normal; el PIREP le cuenta en su
-- aerolínea. Tres escenarios:
--   same_origin_same_destination  todos salen y llegan a los mismos aeropuertos
--   any_origin_same_destination   salen de donde quieran hacia un mismo destino
--   same_origin_any_destination   salen de un mismo aeropuerto a destinos distintos
-- El ranking sale de los PIREP del evento con el criterio de premio del creador.
-- Un piloto no participa en un evento y en un tour a la vez.

create type public.event_status as enum ('draft', 'submitted', 'published', 'cancelled', 'rejected');
create type public.event_scenario as enum ('same_origin_same_destination', 'any_origin_same_destination', 'same_origin_any_destination');
create sequence public.events_folio_seq;

create table public.events (
  id                     uuid primary key default gen_random_uuid(),
  folio                  text not null unique
                         default ('EVT-' || to_char(now() at time zone 'UTC', 'YYYY') || '-' || lpad(nextval('public.events_folio_seq')::text, 4, '0')),
  airline_id             uuid not null references public.airlines (id) on delete restrict,
  created_by             uuid references public.profiles (id) on delete set null,
  name                   text not null check (char_length(name) between 3 and 80),
  description            text check (char_length(description) <= 4000),
  scenario               public.event_scenario not null,
  origin_airport_id      bigint references public.airports (id) on delete restrict,
  destination_airport_id bigint references public.airports (id) on delete restrict,
  starts_at              timestamptz not null,
  ends_at                timestamptz not null,
  aircraft_type_ids      bigint[] not null default '{}',
  airline_ids            uuid[] not null default '{}',
  color                  text not null default '#f59e0b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  prize_criterion        text not null default 'best_score'
                         check (prize_criterion in ('best_score', 'softest_landing', 'first_arrival', 'longest_distance')),
  prize_description      text check (char_length(prize_description) <= 500),
  prize_places           smallint not null default 3 check (prize_places between 1 and 10),
  status                 public.event_status not null default 'draft',
  submitted_at           timestamptz,
  reviewed_by            uuid references public.profiles (id) on delete set null,
  reviewed_at            timestamptz,
  review_comment         text check (char_length(review_comment) <= 1000),
  published_at           timestamptz,
  cancelled_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint events_window check (ends_at > starts_at and ends_at - starts_at <= interval '31 days'),
  constraint events_scenario_airports check (
    (scenario = 'same_origin_same_destination' and origin_airport_id is not null and destination_airport_id is not null
       and origin_airport_id <> destination_airport_id)
    or (scenario = 'any_origin_same_destination' and origin_airport_id is null and destination_airport_id is not null)
    or (scenario = 'same_origin_any_destination' and origin_airport_id is not null and destination_airport_id is null))
);
comment on table public.events is 'Eventos de varias aerolíneas. Se crean y cambian solo con save_event, submit_event, review_event y cancel_event.';
comment on column public.events.airline_ids is 'Aerolíneas cuyos pilotos pueden registrarse; vacío admite a todas.';
comment on column public.events.prize_criterion is 'Cómo se ordena el ranking: mejor puntaje, toma más suave, primero en llegar o mayor distancia.';
create index events_airline_id_status_idx on public.events (airline_id, status);
create index events_created_by_idx on public.events (created_by);
create index events_reviewed_by_idx on public.events (reviewed_by);
create index events_origin_airport_id_idx on public.events (origin_airport_id);
create index events_destination_airport_id_idx on public.events (destination_airport_id);
create index events_window_idx on public.events (starts_at, ends_at);
create trigger events_set_updated_at before update on public.events
  for each row execute function private.set_updated_at();

create table public.event_registrations (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references public.events (id) on delete cascade,
  user_id             uuid not null references public.profiles (id) on delete cascade,
  airline_id          uuid not null references public.airlines (id) on delete restrict,
  status              public.enrollment_status not null default 'pending' check (status <> 'completed'),
  proposed_airport_id bigint references public.airports (id) on delete set null,
  notes               text check (char_length(notes) <= 500),
  reviewed_by         uuid references public.profiles (id) on delete set null,
  reviewed_at         timestamptz,
  review_comment      text check (char_length(review_comment) <= 1000),
  created_at          timestamptz not null default now(),
  withdrawn_at        timestamptz
);
comment on table public.event_registrations is 'Registros a eventos. airline_id es la aerolínea con cuya flota vuela el piloto; proposed_airport_id es su origen (escenario 2) o destino (escenario 3) propuesto.';
create unique index event_registrations_one_per_pilot on public.event_registrations (event_id, user_id)
  where status in ('pending', 'approved');
create index event_registrations_user_id_idx on public.event_registrations (user_id, status);
create index event_registrations_airline_id_idx on public.event_registrations (airline_id);
create index event_registrations_reviewed_by_idx on public.event_registrations (reviewed_by);
create index event_registrations_proposed_airport_id_idx on public.event_registrations (proposed_airport_id);

alter table public.flights
  add column event_registration_id uuid references public.event_registrations (id) on delete set null;
comment on column public.flights.event_registration_id is 'Registro de evento con el que se vuela este vuelo (lo fija book_event_flight).';
create index flights_event_registration_id_idx on public.flights (event_registration_id);
alter table public.flights add constraint flights_one_program check (event_registration_id is null or tour_leg_id is null);

-- -----------------------------------------------------------------------------
-- Permisos
-- -----------------------------------------------------------------------------
create function private.can_view_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id
      and (e.status in ('published', 'cancelled')
           or e.created_by = (select auth.uid())
           or private.can_staff_airline(e.airline_id))
  );
$$;

create function private.can_edit_event(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id
      and (e.created_by = (select auth.uid()) or private.can_manage_airline(e.airline_id))
  );
$$;
revoke all on function private.can_view_event(uuid) from public;
revoke all on function private.can_edit_event(uuid) from public;
grant execute on function private.can_view_event(uuid) to authenticated, service_role;
grant execute on function private.can_edit_event(uuid) to authenticated, service_role;

alter table public.events enable row level security;
alter table public.event_registrations enable row level security;
create policy events_select on public.events for select to authenticated
  using ((select private.is_org_admin()) or private.can_view_event(id));
create policy event_registrations_select on public.event_registrations for select to authenticated
  using (user_id = (select auth.uid()) or private.can_edit_event(event_id) or private.can_staff_airline(airline_id));
grant select on public.events, public.event_registrations to authenticated;

-- Un piloto con un registro activo en un evento que no ha terminado no entra a un tour, y al revés.
create or replace function private.user_in_event(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.event_registrations r
    join public.events e on e.id = r.event_id
    where r.user_id = p_user_id
      and r.status in ('pending', 'approved')
      and e.status = 'published'
      and e.ends_at > now()
  );
$$;

create or replace function private.program_reason_message(p_reason text)
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
    when 'flight_active' then 'Tienes un vuelo reservado o en curso: cancélalo antes de retirarte'
    when 'invalid_flight_number' then 'Número de vuelo inválido: de 1 a 4 dígitos y, opcional, una letra'
    when 'program_conflict' then 'No puedes participar en un evento y en un tour a la vez: retírate o termina el otro primero'
    when 'event_not_found' then 'El evento no existe o no tienes acceso'
    when 'event_locked' then 'El evento ya está publicado: escenario, aeropuertos, horario, aeronaves y premio ya no cambian'
    when 'event_not_published' then 'El evento no está publicado'
    when 'event_ended' then 'El evento ya terminó'
    when 'event_too_early' then 'Las reservas del evento abren 12 horas antes de su inicio'
    when 'event_airline_not_allowed' then 'Tu aerolínea no participa en este evento'
    when 'already_registered' then 'Ya estás registrado en este evento'
    when 'registration_not_found' then 'El registro no existe'
    when 'registration_not_approved' then 'Tu registro todavía no está aprobado'
    when 'registration_closed' then 'El registro ya no está activo'
    when 'event_flight_active' then 'Ya tienes un vuelo del evento reservado o en curso'
    when 'event_origin_mismatch' then 'El evento sale de otro aeropuerto'
    when 'event_destination_mismatch' then 'El evento llega a otro aeropuerto'
    when 'event_airports_required' then 'Indica el origen y el destino del vuelo; deben ser distintos'
    else private.booking_reason_message(p_reason)
  end;
$$;

-- -----------------------------------------------------------------------------
-- API: crear, editar y publicar
-- p_event: {airline_id, name, description, scenario, origin_airport_id, destination_airport_id,
--           starts_at, ends_at, aircraft_type_ids, airline_ids, color, prize_criterion,
--           prize_description, prize_places}
-- -----------------------------------------------------------------------------
create function public.save_event(p_event_id uuid, p_event jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_event public.events;
  v_id uuid := p_event_id;
  v_airline uuid;
  v_types bigint[];
  v_airlines uuid[];
  v_scenario public.event_scenario := (p_event ->> 'scenario')::public.event_scenario;
  v_origin bigint := (p_event ->> 'origin_airport_id')::bigint;
  v_dest bigint := (p_event ->> 'destination_airport_id')::bigint;
  v_starts timestamptz := (p_event ->> 'starts_at')::timestamptz;
  v_ends timestamptz := (p_event ->> 'ends_at')::timestamptz;
begin
  if v_uid is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  v_types := coalesce((select array_agg(distinct x::bigint order by x::bigint) from jsonb_array_elements_text(coalesce(p_event -> 'aircraft_type_ids', '[]'::jsonb)) x), '{}');
  v_airlines := coalesce((select array_agg(distinct x::uuid order by x::uuid) from jsonb_array_elements_text(coalesce(p_event -> 'airline_ids', '[]'::jsonb)) x), '{}');
  if exists (select 1 from unnest(v_types) t where not exists (select 1 from public.aircraft_types a where a.id = t)) then
    raise exception 'Hay un tipo de aeronave que no existe' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_airlines) t where not exists (select 1 from public.airlines a where a.id = t)) then
    raise exception 'Hay una aerolínea que no existe' using errcode = '22023';
  end if;
  -- Cada escenario usa solo los aeropuertos que le corresponden.
  if v_scenario = 'any_origin_same_destination' then v_origin := null; end if;
  if v_scenario = 'same_origin_any_destination' then v_dest := null; end if;

  if v_id is null then
    v_airline := (p_event ->> 'airline_id')::uuid;
    if v_airline is null or not (private.is_airline_member(v_airline) or private.is_org_admin()) then
      raise exception 'Solo los miembros de la aerolínea crean eventos en ella' using errcode = '42501';
    end if;
    if v_ends <= now() then
      raise exception '%', private.program_reason_message('event_ended') using errcode = '22023', hint = 'event_ended';
    end if;
    insert into public.events (airline_id, created_by, name, description, scenario, origin_airport_id, destination_airport_id, starts_at, ends_at,
                               aircraft_type_ids, airline_ids, color, prize_criterion, prize_description, prize_places)
    values (v_airline, v_uid, trim(p_event ->> 'name'), nullif(trim(p_event ->> 'description'), ''), v_scenario, v_origin, v_dest, v_starts, v_ends,
            v_types, v_airlines, coalesce(p_event ->> 'color', '#f59e0b'), coalesce(p_event ->> 'prize_criterion', 'best_score'),
            nullif(trim(p_event ->> 'prize_description'), ''), coalesce((p_event ->> 'prize_places')::smallint, 3))
    returning id into v_id;
  else
    select * into v_event from public.events where id = v_id for update;
    if not found or not private.can_edit_event(v_id) then
      raise exception '%', private.program_reason_message('event_not_found') using errcode = 'P0002', hint = 'event_not_found';
    end if;
    if v_event.status = 'cancelled' then
      raise exception 'El evento está cancelado' using errcode = 'P0001', hint = 'event_cancelled';
    end if;
    if v_event.status = 'published' and (
         v_scenario is distinct from v_event.scenario or v_origin is distinct from v_event.origin_airport_id
         or v_dest is distinct from v_event.destination_airport_id or v_starts is distinct from v_event.starts_at
         or v_ends is distinct from v_event.ends_at or v_types is distinct from v_event.aircraft_type_ids
         or v_airlines is distinct from v_event.airline_ids
         or coalesce(p_event ->> 'prize_criterion', 'best_score') is distinct from v_event.prize_criterion
         or coalesce((p_event ->> 'prize_places')::smallint, 3) is distinct from v_event.prize_places) then
      raise exception '%', private.program_reason_message('event_locked') using errcode = 'P0001', hint = 'event_locked';
    end if;
    update public.events set
      name = trim(p_event ->> 'name'),
      description = nullif(trim(p_event ->> 'description'), ''),
      scenario = v_scenario, origin_airport_id = v_origin, destination_airport_id = v_dest,
      starts_at = v_starts, ends_at = v_ends, aircraft_type_ids = v_types, airline_ids = v_airlines,
      color = coalesce(p_event ->> 'color', color),
      prize_criterion = coalesce(p_event ->> 'prize_criterion', 'best_score'),
      prize_description = nullif(trim(p_event ->> 'prize_description'), ''),
      prize_places = coalesce((p_event ->> 'prize_places')::smallint, 3)
    where id = v_id;
  end if;
  return v_id;
end;
$$;

create function public.submit_event(p_event_id uuid)
returns public.event_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_event public.events;
  v_status public.event_status;
begin
  select * into v_event from public.events where id = p_event_id for update;
  if not found or not private.can_edit_event(p_event_id) then
    raise exception '%', private.program_reason_message('event_not_found') using errcode = 'P0002', hint = 'event_not_found';
  end if;
  if v_event.status not in ('draft', 'rejected') then
    raise exception 'El evento ya fue enviado' using errcode = 'P0001', hint = 'not_draft';
  end if;
  if v_event.ends_at <= now() then
    raise exception '%', private.program_reason_message('event_ended') using errcode = 'P0001', hint = 'event_ended';
  end if;
  if private.can_manage_airline(v_event.airline_id) then
    update public.events set status = 'published', submitted_at = now(), published_at = now(), reviewed_by = v_uid, reviewed_at = now(), review_comment = null
    where id = p_event_id returning status into v_status;
  else
    update public.events set status = 'submitted', submitted_at = now(), review_comment = null
    where id = p_event_id returning status into v_status;
  end if;
  return v_status;
end;
$$;

create function public.review_event(p_event_id uuid, p_approve boolean, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
begin
  select * into v_event from public.events where id = p_event_id for update;
  if not found or not private.can_manage_airline(v_event.airline_id) then
    raise exception 'Solo un administrador de la aerolínea del evento lo aprueba' using errcode = '42501';
  end if;
  if v_event.status <> 'submitted' then
    raise exception 'El evento no está esperando aprobación' using errcode = 'P0001', hint = 'not_submitted';
  end if;
  if not p_approve and nullif(trim(p_comment), '') is null then
    raise exception 'Escribe el motivo del rechazo' using errcode = '22023', hint = 'comment_required';
  end if;
  update public.events set
    status = case when p_approve then 'published'::public.event_status else 'rejected'::public.event_status end,
    published_at = case when p_approve then now() end,
    reviewed_by = (select auth.uid()), reviewed_at = now(), review_comment = nullif(trim(p_comment), '')
  where id = p_event_id;
end;
$$;

create function public.cancel_event(p_event_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_edit_event(p_event_id) then
    raise exception '%', private.program_reason_message('event_not_found') using errcode = 'P0002', hint = 'event_not_found';
  end if;
  update public.events set status = 'cancelled', cancelled_at = now(), review_comment = coalesce(nullif(trim(p_reason), ''), review_comment)
   where id = p_event_id and status <> 'cancelled';
end;
$$;

-- -----------------------------------------------------------------------------
-- API: registros
-- -----------------------------------------------------------------------------
create function public.register_event(p_event_id uuid, p_airline_id uuid, p_proposed_airport_id bigint default null, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_event public.events;
  v_auto boolean;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  select * into v_event from public.events where id = p_event_id;
  if not found or v_event.status <> 'published' then
    raise exception '%', private.program_reason_message('event_not_published') using errcode = 'P0001', hint = 'event_not_published';
  end if;
  if v_event.ends_at <= now() then
    raise exception '%', private.program_reason_message('event_ended') using errcode = 'P0001', hint = 'event_ended';
  end if;
  if not private.is_airline_member(p_airline_id) then
    raise exception '%', private.booking_reason_message('not_member') using errcode = '42501', hint = 'not_member';
  end if;
  if cardinality(v_event.airline_ids) > 0 and not (p_airline_id = any (v_event.airline_ids)) then
    raise exception '%', private.program_reason_message('event_airline_not_allowed') using errcode = 'P0001', hint = 'event_airline_not_allowed';
  end if;
  perform 1 from public.profiles where id = v_uid for update;
  if private.user_in_tour(v_uid) then
    raise exception '%', private.program_reason_message('program_conflict') using errcode = 'P0001', hint = 'program_conflict';
  end if;
  if exists (select 1 from public.event_registrations r where r.event_id = p_event_id and r.user_id = v_uid and r.status in ('pending', 'approved')) then
    raise exception '%', private.program_reason_message('already_registered') using errcode = 'P0001', hint = 'already_registered';
  end if;
  v_auto := v_event.created_by = v_uid;
  insert into public.event_registrations (event_id, user_id, airline_id, status, proposed_airport_id, notes, reviewed_at)
  values (p_event_id, v_uid, p_airline_id, case when v_auto then 'approved'::public.enrollment_status else 'pending'::public.enrollment_status end,
          case when v_event.scenario = 'same_origin_same_destination' then null else p_proposed_airport_id end,
          nullif(trim(p_notes), ''), case when v_auto then now() end)
  returning id into v_id;
  return jsonb_build_object('registration_id', v_id, 'status', case when v_auto then 'approved' else 'pending' end);
end;
$$;

create function public.review_event_registration(p_registration_id uuid, p_approve boolean, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reg public.event_registrations;
begin
  select * into v_reg from public.event_registrations where id = p_registration_id for update;
  if not found or not private.can_edit_event(v_reg.event_id) then
    raise exception '%', private.program_reason_message('registration_not_found') using errcode = 'P0002', hint = 'registration_not_found';
  end if;
  if v_reg.status <> 'pending' then
    raise exception 'El registro ya fue revisado' using errcode = 'P0001', hint = 'not_pending';
  end if;
  update public.event_registrations set
    status = case when p_approve then 'approved'::public.enrollment_status else 'rejected'::public.enrollment_status end,
    reviewed_by = (select auth.uid()), reviewed_at = now(), review_comment = nullif(trim(p_comment), '')
  where id = p_registration_id;
end;
$$;

create function public.withdraw_event_registration(p_registration_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reg public.event_registrations;
begin
  select * into v_reg from public.event_registrations where id = p_registration_id for update;
  if not found or v_reg.user_id <> (select auth.uid()) then
    raise exception '%', private.program_reason_message('registration_not_found') using errcode = 'P0002', hint = 'registration_not_found';
  end if;
  if v_reg.status not in ('pending', 'approved') then
    raise exception '%', private.program_reason_message('registration_closed') using errcode = 'P0001', hint = 'registration_closed';
  end if;
  if exists (select 1 from public.flights f where f.event_registration_id = p_registration_id and f.status in ('scheduled', 'in_progress')) then
    raise exception '%', private.program_reason_message('flight_active') using errcode = 'P0001', hint = 'flight_active';
  end if;
  update public.event_registrations set status = 'withdrawn', withdrawn_at = now() where id = p_registration_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- API: reservar el vuelo del evento con la flota de la aerolínea del registro
-- -----------------------------------------------------------------------------
create function public.book_event_flight(p_registration_id uuid, p_aircraft_id uuid, p_callsign text, p_flight_number text,
                                         p_origin_airport_id bigint default null, p_destination_airport_id bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_callsign text := upper(regexp_replace(coalesce(p_callsign, ''), '\s', '', 'g'));
  v_number text := upper(regexp_replace(coalesce(p_flight_number, ''), '\s', '', 'g'));
  v_reg public.event_registrations;
  v_event public.events;
  v_airline public.airlines;
  v_origin public.airports;
  v_dest public.airports;
  v_reason text;
  v_type bigint;
  v_registration text;
  v_operation text;
  v_cruise smallint;
  v_max smallint;
  v_hours smallint;
  v_active integer;
  v_expires timestamptz;
  v_distance integer;
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
  perform 1 from public.profiles where id = v_uid for update;
  select * into v_reg from public.event_registrations where id = p_registration_id;
  if not found or v_reg.user_id <> v_uid then
    raise exception '%', private.program_reason_message('registration_not_found') using errcode = 'P0002', hint = 'registration_not_found';
  end if;
  if v_reg.status <> 'approved' then
    raise exception '%', private.program_reason_message('registration_not_approved') using errcode = 'P0001', hint = 'registration_not_approved';
  end if;
  select * into v_event from public.events where id = v_reg.event_id;
  if v_event.status <> 'published' then
    raise exception '%', private.program_reason_message('event_not_published') using errcode = 'P0001', hint = 'event_not_published';
  end if;
  if v_event.ends_at <= now() then
    raise exception '%', private.program_reason_message('event_ended') using errcode = 'P0001', hint = 'event_ended';
  end if;
  if v_event.starts_at - interval '12 hours' > now() then
    raise exception '%', private.program_reason_message('event_too_early') using errcode = 'P0001', hint = 'event_too_early';
  end if;
  if v_event.origin_airport_id is not null and p_origin_airport_id is not null and p_origin_airport_id <> v_event.origin_airport_id then
    raise exception '%', private.program_reason_message('event_origin_mismatch') using errcode = 'P0001', hint = 'event_origin_mismatch';
  end if;
  if v_event.destination_airport_id is not null and p_destination_airport_id is not null and p_destination_airport_id <> v_event.destination_airport_id then
    raise exception '%', private.program_reason_message('event_destination_mismatch') using errcode = 'P0001', hint = 'event_destination_mismatch';
  end if;
  select * into v_origin from public.airports where id = coalesce(v_event.origin_airport_id, p_origin_airport_id);
  select * into v_dest from public.airports where id = coalesce(v_event.destination_airport_id, p_destination_airport_id);
  if v_origin.id is null or v_dest.id is null or v_origin.id = v_dest.id then
    raise exception '%', private.program_reason_message('event_airports_required') using errcode = '22023', hint = 'event_airports_required';
  end if;
  select * into v_airline from public.airlines where id = v_reg.airline_id;
  if not v_airline.is_active or not private.is_airline_member(v_airline.id) then
    raise exception '%', private.booking_reason_message('not_member') using errcode = '42501', hint = 'not_member';
  end if;

  perform private.expire_bookings();
  if exists (select 1 from public.flights f where f.event_registration_id = p_registration_id and f.status in ('scheduled', 'in_progress')) then
    raise exception '%', private.program_reason_message('event_flight_active') using errcode = 'P0001', hint = 'event_flight_active';
  end if;

  select a.aircraft_type_id, a.registration, a.operation_type into v_type, v_registration, v_operation
  from public.aircraft a where a.id = p_aircraft_id for update;
  v_reason := private.program_aircraft_block_reason(v_uid, v_airline.id, p_aircraft_id, v_event.aircraft_type_ids, v_origin.id);
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
  v_expires := least(now() + make_interval(hours => coalesce(v_hours, 24)), v_event.ends_at);
  v_distance := round(private.great_circle_nm(v_origin.latitude, v_origin.longitude, v_dest.latitude, v_dest.longitude))::integer;
  select t.cruise_speed_kts into v_cruise from public.aircraft_types t where t.id = v_type;

  insert into public.flight_bookings (airline_id, user_id, route_id, aircraft_id, expires_at)
  values (v_airline.id, v_uid, null, p_aircraft_id, v_expires)
  returning id into v_booking;

  insert into public.flights (
    booking_id, airline_id, user_id, route_id, aircraft_id, aircraft_type_id, aircraft_registration,
    airline_icao, flight_number, callsign, origin_airport_id, destination_airport_id,
    planned_distance_nm, planned_minutes, scheduled_departure_at, operation_type, network, flight_plan_remarks,
    event_registration_id
  ) values (
    v_booking, v_airline.id, v_uid, null, p_aircraft_id, v_type, v_registration,
    v_airline.icao_code, v_number, v_callsign, v_origin.id, v_dest.id,
    v_distance, least(32000, ceil(v_distance::numeric / coalesce(nullif(v_cruise, 0), 420) * 60) + 25)::smallint,
    greatest(now(), v_event.starts_at), coalesce(v_operation, 'passenger'), v_airline.network,
    concat_ws(' ', v_airline.flight_plan_remarks, 'EVENT/' || v_event.folio),
    p_registration_id
  )
  returning id into v_flight;

  update public.aircraft set status = 'assigned' where id = p_aircraft_id;
  return jsonb_build_object('booking_id', v_booking, 'flight_id', v_flight, 'expires_at', v_expires);
end;
$$;

-- -----------------------------------------------------------------------------
-- Ranking: el mejor PIREP de cada piloto según el criterio del premio. Cuentan
-- los PIREP aceptados y en revisión de vuelos que empezaron dentro del evento
-- (desde 2 horas antes del inicio, para el embarque, hasta el fin).
-- -----------------------------------------------------------------------------
create function private.event_ranking(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with e as (select * from public.events where id = p_event_id),
  entries as (
    select r.user_id, pr.display_name as name, pr.pilot_number as number, a.icao_code as airline_icao,
           p.id as pirep_id, p.status::text as pirep_status, p.callsign, t.icao_code as aircraft_type,
           o.icao_code as origin, d.icao_code as destination, p.score, p.landing_vs_fpm, p.block_on_at, p.distance_nm, p.block_minutes,
           case e.prize_criterion
             when 'best_score' then p.score::numeric
             when 'softest_landing' then p.landing_vs_fpm::numeric
             when 'first_arrival' then -extract(epoch from p.block_on_at)::numeric
             when 'longest_distance' then p.distance_nm::numeric
           end as sort_value
      from e
      join public.event_registrations r on r.event_id = e.id and r.status = 'approved'
      join public.flights f on f.event_registration_id = r.id
      join public.pireps p on p.flight_id = f.id and p.status in ('accepted', 'pending')
      join public.profiles pr on pr.id = r.user_id
      join public.airlines a on a.id = r.airline_id
      join public.aircraft_types t on t.id = p.aircraft_type_id
      join public.airports o on o.id = p.origin_airport_id
      join public.airports d on d.id = coalesce(p.arrival_airport_id, p.destination_airport_id)
     where f.started_at >= e.starts_at - interval '2 hours' and f.started_at <= e.ends_at
  ),
  best as (
    select distinct on (user_id) *
      from entries
     where sort_value is not null
     order by user_id, sort_value desc, (pirep_status = 'accepted') desc, block_minutes
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'position', x.position, 'user_id', x.user_id, 'name', x.name, 'number', x.number, 'airline_icao', x.airline_icao,
           'pirep_id', x.pirep_id, 'pirep_status', x.pirep_status, 'callsign', x.callsign, 'aircraft_type', x.aircraft_type,
           'origin', x.origin, 'destination', x.destination, 'score', x.score, 'landing_vs_fpm', x.landing_vs_fpm,
           'block_on_at', x.block_on_at, 'distance_nm', x.distance_nm, 'block_minutes', x.block_minutes
         ) order by x.position), '[]'::jsonb)
    from (select b.*, row_number() over (order by b.sort_value desc, (b.pirep_status = 'accepted') desc, b.block_minutes) as position from best b) x;
$$;
revoke all on function private.event_ranking(uuid) from public;

create function private.event_summary(p_event public.events)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_event.id, 'folio', p_event.folio, 'name', p_event.name, 'description', p_event.description,
    'scenario', p_event.scenario, 'starts_at', p_event.starts_at, 'ends_at', p_event.ends_at, 'color', p_event.color,
    'status', p_event.status, 'prize_criterion', p_event.prize_criterion, 'prize_description', p_event.prize_description,
    'prize_places', p_event.prize_places, 'review_comment', p_event.review_comment, 'published_at', p_event.published_at,
    'aircraft_type_ids', to_jsonb(p_event.aircraft_type_ids),
    'aircraft_types', coalesce((select jsonb_agg(t.icao_code order by t.icao_code) from public.aircraft_types t where t.id = any (p_event.aircraft_type_ids)), '[]'::jsonb),
    'airline_ids', to_jsonb(p_event.airline_ids),
    'airlines', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'icao', a.icao_code, 'name', a.name) order by a.name)
                            from public.airlines a where a.id = any (p_event.airline_ids)), '[]'::jsonb),
    'origin', (select jsonb_build_object('id', o.id, 'icao', o.icao_code, 'name', o.name, 'city', o.city, 'latitude', o.latitude, 'longitude', o.longitude)
                 from public.airports o where o.id = p_event.origin_airport_id),
    'destination', (select jsonb_build_object('id', d.id, 'icao', d.icao_code, 'name', d.name, 'city', d.city, 'latitude', d.latitude, 'longitude', d.longitude)
                      from public.airports d where d.id = p_event.destination_airport_id),
    'airline', (select jsonb_build_object('id', a.id, 'name', a.name, 'icao', a.icao_code, 'slug', a.slug, 'logo_path', a.logo_path, 'color', a.brand_primary_color)
                  from public.airlines a where a.id = p_event.airline_id),
    'creator', (select jsonb_build_object('id', pr.id, 'name', pr.display_name) from public.profiles pr where pr.id = p_event.created_by),
    'participants', (select count(*) from public.event_registrations r where r.event_id = p_event.id and r.status = 'approved'),
    'can_edit', private.can_edit_event(p_event.id),
    'can_approve', p_event.status = 'submitted' and private.can_manage_airline(p_event.airline_id),
    'pending_registrations', case when private.can_edit_event(p_event.id)
      then (select count(*) from public.event_registrations r where r.event_id = p_event.id and r.status = 'pending') end,
    'my_registration', (
      select jsonb_build_object('id', r.id, 'status', r.status, 'airline_id', r.airline_id, 'proposed_airport_id', r.proposed_airport_id,
               'review_comment', r.review_comment,
               'active_flight_id', (select f.id from public.flights f where f.event_registration_id = r.id and f.status in ('scheduled', 'in_progress') limit 1),
               'flights', (select count(*) from public.flights f where f.event_registration_id = r.id and f.status <> 'cancelled'))
        from public.event_registrations r
       where r.event_id = p_event.id and r.user_id = (select auth.uid())
       order by (r.status in ('pending', 'approved')) desc, r.created_at desc
       limit 1)
  );
$$;
revoke all on function private.event_summary(public.events) from public;

create function public.get_events()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.event_summary(e) order by (e.ends_at < now()), e.starts_at), '[]'::jsonb)
    from public.events e
   where (select auth.uid()) is not null
     and (private.is_org_admin() or private.can_view_event(e.id));
$$;

create function public.get_event(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_edit boolean;
begin
  select * into v_event from public.events where id = p_event_id;
  if not found or (select auth.uid()) is null or not (private.is_org_admin() or private.can_view_event(p_event_id)) then
    raise exception '%', private.program_reason_message('event_not_found') using errcode = 'P0002', hint = 'event_not_found';
  end if;
  v_edit := private.can_edit_event(p_event_id);
  return private.event_summary(v_event) || jsonb_build_object(
    'ranking', private.event_ranking(p_event_id),
    'registrations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'registration_id', r.id, 'user_id', r.user_id, 'name', pr.display_name, 'number', pr.pilot_number,
        'airline_icao', a.icao_code, 'airline_name', a.name, 'status', r.status, 'notes', r.notes,
        'proposed_airport', (select ap.icao_code from public.airports ap where ap.id = r.proposed_airport_id),
        'created_at', r.created_at,
        'flights', (select count(*) from public.flights f where f.event_registration_id = r.id and f.status <> 'cancelled')
      ) order by (r.status = 'pending') desc, r.created_at)
        from public.event_registrations r
        join public.profiles pr on pr.id = r.user_id
        join public.airlines a on a.id = r.airline_id
       where r.event_id = p_event_id
         and (r.status = 'approved' or (v_edit and r.status = 'pending'))), '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Mapa en vivo: el vuelo de un evento trae folio, nombre, color y horario.
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
        'event', case when ev.id is null then null else jsonb_build_object(
          'id', ev.id, 'folio', ev.folio, 'name', ev.name, 'color', ev.color, 'starts_at', ev.starts_at, 'ends_at', ev.ends_at) end
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
      left join public.event_registrations er on er.id = f.event_registration_id
      left join public.events ev on ev.id = er.event_id
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
revoke all on function public.save_event(uuid, jsonb) from public, anon;
revoke all on function public.submit_event(uuid) from public, anon;
revoke all on function public.review_event(uuid, boolean, text) from public, anon;
revoke all on function public.cancel_event(uuid, text) from public, anon;
revoke all on function public.register_event(uuid, uuid, bigint, text) from public, anon;
revoke all on function public.review_event_registration(uuid, boolean, text) from public, anon;
revoke all on function public.withdraw_event_registration(uuid) from public, anon;
revoke all on function public.book_event_flight(uuid, uuid, text, text, bigint, bigint) from public, anon;
revoke all on function public.get_events() from public, anon;
revoke all on function public.get_event(uuid) from public, anon;
grant execute on function public.save_event(uuid, jsonb) to authenticated;
grant execute on function public.submit_event(uuid) to authenticated;
grant execute on function public.review_event(uuid, boolean, text) to authenticated;
grant execute on function public.cancel_event(uuid, text) to authenticated;
grant execute on function public.register_event(uuid, uuid, bigint, text) to authenticated;
grant execute on function public.review_event_registration(uuid, boolean, text) to authenticated;
grant execute on function public.withdraw_event_registration(uuid) to authenticated;
grant execute on function public.book_event_flight(uuid, uuid, text, text, bigint, bigint) to authenticated;
grant execute on function public.get_events() to authenticated;
grant execute on function public.get_event(uuid) to authenticated;
