-- =============================================================================
-- LAM Virtual ACARS — Fase 2 (4/5): logotipos en Storage y catálogo inicial de tipos de aeronave
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Logotipos en Storage: bucket público para lectura; solo el administrador de
-- la aerolínea (o superadministrador) sube o borra en la carpeta {airline_id}/.
-- Sin SVG para evitar contenido activo.
-- -----------------------------------------------------------------------------
create function private.can_manage_airline_folder(p_folder text)
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
  return private.can_manage_airline(p_folder::uuid);
end;
$$;
revoke all on function private.can_manage_airline_folder(text) from public;
grant execute on function private.can_manage_airline_folder(text) to authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('airline-logos', 'airline-logos', true, 524288, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy airline_logos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'airline-logos' and private.can_manage_airline_folder((storage.foldername(name))[1]));
create policy airline_logos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'airline-logos' and private.can_manage_airline_folder((storage.foldername(name))[1]));

-- -----------------------------------------------------------------------------
-- Catálogo inicial de tipos de aeronave (designadores ICAO, Doc 8643)
-- -----------------------------------------------------------------------------
insert into public.aircraft_types (icao_code, manufacturer, model, wake_category, engine_type, max_passengers, max_cargo_kg, cruise_speed_kts) values
  ('A20N', 'Airbus', 'A320neo', 'M', 'jet', 194, null, 450),
  ('A320', 'Airbus', 'A320', 'M', 'jet', 180, null, 450),
  ('A21N', 'Airbus', 'A321neo', 'M', 'jet', 244, null, 450),
  ('A339', 'Airbus', 'A330-900', 'H', 'jet', 287, null, 470),
  ('A359', 'Airbus', 'A350-900', 'H', 'jet', 325, null, 488),
  ('A388', 'Airbus', 'A380-800', 'J', 'jet', 555, null, 490),
  ('B722', 'Boeing', '727-200', 'M', 'jet', 155, null, 470),
  ('B737', 'Boeing', '737-700', 'M', 'jet', 149, null, 450),
  ('B738', 'Boeing', '737-800', 'M', 'jet', 189, null, 453),
  ('B739', 'Boeing', '737-900', 'M', 'jet', 215, null, 453),
  ('B38M', 'Boeing', '737 MAX 8', 'M', 'jet', 189, null, 453),
  ('B748', 'Boeing', '747-8', 'H', 'jet', 410, 137000, 490),
  ('B77L', 'Boeing', '777-200LR / 777F', 'H', 'jet', null, 102000, 490),
  ('B77W', 'Boeing', '777-300ER', 'H', 'jet', 396, null, 490),
  ('B788', 'Boeing', '787-8', 'H', 'jet', 248, null, 488),
  ('B789', 'Boeing', '787-9', 'H', 'jet', 296, null, 488),
  ('MD11', 'McDonnell Douglas', 'MD-11 / MD-11F', 'H', 'jet', 293, 91000, 480),
  ('DC93', 'McDonnell Douglas', 'DC-9-30', 'M', 'jet', 115, null, 430),
  ('E190', 'Embraer', 'E190', 'M', 'jet', 100, null, 450),
  ('CRJ7', 'Bombardier', 'CRJ700', 'M', 'jet', 78, null, 450),
  ('AT76', 'ATR', '72-600', 'M', 'turboprop', 72, null, 275),
  ('DH8D', 'De Havilland Canada', 'Dash 8-400', 'M', 'turboprop', 78, null, 310),
  ('C208', 'Cessna', '208 Caravan', 'L', 'turboprop', 9, null, 180),
  ('C750', 'Cessna', 'Citation X', 'M', 'jet', 12, null, 500),
  ('H25B', 'Hawker', '800XP', 'M', 'jet', 8, null, 430)
on conflict (icao_code) do nothing;
