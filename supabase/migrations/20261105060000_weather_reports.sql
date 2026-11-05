-- =============================================================================
-- Clima: METAR y TAF de cualquier aeropuerto del mundo (2026-11-05)
--
-- La Edge Function `weather` consulta el Aviation Weather Center de NOAA
-- (aviationweather.gov, sin llave, 100 consultas por minuto, sin CORS) y guarda
-- aquí la última respuesta por aeropuerto. Un METAR se reutiliza 5 minutos y un
-- TAF 15, así que muchos pilotos pidiendo el mismo aeropuerto generan una sola
-- consulta a NOAA. Un aeropuerto sin METAR o sin TAF también se guarda (con el
-- dato nulo) para no consultarlo en cada visita.
--
-- Solo la función escribe y lee (clave secreta): la web no toca la tabla, así
-- nadie puede guardar un METAR falso.
-- =============================================================================

create table public.weather_reports (
  icao               text primary key check (icao ~ '^[A-Z0-9]{3,4}$'),
  name               text check (char_length(name) <= 200),
  latitude           double precision,
  longitude          double precision,
  elevation_m        integer,
  metar              jsonb,
  metar_observed_at  timestamptz,
  metar_fetched_at   timestamptz,
  taf                jsonb,
  taf_issued_at      timestamptz,
  taf_fetched_at     timestamptz,
  updated_at         timestamptz not null default now()
);
comment on table public.weather_reports is
  'Caché de METAR y TAF del Aviation Weather Center (NOAA) por aeropuerto. La escribe y la lee solo la Edge Function weather.';

alter table public.weather_reports enable row level security;
revoke all on public.weather_reports from anon, authenticated;
grant select, insert, update on public.weather_reports to service_role;
