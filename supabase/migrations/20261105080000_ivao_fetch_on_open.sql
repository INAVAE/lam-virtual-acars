-- =============================================================================
-- Control de IVAO: al abrir el mapa después de un rato sin uso, get_ivao_atc pide
-- el Whazzup en ese momento (si no hay una descarga en curso) en lugar de esperar
-- a la siguiente vuelta de pg_cron. La respuesta la procesa ivao_refresh como antes.
-- (2026-11-05)
-- =============================================================================

create or replace function public.get_ivao_atc()
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

  if to_regclass('net._http_response') is not null
     and s.request_id is null
     and (s.fetched_at is null or s.fetched_at < now() - interval '90 seconds') then
    update private.ivao_state
       set request_id = net.http_get(
             url := 'https://api.ivao.aero/v2/tracker/whazzup',
             headers := jsonb_build_object(
               'User-Agent', 'LAM-Virtual-ACARS/1.0 (+https://inavae.github.io/lam-virtual-acars/)',
               'Accept', 'application/json'),
             timeout_milliseconds := 20000),
           requested_at = now()
     where id and request_id is null;
  end if;

  return jsonb_build_object(
    'fetched_at', s.fetched_at,
    'ivao_updated_at', s.ivao_updated_at,
    'stale', s.fetched_at is null or s.fetched_at < now() - interval '3 minutes',
    'error', s.last_error,
    'atcs', case when s.fetched_at > now() - interval '10 minutes' then s.atcs else '[]'::jsonb end
  );
end;
$$;
