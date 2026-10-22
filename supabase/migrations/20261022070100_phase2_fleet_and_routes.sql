-- =============================================================================
-- LAM Virtual ACARS — Fase 2 (2/5): flota, rutas y cálculo de distancia
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Flota por aerolínea
-- -----------------------------------------------------------------------------
create table public.aircraft (
  id                  uuid primary key default gen_random_uuid(),
  airline_id          uuid not null references public.airlines (id) on delete restrict,
  aircraft_type_id    bigint not null references public.aircraft_types (id) on delete restrict,
  registration        text not null unique check (registration ~ '^[A-Z0-9][A-Z0-9-]{1,9}$'),
  fleet_number        text check (char_length(fleet_number) between 1 and 12),
  configuration       text check (char_length(configuration) between 1 and 60),
  operation_type      text not null default 'passenger' check (operation_type in ('passenger', 'cargo', 'mixed')),
  status              public.aircraft_status not null default 'available',
  base_airport_id     bigint references public.airports (id) on delete set null,
  current_airport_id  bigint references public.airports (id) on delete set null,
  total_minutes       integer not null default 0 check (total_minutes >= 0),
  cycles              integer not null default 0 check (cycles >= 0),
  last_flight_at      timestamptz,
  notes               text check (char_length(notes) <= 500),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint aircraft_fleet_number_unique unique (airline_id, fleet_number)
);
comment on table public.aircraft is 'Aeronaves de cada aerolínea. Horas, ciclos y último vuelo los actualizan los PIREP aprobados.';
create index aircraft_airline_id_idx on public.aircraft (airline_id);
create index aircraft_aircraft_type_id_idx on public.aircraft (aircraft_type_id);
create index aircraft_base_airport_id_idx on public.aircraft (base_airport_id);
create index aircraft_current_airport_id_idx on public.aircraft (current_airport_id);

create trigger aircraft_set_updated_at before update on public.aircraft
  for each row execute function private.set_updated_at();
create trigger aircraft_audit after insert or update or delete on public.aircraft
  for each row execute function private.audit_row('airline_id', 'registration');

-- Las personas solo eligen estados manuales; 'assigned' e 'in_flight' los pone
-- el sistema (reservas y ACARS). La aerolínea de una aeronave no cambia.
create function private.guard_aircraft_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.registration := upper(btrim(new.registration));
  if tg_op = 'UPDATE' and new.airline_id is distinct from old.airline_id then
    raise exception 'Una aeronave no se puede cambiar de aerolínea' using errcode = '42501';
  end if;
  if (select auth.uid()) is not null
     and new.status in ('assigned', 'in_flight')
     and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    raise exception 'Los estados Asignada y En vuelo los pone el sistema' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger aircraft_guard_write before insert or update on public.aircraft
  for each row execute function private.guard_aircraft_write();

-- -----------------------------------------------------------------------------
-- Rutas
-- -----------------------------------------------------------------------------
create table public.routes (
  id                      uuid primary key default gen_random_uuid(),
  airline_id              uuid not null references public.airlines (id) on delete restrict,
  flight_number           text not null check (flight_number ~ '^[0-9]{1,4}[A-Z]?$'),
  origin_airport_id       bigint not null references public.airports (id) on delete restrict,
  destination_airport_id  bigint not null references public.airports (id) on delete restrict,
  distance_nm             integer not null default 0 check (distance_nm >= 0),
  estimated_minutes       smallint not null check (estimated_minutes between 10 and 1440),
  departure_time_utc      time,
  days_of_week            smallint not null default 127 check (days_of_week between 1 and 127),
  operation_type          text not null default 'passenger' check (operation_type in ('passenger', 'cargo', 'mixed')),
  is_active               boolean not null default true,
  notes                   text check (char_length(notes) <= 500),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint routes_flight_number_unique unique (airline_id, flight_number),
  constraint routes_distinct_airports check (origin_airport_id <> destination_airport_id)
);
comment on table public.routes is 'Rutas programadas (plantillas). Cada operación crea un vuelo propio en la Fase 3.';
comment on column public.routes.days_of_week is 'Máscara de bits: lunes = 1, martes = 2, … domingo = 64.';
create index routes_origin_airport_id_idx on public.routes (origin_airport_id);
create index routes_destination_airport_id_idx on public.routes (destination_airport_id);

create table public.route_aircraft_types (
  route_id          uuid not null references public.routes (id) on delete cascade,
  aircraft_type_id  bigint not null references public.aircraft_types (id) on delete restrict,
  primary key (route_id, aircraft_type_id)
);
create index route_aircraft_types_aircraft_type_id_idx on public.route_aircraft_types (aircraft_type_id);

create trigger routes_set_updated_at before update on public.routes
  for each row execute function private.set_updated_at();
create trigger routes_audit after insert or update or delete on public.routes
  for each row execute function private.audit_row('airline_id', 'flight_number');

-- Distancia ortodrómica en millas náuticas.
create function private.great_circle_nm(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select 3440.065 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)
  ));
$$;

-- Distancia calculada siempre en el servidor; duración estimada si no se da
-- (430 kt de crucero más 30 minutos de rodaje, ascenso y aproximación).
create function private.set_route_metrics()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  o_lat double precision;
  o_lon double precision;
  d_lat double precision;
  d_lon double precision;
begin
  new.flight_number := upper(btrim(new.flight_number));
  if tg_op = 'UPDATE' and new.airline_id is distinct from old.airline_id then
    raise exception 'Una ruta no se puede cambiar de aerolínea' using errcode = '42501';
  end if;

  select latitude, longitude into o_lat, o_lon from public.airports where id = new.origin_airport_id;
  select latitude, longitude into d_lat, d_lon from public.airports where id = new.destination_airport_id;
  if o_lat is null or d_lat is null then
    raise exception 'Aeropuerto no encontrado' using errcode = '23503';
  end if;

  new.distance_nm := round(private.great_circle_nm(o_lat, o_lon, d_lat, d_lon));
  if new.estimated_minutes is null then
    new.estimated_minutes := least(1440, greatest(10, round(new.distance_nm / 430.0 * 60 + 30)));
  end if;
  return new;
end;
$$;

create trigger routes_set_metrics before insert or update on public.routes
  for each row execute function private.set_route_metrics();

-- Convierte '1357' (lunes = 1 … domingo = 7) en máscara de bits.
create function private.days_mask(p_days text)
returns smallint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_mask integer := 0;
  v_char text;
begin
  if p_days is null or btrim(p_days) = '' then
    return 127;
  end if;
  foreach v_char in array regexp_split_to_array(regexp_replace(p_days, '[\s,]', '', 'g'), '') loop
    if v_char !~ '^[1-7]$' then
      raise exception 'Días inválidos: usa dígitos del 1 (lunes) al 7 (domingo)';
    end if;
    v_mask := v_mask | (1 << (v_char::int - 1));
  end loop;
  return v_mask;
end;
$$;

alter table public.aircraft             enable row level security;
alter table public.routes               enable row level security;
alter table public.route_aircraft_types enable row level security;
