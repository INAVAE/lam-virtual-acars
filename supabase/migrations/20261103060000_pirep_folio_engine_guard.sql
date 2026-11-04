-- Folio de cada PIREP y tope de eventos de motor por sesión.
--
-- Folio: PIREP-AAAA-NNNNN, consecutivo para toda la plataforma (el año es el de
-- creación). Los PIREP existentes se numeran en orden de creación.
--
-- Tope: el 2026-11-01 un A340-600 alternó GENERAL ENG COMBUSTION en cada lectura
-- y el conector 0.1.21 envió 402,372 arranques y apagados en un vuelo. El
-- conector 0.1.22 los filtra; el servidor además guarda como máximo 64 eventos
-- de motor por sesión (un vuelo real tiene 2 a 8), para que una versión anterior
-- no vuelva a llenar la tabla.

create sequence public.pireps_folio_seq;

alter table public.pireps add column folio text;
comment on column public.pireps.folio is 'Folio único del PIREP (PIREP-AAAA-NNNNN), para citarlo en revisiones y pruebas.';

with ordered as (
  select id, created_at, row_number() over (order by created_at, id) as n from public.pireps
)
update public.pireps p
   set folio = 'PIREP-' || to_char(o.created_at at time zone 'UTC', 'YYYY') || '-' || lpad(o.n::text, 5, '0')
  from ordered o
 where o.id = p.id;

select setval('public.pireps_folio_seq', greatest((select count(*) from public.pireps), 1), (select count(*) from public.pireps) > 0);

alter table public.pireps
  alter column folio set default ('PIREP-' || to_char(now() at time zone 'UTC', 'YYYY') || '-' || lpad(nextval('public.pireps_folio_seq')::text, 5, '0')),
  alter column folio set not null;
create unique index pireps_folio_key on public.pireps (folio);
grant select (folio) on public.pireps to authenticated;

create or replace function public.acars_events(p_token_hash text, p_session_id uuid, p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := jsonb_array_length(p_events);
  v_device public.acars_devices := private.acars_device(p_token_hash, greatest(1, v_count / 10));
  v_session public.flight_sessions := private.acars_active_session(v_device, p_session_id);
  v_inserted integer;
  v_last_phase text;
  v_engine_room integer;
begin
  if v_count > 50 then
    perform private.acars_error('batch_too_large', 'Máximo 50 eventos por envío', '22023');
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_events) e
    where (e ->> 'occurred_at')::timestamptz > now() + interval '5 minutes'
  ) then
    perform private.acars_error('clock_skew', 'La hora del equipo está adelantada; sincroniza el reloj de Windows', '22023');
  end if;

  -- Eventos de motor que aún caben en la sesión (tope de 64); los demás se aceptan y se descartan.
  select 64 - count(*) into v_engine_room
    from (select 1 from public.flight_events fe
           where fe.session_id = v_session.id and fe.type in ('engine_start', 'engine_shutdown')
           limit 64) x;

  insert into public.flight_events (
    id, flight_id, session_id, user_id, airline_id, seq, type, phase, occurred_at, latitude, longitude, altitude_ft, data
  )
  select
    (e ->> 'id')::uuid, v_session.flight_id, v_session.id, v_session.user_id, v_session.airline_id,
    (e ->> 'seq')::integer, e ->> 'type', e ->> 'phase', (e ->> 'occurred_at')::timestamptz,
    (e ->> 'latitude')::double precision, (e ->> 'longitude')::double precision,
    round((e ->> 'altitude_ft')::numeric)::integer, coalesce(e -> 'data', '{}'::jsonb)
  from (
    select e, ord,
           count(*) filter (where e ->> 'type' in ('engine_start', 'engine_shutdown')) over (order by ord) as engine_n
      from jsonb_array_elements(p_events) with ordinality as a(e, ord)
  ) x
  where not (e ->> 'type' in ('engine_start', 'engine_shutdown') and engine_n > v_engine_room)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;

  -- La fase de la sesión sigue al último cambio de fase recibido (por secuencia).
  select ev.data ->> 'to' into v_last_phase
  from public.flight_events ev
  where ev.flight_id = v_session.flight_id and ev.type = 'phase_change'
  order by ev.seq desc
  limit 1;
  if v_last_phase is not null and private.is_flight_phase(v_last_phase) and v_last_phase is distinct from v_session.phase then
    update public.flight_sessions set phase = v_last_phase where id = v_session.id;
  end if;

  return jsonb_build_object('received', v_count, 'inserted', v_inserted, 'duplicates', v_count - v_inserted);
end;
$$;
