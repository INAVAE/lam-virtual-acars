-- =============================================================================
-- LAM Virtual ACARS — Fase 5 (1/3): PIREP, reglas de puntuación y ajustes
-- El PIREP lo genera la base al cerrar una sesión completada, a partir de los
-- eventos y la traza que envió el conector. Nadie lo escribe desde el navegador:
-- el piloto solo comenta y el staff decide con review_pirep.
-- =============================================================================

create type public.pirep_status as enum ('pending', 'accepted', 'rejected');

alter table public.airline_settings
  add column pirep_min_score smallint not null default 80 check (pirep_min_score between 0 and 100);
comment on column public.airline_settings.pirep_min_score is
  'Puntaje mínimo para la aprobación automática (si auto_approve_pireps está activo y no hay faltas graves).';

-- -----------------------------------------------------------------------------
-- Catálogo de reglas (lo define LAM) y ajustes por aerolínea
-- -----------------------------------------------------------------------------
create table public.pirep_rule_definitions (
  code               text primary key check (code ~ '^[a-z][a-z0-9_]{2,40}$'),
  label              text not null,
  description        text not null,
  threshold_unit     text,
  default_enabled    boolean not null default true,
  default_penalty    smallint not null check (default_penalty between 0 and 100),
  default_threshold  numeric check (default_threshold >= 0),
  default_critical   boolean not null default false,
  sort_order         smallint not null
);
comment on table public.pirep_rule_definitions is
  'Reglas que evalúa el PIREP. El umbral (si aplica) y la penalización se ajustan por aerolínea en pirep_scoring_rules.';

insert into public.pirep_rule_definitions
  (code, label, description, threshold_unit, default_enabled, default_penalty, default_threshold, default_critical, sort_order)
values
  ('landing_hard', 'Aterrizaje duro', 'Velocidad vertical al tocar pista más fuerte que el umbral.', 'fpm', true, 20, 600, false, 10),
  ('landing_firm', 'Aterrizaje firme', 'Velocidad vertical al tocar pista más fuerte que el umbral (sin llegar a duro).', 'fpm', true, 5, 400, false, 20),
  ('landing_g', 'Fuerza G al aterrizar', 'Fuerza G máxima en el contacto mayor que el umbral.', 'G', true, 10, 1.8, false, 30),
  ('landing_bounce', 'Rebote', 'El avión despegó de nuevo después de tocar pista.', null, true, 5, null, false, 40),
  ('landing_pitch', 'Cabeceo alto al aterrizar', 'Cabeceo con nariz arriba mayor que el umbral (riesgo de golpe de cola).', '°', true, 10, 9, false, 50),
  ('landing_bank', 'Alabeo al aterrizar', 'Alabeo mayor que el umbral al tocar pista.', '°', true, 5, 5, false, 60),
  ('speed_below_fl100', '250 nudos bajo 10,000 ft', 'Velocidad indicada mayor que el umbral volando por debajo de 10,000 ft.', 'kt', true, 5, 260, false, 70),
  ('taxi_speed', 'Rodaje rápido', 'Velocidad sobre el suelo mayor que el umbral durante el rodaje.', 'kt', true, 5, 30, false, 80),
  ('overspeed', 'Sobrevelocidad', 'El avión pasó su velocidad máxima (aviso del simulador de 2 s o más).', null, true, 10, null, false, 90),
  ('stall', 'Pérdida', 'Aviso de pérdida de 2 s o más.', null, true, 15, null, false, 100),
  ('engines_at_start', 'ACARS iniciado con motores encendidos', 'El vuelo no registró el arranque de motores.', null, true, 5, null, false, 110),
  ('sim_paused', 'Simulador en pausa', 'El simulador estuvo en pausa durante el vuelo (informativo).', null, true, 0, null, false, 120),
  ('go_around', 'Motor y al aire', 'Aproximación frustrada o toque y despegue (informativo).', null, true, 0, null, false, 130),
  ('aircraft_changed', 'Cambio de aeronave', 'La aeronave cargada en el simulador cambió durante el vuelo.', null, true, 0, null, true, 140),
  ('diversion', 'Desvío', 'Llegó a un aeropuerto distinto al destino.', null, true, 0, null, true, 150),
  ('no_flight', 'Vuelo incompleto', 'No se registraron despegue y aterrizaje.', null, true, 50, null, true, 160),
  ('slew', 'Slew', 'Se movió el avión con slew durante el vuelo.', null, true, 50, null, true, 170),
  ('crash', 'Choque', 'El simulador registró un choque.', null, true, 100, null, true, 180);

create table public.pirep_scoring_rules (
  airline_id  uuid not null references public.airlines (id) on delete cascade,
  rule_code   text not null references public.pirep_rule_definitions (code) on delete cascade,
  enabled     boolean not null,
  penalty     smallint not null check (penalty between 0 and 100),
  threshold   numeric check (threshold >= 0),
  critical    boolean not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null,
  primary key (airline_id, rule_code)
);
comment on table public.pirep_scoring_rules is
  'Reglas de puntuación de cada aerolínea. Una falta grave (critical) siempre manda el PIREP a revisión.';
create index pirep_scoring_rules_rule_code_idx on public.pirep_scoring_rules (rule_code);
create index pirep_scoring_rules_updated_by_idx on public.pirep_scoring_rules (updated_by);

insert into public.pirep_scoring_rules (airline_id, rule_code, enabled, penalty, threshold, critical)
select a.id, d.code, d.default_enabled, d.default_penalty, d.default_threshold, d.default_critical
from public.airlines a cross join public.pirep_rule_definitions d;

create function private.create_airline_scoring_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.pirep_scoring_rules (airline_id, rule_code, enabled, penalty, threshold, critical)
  select new.id, d.code, d.default_enabled, d.default_penalty, d.default_threshold, d.default_critical
  from public.pirep_rule_definitions d
  on conflict do nothing;
  return null;
end;
$$;
revoke all on function private.create_airline_scoring_rules() from public;

create trigger airlines_create_scoring_rules after insert on public.airlines
  for each row execute function private.create_airline_scoring_rules();

create trigger pirep_scoring_rules_set_updated_at before update on public.pirep_scoring_rules
  for each row execute function private.set_updated_at();
create trigger pirep_scoring_rules_set_updated_by before update on public.pirep_scoring_rules
  for each row execute function private.set_updated_by();
create trigger pirep_scoring_rules_audit after update on public.pirep_scoring_rules
  for each row execute function private.audit_row('airline_id', 'rule_code');

-- -----------------------------------------------------------------------------
-- PIREP
-- -----------------------------------------------------------------------------
create table public.pireps (
  id                      uuid primary key default gen_random_uuid(),
  flight_id               uuid not null unique references public.flights (id) on delete cascade,
  session_id              uuid not null unique references public.flight_sessions (id) on delete cascade,
  airline_id              uuid not null references public.airlines (id) on delete restrict,
  user_id                 uuid not null references public.profiles (id) on delete cascade,
  aircraft_id             uuid references public.aircraft (id) on delete set null,
  aircraft_type_id        bigint not null references public.aircraft_types (id) on delete restrict,
  aircraft_registration   text not null,
  callsign                text not null,
  flight_number           text not null,
  origin_airport_id       bigint not null references public.airports (id) on delete restrict,
  destination_airport_id  bigint not null references public.airports (id) on delete restrict,
  arrival_airport_id      bigint references public.airports (id) on delete restrict,
  diverted                boolean not null default false,
  block_off_at            timestamptz,
  takeoff_at              timestamptz,
  landing_at              timestamptz,
  block_on_at             timestamptz,
  block_minutes           integer not null check (block_minutes >= 0),
  flight_minutes          integer check (flight_minutes >= 0),
  distance_nm             integer check (distance_nm >= 0),
  planned_distance_nm     integer check (planned_distance_nm >= 0),
  fuel_used_kg            integer,
  max_altitude_ft         integer,
  landing_vs_fpm          integer,
  landing_g               numeric(4, 2),
  landing_bounces         smallint,
  score                   smallint not null check (score between 0 and 100),
  findings                jsonb not null default '[]'::jsonb check (jsonb_typeof(findings) = 'array'),
  metrics                 jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  has_critical            boolean not null default false,
  status                  public.pirep_status not null default 'pending',
  auto_approved           boolean not null default false,
  pilot_comment           text check (char_length(pilot_comment) <= 2000),
  review_comment          text check (char_length(review_comment) <= 2000),
  reviewed_by             uuid references public.profiles (id) on delete set null,
  reviewed_at             timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint pireps_review_consistent check (
    (status = 'pending' and reviewed_at is null)
    or (status <> 'pending' and reviewed_at is not null)
  )
);
comment on table public.pireps is
  'Reporte de cada vuelo completado. Al aceptarse suma block time y ciclo a la aeronave; las horas del piloto salen de sus PIREP aceptados.';
comment on column public.pireps.findings is
  'Reglas que se cumplieron: [{code, label, penalty, critical, value, threshold}].';

create index pireps_airline_status_idx on public.pireps (airline_id, status, created_at desc);
create index pireps_user_idx on public.pireps (user_id, created_at desc);
create index pireps_aircraft_id_idx on public.pireps (aircraft_id);
create index pireps_aircraft_type_id_idx on public.pireps (aircraft_type_id);
create index pireps_origin_airport_id_idx on public.pireps (origin_airport_id);
create index pireps_destination_airport_id_idx on public.pireps (destination_airport_id);
create index pireps_arrival_airport_id_idx on public.pireps (arrival_airport_id);
create index pireps_reviewed_by_idx on public.pireps (reviewed_by);

create trigger pireps_set_updated_at before update on public.pireps
  for each row execute function private.set_updated_at();
create trigger pireps_audit after update on public.pireps
  for each row execute function private.audit_row('airline_id', 'id');
