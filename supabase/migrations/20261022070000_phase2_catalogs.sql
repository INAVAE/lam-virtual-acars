-- =============================================================================
-- LAM Virtual ACARS — Fase 2 (1/5): catálogos de aeropuertos y tipos de aeronave
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------
create type public.aircraft_status as enum ('available', 'assigned', 'in_flight', 'maintenance', 'out_of_service');

-- -----------------------------------------------------------------------------
-- Aeropuertos (catálogo global)
-- -----------------------------------------------------------------------------
create table public.airports (
  id            bigint generated always as identity primary key,
  icao_code     text not null unique check (icao_code ~ '^[A-Z0-9]{4}$'),
  iata_code     text check (iata_code ~ '^[A-Z0-9]{3}$'),
  name          text not null check (char_length(name) between 2 and 160),
  city          text check (char_length(city) <= 120),
  country_code  text check (country_code ~ '^[A-Z]{2}$'),
  latitude      double precision not null check (latitude between -90 and 90),
  longitude     double precision not null check (longitude between -180 and 180),
  elevation_ft  integer check (elevation_ft between -1500 and 30000),
  airport_type  text not null default 'medium_airport'
    check (airport_type in ('large_airport', 'medium_airport', 'small_airport', 'heliport', 'seaplane_base', 'other')),
  source        text not null default 'manual' check (source in ('ourairports', 'manual')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.airports is 'Catálogo global de aeropuertos. Semilla: OurAirports (dominio público).';
create index airports_iata_code_idx on public.airports (iata_code);
create index airports_country_code_idx on public.airports (country_code);
create index airports_name_trgm_idx on public.airports using gin (name extensions.gin_trgm_ops);
create index airports_city_trgm_idx on public.airports using gin (city extensions.gin_trgm_ops);

create trigger airports_set_updated_at before update on public.airports
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Tipos de aeronave (catálogo global)
-- -----------------------------------------------------------------------------
create table public.aircraft_types (
  id                bigint generated always as identity primary key,
  icao_code         text not null unique check (icao_code ~ '^[A-Z][A-Z0-9]{1,3}$'),
  manufacturer      text not null check (char_length(manufacturer) between 2 and 60),
  model             text not null check (char_length(model) between 1 and 80),
  wake_category     text not null check (wake_category in ('L', 'M', 'H', 'J')),
  engine_type       text not null check (engine_type in ('jet', 'turboprop', 'piston')),
  max_passengers    smallint check (max_passengers between 0 and 900),
  max_cargo_kg      integer check (max_cargo_kg between 0 and 300000),
  cruise_speed_kts  smallint check (cruise_speed_kts between 60 and 700),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.aircraft_types is 'Catálogo global de tipos de aeronave por designador ICAO.';

create trigger aircraft_types_set_updated_at before update on public.aircraft_types
  for each row execute function private.set_updated_at();
create trigger aircraft_types_audit after insert or update or delete on public.aircraft_types
  for each row execute function private.audit_row('-', 'icao_code');

alter table public.airports       enable row level security;
alter table public.aircraft_types enable row level security;
