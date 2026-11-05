-- Centro de ayuda: reporte de incidencias.
--
-- Cualquier usuario con sesión reporta una falla, pide una mejora o pregunta
-- algo sin salir de la web. El reporte llega firmado (nombre y número de piloto
-- tal como estaban al enviarlo) con el navegador, la versión y la pantalla, que
-- es lo primero que se pregunta al diagnosticar y lo que peor se recuerda.
--
-- Quién lo atiende:
-- - Con aerolínea: su administrador y su jefe de operaciones, y el superadministrador.
-- - Sin aerolínea (la plataforma o el conector): solo el superadministrador.
-- Quien lo envió ve el estado y la respuesta. Nadie borra reportes.

create sequence public.support_tickets_folio_seq;

create table public.support_tickets (
  id                   uuid primary key default gen_random_uuid(),
  folio                text not null unique default (
                         'INC-' || to_char(now() at time zone 'UTC', 'YYYY') || '-'
                         || lpad(nextval('public.support_tickets_folio_seq')::text, 5, '0')),
  user_id              uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  author_name          text not null default '',
  author_pilot_number  integer,
  airline_id           uuid references public.airlines (id) on delete set null,
  kind                 text not null default 'error'
                         check (kind in ('error', 'improvement', 'question', 'other')),
  module               text check (char_length(module) between 1 and 60),
  reference            text check (char_length(reference) between 1 and 60),
  title                text not null check (char_length(btrim(title)) between 3 and 140),
  details              text not null check (char_length(btrim(details)) between 10 and 4000),
  context              jsonb not null default '{}'::jsonb
                         check (jsonb_typeof(context) = 'object' and pg_column_size(context) <= 4000),
  status               text not null default 'new'
                         check (status in ('new', 'in_review', 'resolved', 'dismissed')),
  response             text check (char_length(response) <= 4000),
  handled_by           uuid references public.profiles (id) on delete set null,
  handler_name         text,
  handled_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
alter sequence public.support_tickets_folio_seq owned by public.support_tickets.folio;

comment on table public.support_tickets is
  'Incidencias, mejoras y dudas enviadas desde el centro de ayuda. Sin borrado: quedan como historial.';
comment on column public.support_tickets.folio is 'Folio para citar el reporte (INC-AAAA-NNNNN).';
comment on column public.support_tickets.author_name is 'Nombre de quien lo envió al momento de enviarlo.';
comment on column public.support_tickets.airline_id is 'Aerolínea a la que se refiere; nulo si es de la plataforma o del conector.';
comment on column public.support_tickets.module is 'Pantalla o módulo donde ocurrió (Flight Booking, Conector ACARS…).';
comment on column public.support_tickets.reference is 'Folio relacionado: PIREP, evento, callsign o reserva.';
comment on column public.support_tickets.context is 'Navegador, sistema, tamaño de ventana, tema, ruta y versión de la web.';

create index support_tickets_status_idx on public.support_tickets (status, created_at desc);
create index support_tickets_user_idx on public.support_tickets (user_id, created_at desc);
create index support_tickets_airline_idx on public.support_tickets (airline_id, created_at desc);
create index support_tickets_handled_by_idx on public.support_tickets (handled_by);

-- Al enviar: firma, estado inicial y nada de respuesta. Al atender: quién y cuándo.
create function private.support_ticket_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles;
begin
  if tg_op = 'INSERT' then
    select * into v_profile from public.profiles where id = new.user_id;
    new.author_name := coalesce(v_profile.display_name, '');
    new.author_pilot_number := v_profile.pilot_number;
    new.title := btrim(new.title);
    new.details := btrim(new.details);
    new.module := nullif(btrim(new.module), '');
    new.reference := nullif(upper(btrim(new.reference)), '');
    if (select auth.uid()) is not null then
      new.status := 'new';
      new.response := null;
      new.handled_by := null;
      new.handler_name := null;
      new.handled_at := null;
    end if;
    return new;
  end if;

  if new.status is distinct from old.status or new.response is distinct from old.response then
    new.response := nullif(btrim(new.response), '');
    if (select auth.uid()) is not null then
      new.handled_by := (select auth.uid());
      new.handler_name := (select p.display_name from public.profiles p where p.id = (select auth.uid()));
    end if;
    new.handled_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.support_ticket_guard() from public;

create trigger support_tickets_guard before insert or update on public.support_tickets
  for each row execute function private.support_ticket_guard();

-- Quién atiende un reporte.
create function private.can_handle_ticket(p_airline_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_admin()
      or (p_airline_id is not null and private.can_staff_airline(p_airline_id));
$$;
revoke all on function private.can_handle_ticket(uuid) from public;
grant execute on function private.can_handle_ticket(uuid) to authenticated;

alter table public.support_tickets enable row level security;

create policy support_tickets_select on public.support_tickets
  for select to authenticated
  using (user_id = (select auth.uid()) or private.can_handle_ticket(airline_id));

create policy support_tickets_insert on public.support_tickets
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.account_status = 'active')
    and (airline_id is null or private.is_airline_member(airline_id))
  );

create policy support_tickets_update on public.support_tickets
  for update to authenticated
  using (private.can_handle_ticket(airline_id))
  with check (private.can_handle_ticket(airline_id));

revoke all on public.support_tickets from anon, authenticated;
grant select on public.support_tickets to authenticated;
grant insert (airline_id, kind, module, reference, title, details, context) on public.support_tickets to authenticated;
grant update (status, response) on public.support_tickets to authenticated;
grant usage on sequence public.support_tickets_folio_seq to authenticated;

-- Máximo 10 reportes por hora por persona: evita que un error en bucle llene la bandeja.
create function private.support_ticket_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.support_tickets
       where user_id = new.user_id and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Enviaste muchos reportes en la última hora; espera un poco antes de mandar otro'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.support_ticket_rate_limit() from public;

create trigger support_tickets_rate_limit before insert on public.support_tickets
  for each row execute function private.support_ticket_rate_limit();
