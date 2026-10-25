-- =============================================================================
-- LAM Virtual ACARS — Fase 4 (1/3): dispositivos, sesiones y telemetría
-- El conector nunca escribe con supabase-js: todo entra por la Edge Function
-- `acars`, que valida el token del dispositivo y llama a las funciones acars_*.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- Fases del vuelo (docs/architecture/flight-phases.md).
create function private.is_flight_phase(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p in (
    'aircraft_connected', 'preflight', 'engines_started', 'pushback', 'taxi_out', 'takeoff',
    'initial_climb', 'climb', 'cruise', 'descent', 'approach', 'landing', 'taxi_in',
    'engines_shutdown', 'flight_completed'
  );
$$;

-- -----------------------------------------------------------------------------
-- Dispositivos vinculados (un equipo con el conector instalado)
-- -----------------------------------------------------------------------------
create table public.acars_devices (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  name               text not null check (char_length(name) between 1 and 60),
  token_hash         text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_prefix       text not null check (char_length(token_prefix) between 4 and 16),
  app_version        text check (char_length(app_version) <= 40),
  created_at         timestamptz not null default now(),
  last_used_at       timestamptz,
  revoked_at         timestamptz,
  revoked_by         uuid references public.profiles (id) on delete set null,
  rate_window_start  timestamptz not null default now(),
  rate_count         integer not null default 0
);
comment on table public.acars_devices is 'Equipos con LAM ACARS vinculados. Solo se guarda el hash SHA-256 del token.';
create index acars_devices_user_id_idx on public.acars_devices (user_id);
create index acars_devices_revoked_by_idx on public.acars_devices (revoked_by);

create trigger acars_devices_audit after insert or update of revoked_at on public.acars_devices
  for each row execute function private.audit_row('-', 'id');

-- -----------------------------------------------------------------------------
-- Códigos de vinculación (10 minutos)
-- -----------------------------------------------------------------------------
create table public.acars_link_codes (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique check (code ~ '^[A-Z2-9]{8}$'),
  poll_secret_hash  text not null check (poll_secret_hash ~ '^[0-9a-f]{64}$'),
  device_name       text not null check (char_length(device_name) between 1 and 60),
  app_version       text check (char_length(app_version) <= 40),
  ip_hash           text check (char_length(ip_hash) <= 64),
  status            text not null default 'pending' check (status in ('pending', 'approved', 'consumed')),
  user_id           uuid references public.profiles (id) on delete cascade,
  device_id         uuid references public.acars_devices (id) on delete set null,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default now() + interval '10 minutes',
  approved_at       timestamptz,
  consumed_at       timestamptz
);
comment on table public.acars_link_codes is 'Códigos cortos que el conector muestra y el piloto confirma en la web.';
create index acars_link_codes_ip_hash_created_at_idx on public.acars_link_codes (ip_hash, created_at);
create index acars_link_codes_user_id_idx on public.acars_link_codes (user_id);
create index acars_link_codes_device_id_idx on public.acars_link_codes (device_id);

-- -----------------------------------------------------------------------------
-- Sesiones ACARS (una por vuelo; se reanuda si el conector se reinicia)
-- -----------------------------------------------------------------------------
create table public.flight_sessions (
  id                  uuid primary key default gen_random_uuid(),
  flight_id           uuid not null unique references public.flights (id) on delete cascade,
  device_id           uuid references public.acars_devices (id) on delete set null,
  user_id             uuid not null references public.profiles (id) on delete cascade,
  airline_id          uuid not null references public.airlines (id) on delete cascade,
  status              text not null default 'active' check (status in ('active', 'completed', 'aborted')),
  phase               text not null default 'aircraft_connected' check (private.is_flight_phase(phase)),
  sim_aircraft_title  text check (char_length(sim_aircraft_title) <= 256),
  sim_aircraft_icao   text check (char_length(sim_aircraft_icao) <= 8),
  sim_registration    text check (char_length(sim_registration) <= 16),
  client_version      text check (char_length(client_version) <= 40),
  started_at          timestamptz not null default now(),
  last_contact_at     timestamptz not null default now(),
  ended_at            timestamptz,
  end_reason          text check (end_reason in ('completed', 'aborted')),
  final_airport_id    bigint references public.airports (id) on delete set null,
  constraint flight_sessions_ended_consistent check ((status = 'active') = (ended_at is null))
);
comment on table public.flight_sessions is 'Sesión del conector sobre un vuelo: fase actual, aeronave del simulador y último contacto.';
create unique index flight_sessions_one_active_per_user on public.flight_sessions (user_id) where status = 'active';
create index flight_sessions_device_id_idx on public.flight_sessions (device_id);
create index flight_sessions_airline_id_status_idx on public.flight_sessions (airline_id, status);
create index flight_sessions_final_airport_id_idx on public.flight_sessions (final_airport_id);

-- -----------------------------------------------------------------------------
-- Posición viva: una fila por vuelo, sobrescrita cada ~10 s
-- -----------------------------------------------------------------------------
create table public.flight_positions_live (
  flight_id     uuid primary key references public.flights (id) on delete cascade,
  session_id    uuid not null references public.flight_sessions (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  airline_id    uuid not null references public.airlines (id) on delete cascade,
  sampled_at    timestamptz not null,
  latitude      double precision not null check (latitude between -90 and 90),
  longitude     double precision not null check (longitude between -180 and 180),
  altitude_ft   integer not null check (altitude_ft between -2000 and 70000),
  agl_ft        integer check (agl_ft between -100 and 70000),
  ias_kt        smallint check (ias_kt between 0 and 1000),
  gs_kt         smallint check (gs_kt between 0 and 2000),
  heading_deg   smallint check (heading_deg between 0 and 360),
  vs_fpm        integer check (vs_fpm between -20000 and 20000),
  on_ground     boolean not null default false,
  phase         text not null check (private.is_flight_phase(phase)),
  updated_at    timestamptz not null default now()
);
comment on table public.flight_positions_live is 'Última posición conocida de cada vuelo en curso. Se elimina al cerrar la sesión.';
create index flight_positions_live_session_id_idx on public.flight_positions_live (session_id);
create index flight_positions_live_airline_id_idx on public.flight_positions_live (airline_id);
create index flight_positions_live_user_id_idx on public.flight_positions_live (user_id);

-- -----------------------------------------------------------------------------
-- Traza histórica, particionada por mes. Las particiones viven en `private`
-- para que la Data API solo exponga la tabla padre (con RLS).
-- -----------------------------------------------------------------------------
create table public.flight_track_points (
  flight_id    uuid not null,
  seq          integer not null check (seq >= 0),
  sampled_at   timestamptz not null,
  session_id   uuid not null,
  user_id      uuid not null,
  airline_id   uuid not null,
  latitude     double precision not null check (latitude between -90 and 90),
  longitude    double precision not null check (longitude between -180 and 180),
  altitude_ft  integer not null check (altitude_ft between -2000 and 70000),
  gs_kt        smallint check (gs_kt between 0 and 2000),
  ias_kt       smallint check (ias_kt between 0 and 1000),
  vs_fpm       integer check (vs_fpm between -20000 and 20000),
  heading_deg  smallint check (heading_deg between 0 and 360),
  on_ground    boolean not null default false,
  phase        text not null check (private.is_flight_phase(phase)),
  primary key (flight_id, seq, sampled_at)
) partition by range (sampled_at);
comment on table public.flight_track_points is 'Traza reducida de cada vuelo (lotes del conector). Particionada por mes; retención de 90 días.';

create table private.flight_track_points_default partition of public.flight_track_points default;

create function private.ensure_track_partition(p_month date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name text := format('flight_track_points_%s', to_char(v_start, 'YYYY_MM'));
begin
  if to_regclass(format('private.%I', v_name)) is null then
    execute format(
      'create table private.%I partition of public.flight_track_points for values from (%L) to (%L)',
      v_name, v_start, v_end
    );
  end if;
end;
$$;

select private.ensure_track_partition((now() - interval '1 month')::date);
select private.ensure_track_partition(now()::date);
select private.ensure_track_partition((now() + interval '1 month')::date);
select private.ensure_track_partition((now() + interval '2 months')::date);

create index flight_track_points_session_id_idx on public.flight_track_points (session_id);
create index flight_track_points_airline_id_idx on public.flight_track_points (airline_id);
create index flight_track_points_user_id_idx on public.flight_track_points (user_id);

-- -----------------------------------------------------------------------------
-- Eventos y cambios de fase (permanentes, idempotentes por id y por secuencia)
-- -----------------------------------------------------------------------------
create table public.flight_events (
  id           uuid primary key,
  flight_id    uuid not null references public.flights (id) on delete cascade,
  session_id   uuid not null references public.flight_sessions (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  airline_id   uuid not null references public.airlines (id) on delete cascade,
  seq          integer not null check (seq >= 0),
  type         text not null check (type in (
                 'phase_change', 'block_off', 'takeoff', 'touchdown', 'block_on', 'engine_start', 'engine_shutdown',
                 'sim_paused', 'sim_resumed', 'slew', 'crash', 'overspeed', 'stall', 'aircraft_changed',
                 'connection_lost', 'connection_restored', 'note')),
  phase        text not null check (private.is_flight_phase(phase)),
  occurred_at  timestamptz not null,
  latitude     double precision check (latitude between -90 and 90),
  longitude    double precision check (longitude between -180 and 180),
  altitude_ft  integer check (altitude_ft between -2000 and 70000),
  data         jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 8192),
  received_at  timestamptz not null default now(),
  constraint flight_events_seq_unique unique (flight_id, seq)
);
comment on table public.flight_events is 'Eventos del vuelo enviados por el conector. El id lo genera el cliente; los duplicados se ignoran.';
create index flight_events_session_id_idx on public.flight_events (session_id);
create index flight_events_airline_id_occurred_at_idx on public.flight_events (airline_id, occurred_at desc);
create index flight_events_user_id_idx on public.flight_events (user_id);

alter table public.acars_devices         enable row level security;
alter table public.acars_link_codes      enable row level security;
alter table public.flight_sessions       enable row level security;
alter table public.flight_positions_live enable row level security;
alter table public.flight_track_points   enable row level security;
alter table public.flight_events         enable row level security;
alter table private.flight_track_points_default enable row level security;
