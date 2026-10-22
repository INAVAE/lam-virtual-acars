-- =============================================================================
-- LAM Virtual ACARS — Fase 2 (5/5): importación de rutas desde CSV
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Importación de rutas (CSV ya convertido a JSON por la web)
-- SECURITY INVOKER: los permisos y RLS de quien llama se aplican a cada fila.
-- Con p_dry_run solo valida. Sin él, escribe todo o nada.
-- -----------------------------------------------------------------------------
create function public.import_routes(p_airline_id uuid, p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row jsonb;
  v_idx integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_valid integer := 0;
  v_created integer := 0;
  v_updated integer := 0;
  v_fn text;
  v_origin bigint;
  v_dest bigint;
  v_codes text[];
  v_types bigint[];
  v_time time;
  v_days smallint;
  v_op text;
  v_minutes smallint;
  v_active boolean;
  v_route uuid;
  v_inserted boolean;
begin
  if not private.can_manage_airline(p_airline_id) then
    raise exception 'No puedes administrar las rutas de esta aerolínea' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Las filas deben ser una lista' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Importa como máximo 2000 rutas por archivo' using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_idx := v_idx + 1;
    begin
      v_fn := upper(btrim(coalesce(v_row ->> 'flight_number', '')));
      if v_fn !~ '^[0-9]{1,4}[A-Z]?$' then
        raise exception 'Número de vuelo inválido: "%"', v_fn;
      end if;

      select id into v_origin from public.airports where icao_code = upper(btrim(coalesce(v_row ->> 'origin', '')));
      if v_origin is null then
        raise exception 'Origen no registrado: "%"', v_row ->> 'origin';
      end if;
      select id into v_dest from public.airports where icao_code = upper(btrim(coalesce(v_row ->> 'destination', '')));
      if v_dest is null then
        raise exception 'Destino no registrado: "%"', v_row ->> 'destination';
      end if;
      if v_origin = v_dest then
        raise exception 'Origen y destino son el mismo aeropuerto';
      end if;

      v_codes := array(
        select distinct upper(btrim(t))
        from unnest(string_to_array(coalesce(v_row ->> 'aircraft_types', ''), '|')) as t
        where btrim(t) <> ''
      );
      if cardinality(v_codes) = 0 then
        raise exception 'Indica al menos un tipo de aeronave (por ejemplo B738|A20N)';
      end if;
      v_types := array(select id from public.aircraft_types where icao_code = any (v_codes));
      if cardinality(v_types) <> cardinality(v_codes) then
        raise exception 'Tipo de aeronave no registrado: %', array_to_string(array(
          select c from unnest(v_codes) as c
          where not exists (select 1 from public.aircraft_types at where at.icao_code = c)
        ), ', ');
      end if;

      v_time := nullif(btrim(coalesce(v_row ->> 'departure_time_utc', '')), '')::time;
      v_days := private.days_mask(v_row ->> 'days');
      v_op := coalesce(nullif(lower(btrim(coalesce(v_row ->> 'operation_type', ''))), ''), 'passenger');
      if v_op not in ('passenger', 'cargo', 'mixed') then
        raise exception 'Tipo de operación inválido: "%" (usa passenger, cargo o mixed)', v_op;
      end if;
      v_minutes := nullif(btrim(coalesce(v_row ->> 'estimated_minutes', '')), '')::smallint;
      if v_minutes is not null and v_minutes not between 10 and 1440 then
        raise exception 'Duración fuera de rango: % minutos', v_minutes;
      end if;
      v_active := coalesce(nullif(lower(btrim(coalesce(v_row ->> 'active', ''))), ''), 'true') in ('true', '1', 'si', 'sí', 'yes');

      if not p_dry_run then
        insert into public.routes as r (
          airline_id, flight_number, origin_airport_id, destination_airport_id,
          estimated_minutes, departure_time_utc, days_of_week, operation_type, is_active
        )
        values (p_airline_id, v_fn, v_origin, v_dest, v_minutes, v_time, v_days, v_op, v_active)
        on conflict (airline_id, flight_number) do update set
          origin_airport_id = excluded.origin_airport_id,
          destination_airport_id = excluded.destination_airport_id,
          estimated_minutes = excluded.estimated_minutes,
          departure_time_utc = excluded.departure_time_utc,
          days_of_week = excluded.days_of_week,
          operation_type = excluded.operation_type,
          is_active = excluded.is_active
        returning r.id, (r.xmax = 0) into v_route, v_inserted;

        delete from public.route_aircraft_types where route_id = v_route;
        insert into public.route_aircraft_types (route_id, aircraft_type_id)
        select v_route, unnest(v_types);

        if v_inserted then v_created := v_created + 1; else v_updated := v_updated + 1; end if;
      end if;
      v_valid := v_valid + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_object(
        'row', v_idx,
        'flight_number', v_row ->> 'flight_number',
        'message', sqlerrm
      );
    end;
  end loop;

  if not p_dry_run and jsonb_array_length(v_errors) > 0 then
    raise exception 'La importación tiene % filas con errores; no se guardó nada', jsonb_array_length(v_errors)
      using errcode = '22023';
  end if;

  return jsonb_build_object(
    'total', v_idx,
    'valid', v_valid,
    'created', v_created,
    'updated', v_updated,
    'errors', v_errors
  );
end;
$$;
revoke all on function public.import_routes(uuid, jsonb, boolean) from public, anon;
grant execute on function public.import_routes(uuid, jsonb, boolean) to authenticated;

