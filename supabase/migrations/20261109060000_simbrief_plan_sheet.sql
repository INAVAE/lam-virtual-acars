-- =============================================================================
-- LAM Virtual ACARS — Hoja del plan de SimBrief en Live Flights
--
-- El OFP importado guarda además lo que SimBrief muestra en Flight Info, Flight
-- Plan Summary y Load Sheet: distancia de la ruta, salida y llegada programadas,
-- índice de costo, viento medio y su componente, desviación ISA, ciclo AIRAC,
-- número de release, carga de pago, peso vacío y pesos máximos, y el modelo del
-- avión. get_live_flight_route entrega la hoja (sin navlog ni diferencias) a
-- quienes ven el vuelo en vivo.
-- =============================================================================

alter table public.simbrief_ofps
  add column route_distance_nm integer check (route_distance_nm >= 0),
  add column aircraft_name text check (char_length(aircraft_name) <= 40),
  add column sched_out_at timestamptz,
  add column sched_in_at timestamptz,
  add column cost_index text check (char_length(cost_index) <= 8),
  add column avg_wind_dir smallint check (avg_wind_dir between 0 and 360),
  add column avg_wind_kt smallint check (avg_wind_kt between 0 and 400),
  add column avg_wind_comp smallint check (avg_wind_comp between -400 and 400),
  add column avg_isa_dev smallint check (avg_isa_dev between -90 and 90),
  add column airac text check (char_length(airac) <= 8),
  add column release_number smallint check (release_number between 0 and 9999),
  add column payload numeric(10, 1) check (payload >= 0),
  add column oew numeric(10, 1) check (oew >= 0),
  add column max_zfw numeric(10, 1) check (max_zfw >= 0),
  add column max_tow numeric(10, 1) check (max_tow >= 0),
  add column max_ldw numeric(10, 1) check (max_ldw >= 0);

comment on column public.simbrief_ofps.route_distance_nm is 'Distancia de la ruta (general.route_distance); air_distance_nm es la distancia aire con el viento.';
comment on column public.simbrief_ofps.avg_wind_comp is 'Componente media del viento en kt: positivo de cola, negativo de cara (M009 = -9).';
comment on column public.simbrief_ofps.avg_isa_dev is 'Desviación media de la temperatura ISA en °C (P11 = 11).';

grant insert (route_distance_nm, aircraft_name, sched_out_at, sched_in_at, cost_index, avg_wind_dir, avg_wind_kt, avg_wind_comp,
  avg_isa_dev, airac, release_number, payload, oew, max_zfw, max_tow, max_ldw) on public.simbrief_ofps to authenticated;
grant update (route_distance_nm, aircraft_name, sched_out_at, sched_in_at, cost_index, avg_wind_dir, avg_wind_kt, avg_wind_comp,
  avg_isa_dev, airac, release_number, payload, oew, max_zfw, max_tow, max_ldw) on public.simbrief_ofps to authenticated;

create or replace function public.get_live_flight_route(p_flight_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_airline uuid;
  v_ofp public.simbrief_ofps;
begin
  if (select auth.uid()) is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  select f.airline_id into v_airline from public.flights f where f.id = p_flight_id;
  if not found then
    return jsonb_build_object('fixes', '[]'::jsonb, 'route', null, 'plan', null);
  end if;
  if not (private.is_org_admin() or private.is_airline_member(v_airline)) then
    raise exception 'No tienes acceso a esta aerolínea' using errcode = '42501';
  end if;
  select * into v_ofp from public.simbrief_ofps o where o.flight_id = p_flight_id;
  if not found then
    return jsonb_build_object('fixes', '[]'::jsonb, 'route', null, 'plan', null);
  end if;
  return jsonb_build_object(
    'fixes', coalesce(v_ofp.navlog, '[]'::jsonb),
    'route', v_ofp.route,
    'plan', to_jsonb(v_ofp) - 'navlog' - 'mismatches' - 'user_id' - 'airline_id' - 'request_id' - 'static_id' - 'flight_id' - 'route'
  );
end;
$$;
comment on function public.get_live_flight_route(uuid) is
  'Puntos, ruta y hoja del plan de SimBrief de un vuelo, para los miembros de su aerolínea.';
