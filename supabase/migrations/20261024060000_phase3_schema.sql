-- =============================================================================
-- LAM Virtual ACARS — Fase 3 (1/4): habilitaciones, reservas, vuelos y SimBrief
-- =============================================================================

create type public.booking_status as enum ('active', 'completed', 'cancelled', 'expired');
create type public.flight_status as enum ('scheduled', 'in_progress', 'completed', 'cancelled');

alter table public.airline_settings
  add column require_type_rating boolean not null default true;
comment on column public.airline_settings.require_type_rating is
  'Si está activo, el piloto solo reserva tipos de aeronave para los que tiene habilitación en la aerolínea.';

-- -----------------------------------------------------------------------------
-- Habilitaciones por tipo (por aerolínea)
-- -----------------------------------------------------------------------------
create table public.pilot_type_ratings (
  airline_id        uuid not null references public.airlines (id) on delete cascade,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  aircraft_type_id  bigint not null references public.aircraft_types (id) on delete restrict,
  granted_at        timestamptz not null default now(),
  granted_by        uuid references public.profiles (id) on delete set null,
  notes             text check (char_length(notes) <= 300),
  primary key (airline_id, user_id, aircraft_type_id)
);
comment on table public.pilot_type_ratings is 'Tipos de aeronave que cada piloto puede volar en cada aerolínea. Las otorga el staff de la aerolínea.';
create index pilot_type_ratings_user_id_idx on public.pilot_type_ratings (user_id);
create index pilot_type_ratings_aircraft_type_id_idx on public.pilot_type_ratings (aircraft_type_id);
create index pilot_type_ratings_granted_by_idx on public.pilot_type_ratings (granted_by);

-- ¿p_user tiene membresía activa en p_airline? (Lectura sin RLS.)
create function private.user_is_active_member(p_airline_id uuid, p_user_id uuid)
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
      and m.user_id = p_user_id
      and m.status = 'active'
      and p.account_status = 'active'
  );
$$;

create function private.guard_rating_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.granted_at := now();
  new.granted_by := (select auth.uid());
  if not private.user_is_active_member(new.airline_id, new.user_id) then
    raise exception 'Solo se habilitan pilotos con membresía activa en la aerolínea' using errcode = '23514';
  end if;
  if current_user = 'authenticated'
     and new.user_id = (select auth.uid())
     and not private.is_org_admin() then
    raise exception 'No puedes otorgarte habilitaciones a ti mismo' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger pilot_type_ratings_guard_write before insert on public.pilot_type_ratings
  for each row execute function private.guard_rating_write();
create trigger pilot_type_ratings_audit after insert or delete on public.pilot_type_ratings
  for each row execute function private.audit_row('airline_id', 'user_id');

-- -----------------------------------------------------------------------------
-- Reservas: un piloto aparta una aeronave para una ruta hasta que vence
-- -----------------------------------------------------------------------------
create table public.flight_bookings (
  id           uuid primary key default gen_random_uuid(),
  airline_id   uuid not null references public.airlines (id) on delete restrict,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  route_id     uuid references public.routes (id) on delete set null,
  aircraft_id  uuid references public.aircraft (id) on delete set null,
  status       public.booking_status not null default 'active',
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  closed_at    timestamptz,
  closed_by    uuid references public.profiles (id) on delete set null,
  constraint flight_bookings_closed_consistent check ((status = 'active') = (closed_at is null))
);
comment on table public.flight_bookings is 'Reservas de vuelo. Se crean y cierran solo con book_flight, cancel_booking y el vencimiento automático.';

-- Una sola reserva activa por aeronave.
create unique index flight_bookings_one_active_per_aircraft
  on public.flight_bookings (aircraft_id) where status = 'active';
create index flight_bookings_user_id_status_idx on public.flight_bookings (user_id, status);
create index flight_bookings_airline_id_status_idx on public.flight_bookings (airline_id, status, created_at desc);
create index flight_bookings_active_expires_at_idx on public.flight_bookings (expires_at) where status = 'active';
create index flight_bookings_route_id_idx on public.flight_bookings (route_id);
create index flight_bookings_closed_by_idx on public.flight_bookings (closed_by);

-- -----------------------------------------------------------------------------
-- Vuelos: cada operación copia los datos de la ruta y la aeronave
-- -----------------------------------------------------------------------------
create table public.flights (
  id                      uuid primary key default gen_random_uuid(),
  booking_id              uuid unique references public.flight_bookings (id) on delete cascade,
  airline_id              uuid not null references public.airlines (id) on delete restrict,
  user_id                 uuid not null references public.profiles (id) on delete cascade,
  route_id                uuid references public.routes (id) on delete set null,
  aircraft_id             uuid references public.aircraft (id) on delete set null,
  aircraft_type_id        bigint not null references public.aircraft_types (id) on delete restrict,
  aircraft_registration   text not null,
  airline_icao            text not null check (airline_icao ~ '^[A-Z]{3}$'),
  flight_number           text not null check (flight_number ~ '^[0-9]{1,4}[A-Z]?$'),
  callsign                text not null check (callsign ~ '^[A-Z0-9]{3,10}$'),
  origin_airport_id       bigint not null references public.airports (id) on delete restrict,
  destination_airport_id  bigint not null references public.airports (id) on delete restrict,
  planned_distance_nm     integer not null check (planned_distance_nm >= 0),
  planned_minutes         smallint not null check (planned_minutes > 0),
  scheduled_departure_at  timestamptz,
  operation_type          text not null check (operation_type in ('passenger', 'cargo', 'mixed')),
  network                 text not null check (network in ('IVAO', 'VATSIM', 'OFFLINE')),
  flight_plan_remarks     text,
  status                  public.flight_status not null default 'scheduled',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  started_at              timestamptz,
  completed_at            timestamptz,
  cancelled_at            timestamptz
);
comment on table public.flights is 'Operaciones de vuelo. Guardan una copia de la ruta para que el historial no cambie si la ruta cambia.';
comment on column public.flights.callsign is 'Callsign elegido por el piloto para este vuelo.';
create index flights_user_id_created_at_idx on public.flights (user_id, created_at desc);
create index flights_airline_id_status_idx on public.flights (airline_id, status, created_at desc);
create index flights_route_id_idx on public.flights (route_id);
create index flights_aircraft_id_idx on public.flights (aircraft_id);
create index flights_aircraft_type_id_idx on public.flights (aircraft_type_id);
create index flights_origin_airport_id_idx on public.flights (origin_airport_id);
create index flights_destination_airport_id_idx on public.flights (destination_airport_id);

create trigger flights_set_updated_at before update on public.flights
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Plan de vuelo de SimBrief (el último importado por vuelo)
-- -----------------------------------------------------------------------------
create table public.simbrief_ofps (
  flight_id            uuid primary key references public.flights (id) on delete cascade,
  airline_id           uuid not null references public.airlines (id) on delete cascade,
  user_id              uuid not null references public.profiles (id) on delete cascade,
  request_id           text not null check (char_length(request_id) between 1 and 64),
  static_id            text check (char_length(static_id) <= 64),
  generated_at         timestamptz,
  airline_icao         text check (char_length(airline_icao) <= 4),
  flight_number        text check (char_length(flight_number) <= 10),
  atc_callsign         text check (char_length(atc_callsign) <= 12),
  origin_icao          text not null check (origin_icao ~ '^[A-Z0-9]{3,4}$'),
  destination_icao     text not null check (destination_icao ~ '^[A-Z0-9]{3,4}$'),
  alternate_icao       text check (alternate_icao ~ '^[A-Z0-9]{3,4}$'),
  aircraft_icao        text check (char_length(aircraft_icao) <= 4),
  registration         text check (char_length(registration) <= 12),
  route                text check (char_length(route) <= 4000),
  cruise_altitude_ft   integer check (cruise_altitude_ft between 0 and 70000),
  air_distance_nm      integer check (air_distance_nm >= 0),
  est_enroute_minutes  integer check (est_enroute_minutes >= 0),
  est_block_minutes    integer check (est_block_minutes >= 0),
  fuel_units           text check (fuel_units in ('kg', 'lb')),
  block_fuel           numeric(10, 1) check (block_fuel >= 0),
  trip_fuel            numeric(10, 1) check (trip_fuel >= 0),
  reserve_fuel         numeric(10, 1) check (reserve_fuel >= 0),
  zfw                  numeric(10, 1) check (zfw >= 0),
  tow                  numeric(10, 1) check (tow >= 0),
  ldw                  numeric(10, 1) check (ldw >= 0),
  pax_count            integer check (pax_count >= 0),
  cargo                numeric(10, 1) check (cargo >= 0),
  pdf_url              text check (pdf_url ~ '^https://'),
  mismatches           jsonb not null default '[]'::jsonb check (jsonb_typeof(mismatches) = 'array'),
  fetched_at           timestamptz not null default now()
);
comment on table public.simbrief_ofps is 'Último OFP de SimBrief importado para cada vuelo, con las diferencias detectadas contra la reserva.';
comment on column public.simbrief_ofps.mismatches is 'Calculado por el servidor: [{field, expected, actual, severity}].';
create index simbrief_ofps_airline_id_idx on public.simbrief_ofps (airline_id);
create index simbrief_ofps_user_id_idx on public.simbrief_ofps (user_id);

alter table public.pilot_type_ratings enable row level security;
alter table public.flight_bookings    enable row level security;
alter table public.flights            enable row level security;
alter table public.simbrief_ofps      enable row level security;

-- -----------------------------------------------------------------------------
-- Aeronaves: solo el sistema mueve una aeronave a o desde Asignada / En vuelo.
-- Las funciones del sistema son SECURITY DEFINER y corren como su dueño, así
-- que current_user distingue la API (authenticated) del sistema.
-- -----------------------------------------------------------------------------
create or replace function private.guard_aircraft_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('assigned', 'in_flight') then
      raise exception 'La aeronave tiene un vuelo reservado o en curso' using errcode = '55006';
    end if;
    return old;
  end if;

  new.registration := upper(btrim(new.registration));
  if tg_op = 'UPDATE' and new.airline_id is distinct from old.airline_id then
    raise exception 'Una aeronave no se puede cambiar de aerolínea' using errcode = '42501';
  end if;

  if current_user in ('authenticated', 'anon') then
    if new.status in ('assigned', 'in_flight')
       and (tg_op = 'INSERT' or new.status is distinct from old.status) then
      raise exception 'Los estados Asignada y En vuelo los pone el sistema' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and old.status in ('assigned', 'in_flight') and (
         new.status is distinct from old.status
         or new.aircraft_type_id is distinct from old.aircraft_type_id
         or new.current_airport_id is distinct from old.current_airport_id
       ) then
      raise exception 'La aeronave tiene un vuelo reservado o en curso; cancela la reserva primero' using errcode = '55006';
    end if;
  end if;
  return new;
end;
$$;

create trigger aircraft_guard_delete before delete on public.aircraft
  for each row execute function private.guard_aircraft_write();
