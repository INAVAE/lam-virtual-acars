-- =============================================================================
-- Zona horaria del piloto: la web muestra la hora local junto a la UTC (Zulu).
-- Nula = la del navegador. La web valida contra la lista IANA de Intl.
-- =============================================================================

alter table public.profiles
  add column time_zone text check (
    time_zone is null
    or (char_length(time_zone) <= 64 and time_zone ~ '^(UTC|[A-Za-z]+(/[A-Za-z0-9_+-]+){1,2})$')
  );
comment on column public.profiles.time_zone is 'Zona horaria IANA para mostrar la hora local (America/Mexico_City). Nula = la del navegador.';

grant update (time_zone) on public.profiles to authenticated;
