-- =============================================================================
-- LAM Virtual ACARS — METAR de salida y de llegada guardado con el vuelo
--
-- La Edge Function acars guarda el METAR del aeropuerto de salida al recibir el
-- evento de calzos fuera y el del aeropuerto de llegada al cerrar la sesión (el
-- aeropuerto donde terminó, por si hubo desvío). Se toma de NOAA (Aviation
-- Weather Center) la observación más cercana a ese momento. El PIREP lo muestra.
-- Solo la escribe la Edge Function con la clave secreta; la lee quien ve el vuelo.
-- =============================================================================

create table public.flight_weather (
  flight_id    uuid not null references public.flights (id) on delete cascade,
  role         text not null check (role in ('departure', 'arrival')),
  icao         text not null check (icao ~ '^[A-Z0-9]{3,4}$'),
  event_at     timestamptz not null,
  observed_at  timestamptz,
  metar        jsonb check (metar is null or jsonb_typeof(metar) = 'object'),
  source       text not null default 'noaa' check (source in ('noaa', 'cache', 'none')),
  captured_at  timestamptz not null default now(),
  primary key (flight_id, role)
);
comment on table public.flight_weather is
  'METAR del aeropuerto de salida (calzos fuera) y de llegada (fin de la sesión) de cada vuelo; lo escribe la Edge Function acars.';

alter table public.flight_weather enable row level security;
revoke all on public.flight_weather from anon, authenticated;
grant select on public.flight_weather to authenticated;

-- Lo ve quien ve el vuelo (la RLS de flights se aplica en la subconsulta).
create policy flight_weather_select on public.flight_weather for select to authenticated
  using (exists (select 1 from public.flights f where f.id = flight_id));
