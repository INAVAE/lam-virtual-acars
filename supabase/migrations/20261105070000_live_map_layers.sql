-- =============================================================================
-- Capas del mapa en vivo (2026-11-05): ruta del plan de SimBrief y control de IVAO
--
-- 1. simbrief_ofps.navlog: los puntos del plan (ident, tipo, coordenadas) que la
--    Edge Function simbrief-ofp guarda al importar. get_live_flight_route los
--    entrega para dibujar la ruta del vuelo elegido.
--
-- 2. Control activo de IVAO desde el Whazzup público (api.ivao.aero/v2/tracker/whazzup,
--    se actualiza cada 15 s):
--    - Una sola descarga cada 30 s para todos, y solo si alguien abrió el mapa en
--      los últimos 2 minutos (pg_cron + pg_net). La respuesta se borra al procesarla.
--    - Se guarda únicamente lo público de cada controlador: callsign, posición,
--      frecuencia, coordenadas, hora de conexión y ATIS. No se guardan el VID, el
--      rango ni los datos de pilotos: los reglamentos de IVAO tratan los datos de
--      sus miembros como confidenciales.
--    - Si pg_net o pg_cron no existen (pruebas locales) la tarea no se programa.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Ruta del plan de SimBrief
-- -----------------------------------------------------------------------------
alter table public.simbrief_ofps
  add column navlog jsonb check (navlog is null or (jsonb_typeof(navlog) = 'array' and jsonb_array_length(navlog) <= 400));
comment on column public.simbrief_ofps.navlog is
  'Puntos del plan de SimBrief: [{ident, type, lat, lon, via, sid_star}] en orden. Solo para dibujar la ruta.';
grant insert (navlog), update (navlog) on public.simbrief_ofps to authenticated;

create function public.get_live_flight_route(p_flight_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_airline uuid;
  v_navlog jsonb;
  v_route text;
begin
  if (select auth.uid()) is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  select f.airline_id into v_airline from public.flights f where f.id = p_flight_id;
  if not found then
    return jsonb_build_object('fixes', '[]'::jsonb, 'route', null);
  end if;
  if not (private.is_org_admin() or private.is_airline_member(v_airline)) then
    raise exception 'No tienes acceso a esta aerolínea' using errcode = '42501';
  end if;
  select o.navlog, o.route into v_navlog, v_route from public.simbrief_ofps o where o.flight_id = p_flight_id;
  return jsonb_build_object('fixes', coalesce(v_navlog, '[]'::jsonb), 'route', v_route);
end;
$$;
comment on function public.get_live_flight_route(uuid) is
  'Puntos del plan de SimBrief de un vuelo, para los miembros de su aerolínea.';
revoke all on function public.get_live_flight_route(uuid) from public, anon;
grant execute on function public.get_live_flight_route(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Control activo de IVAO
-- -----------------------------------------------------------------------------
create table private.ivao_state (
  id               boolean primary key default true check (id),
  request_id       bigint,
  requested_at     timestamptz,
  fetched_at       timestamptz,
  ivao_updated_at  timestamptz,
  atcs             jsonb not null default '[]'::jsonb,
  last_viewed_at   timestamptz,
  last_error       text
);
comment on table private.ivao_state is
  'Última lista de controladores de IVAO (solo datos públicos de la posición) y estado de la descarga.';
insert into private.ivao_state default values;

create function private.safe_float(p text)
returns double precision
language plpgsql
immutable
set search_path = ''
as $$
begin
  return nullif(btrim(p), '')::double precision;
exception when others then
  return null;
end;
$$;
revoke all on function private.safe_float(text) from public;

-- Del Whazzup completo, solo lo público de cada controlador.
create function private.ivao_compact_atcs(p_whazzup jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'callsign', upper(a ->> 'callsign'),
           'position', upper(coalesce(nullif(a -> 'atcSession' ->> 'position', ''),
                                      (regexp_match(a ->> 'callsign', '_([A-Za-z]+)$'))[1])),
           'frequency', private.safe_float(a -> 'atcSession' ->> 'frequency'),
           'latitude', private.safe_float(a -> 'lastTrack' ->> 'latitude'),
           'longitude', private.safe_float(a -> 'lastTrack' ->> 'longitude'),
           'online_since', a ->> 'createdAt',
           'atis', case when jsonb_typeof(a -> 'atis' -> 'lines') = 'array' then a -> 'atis' -> 'lines' end,
           'atis_revision', a -> 'atis' ->> 'revision'
         )) order by a ->> 'callsign'), '[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(p_whazzup -> 'clients' -> 'atcs') = 'array'
                                   then p_whazzup -> 'clients' -> 'atcs' else '[]'::jsonb end) a
   where coalesce(a ->> 'callsign', '') ~ '^[A-Za-z0-9_]{3,20}$';
$$;
revoke all on function private.ivao_compact_atcs(jsonb) from public;

-- Tarea de pg_cron cada 30 s: procesa la respuesta anterior y, si alguien mira el
-- mapa, pide la siguiente. pg_net es asíncrono: la respuesta llega a net._http_response.
create function private.ivao_refresh()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s private.ivao_state;
  v_status integer;
  v_content text;
  v_error text;
  v_body jsonb;
  v_fetched timestamptz;
begin
  if to_regclass('net._http_response') is null then
    return;
  end if;
  select * into s from private.ivao_state where id for update;
  v_fetched := s.fetched_at;

  if s.request_id is not null then
    select r.status_code, r.content, coalesce(r.error_msg, case when r.timed_out then 'tiempo de espera agotado' end)
      into v_status, v_content, v_error
      from net._http_response r where r.id = s.request_id;
    if found then
      if v_status = 200 then
        begin
          v_body := v_content::jsonb;
          update private.ivao_state
             set atcs = private.ivao_compact_atcs(v_body),
                 ivao_updated_at = nullif(v_body ->> 'updatedAt', '')::timestamptz,
                 fetched_at = now(), last_error = null, request_id = null
           where id;
          v_fetched := now();
        exception when others then
          update private.ivao_state set last_error = 'IVAO devolvió una respuesta inválida', request_id = null where id;
        end;
      else
        update private.ivao_state
           set last_error = coalesce(v_error, 'IVAO respondió ' || coalesce(v_status::text, 'sin código')), request_id = null
         where id;
      end if;
      delete from net._http_response where id <= s.request_id;
    elsif s.requested_at < now() - interval '2 minutes' then
      update private.ivao_state set last_error = 'IVAO no respondió', request_id = null where id;
    else
      return;
    end if;
  end if;

  if s.last_viewed_at > now() - interval '2 minutes'
     and (v_fetched is null or v_fetched < now() - interval '25 seconds') then
    update private.ivao_state
       set request_id = net.http_get(
             url := 'https://api.ivao.aero/v2/tracker/whazzup',
             headers := jsonb_build_object(
               'User-Agent', 'LAM-Virtual-ACARS/1.0 (+https://inavae.github.io/lam-virtual-acars/)',
               'Accept', 'application/json'),
             timeout_milliseconds := 20000),
           requested_at = now()
     where id;
  end if;

  -- Por si quedó alguna respuesta sin procesar.
  delete from net._http_response where created < now() - interval '10 minutes';
end;
$$;
revoke all on function private.ivao_refresh() from public;

-- Para la web: la lista vigente y marca que alguien está mirando.
create function public.get_ivao_atc()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  s private.ivao_state;
begin
  if (select auth.uid()) is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  update private.ivao_state set last_viewed_at = now()
   where id and (last_viewed_at is null or last_viewed_at < now() - interval '20 seconds');
  select * into s from private.ivao_state where id;
  return jsonb_build_object(
    'fetched_at', s.fetched_at,
    'ivao_updated_at', s.ivao_updated_at,
    'stale', s.fetched_at is null or s.fetched_at < now() - interval '3 minutes',
    'error', s.last_error,
    'atcs', case when s.fetched_at > now() - interval '10 minutes' then s.atcs else '[]'::jsonb end
  );
end;
$$;
comment on function public.get_ivao_atc() is
  'Controladores conectados a IVAO (Whazzup público): callsign, posición, frecuencia, coordenadas, conexión y ATIS.';
revoke all on function public.get_ivao_atc() from public, anon;
grant execute on function public.get_ivao_atc() to authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net')
     and exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_net;
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('lam-ivao-whazzup', '30 seconds', 'select private.ivao_refresh()');
  end if;
end;
$$;
