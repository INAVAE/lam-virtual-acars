-- =============================================================================
-- LAM Virtual ACARS — Comentarios del PIREP en cualquier momento
--
-- El comentario inicial del piloto (pireps.pilot_comment) se edita mientras el
-- PIREP espera revisión. Además, el piloto y el staff de la aerolínea pueden
-- agregar comentarios en cualquier momento, aunque el PIREP ya esté aceptado o
-- rechazado: quedan en una conversación que no se edita ni se borra.
-- =============================================================================

create table public.pirep_comments (
  id           uuid primary key default gen_random_uuid(),
  pirep_id     uuid not null references public.pireps (id) on delete cascade,
  author_id    uuid references public.profiles (id) on delete set null,
  author_name  text not null check (char_length(author_name) between 1 and 120),
  author_role  text not null check (author_role in ('pilot', 'staff')),
  body         text not null check (char_length(body) between 1 and 2000),
  created_at   timestamptz not null default now()
);
comment on table public.pirep_comments is 'Conversación de un PIREP entre el piloto y el staff; se agrega en cualquier momento y no se edita.';
create index pirep_comments_pirep_idx on public.pirep_comments (pirep_id, created_at);
create index pirep_comments_author_idx on public.pirep_comments (author_id);

alter table public.pirep_comments enable row level security;
revoke all on public.pirep_comments from anon, authenticated;
grant select on public.pirep_comments to authenticated;

-- Lo ve quien ve el PIREP (la RLS de pireps se aplica en la subconsulta).
create policy pirep_comments_select on public.pirep_comments for select to authenticated
  using (exists (select 1 from public.pireps p where p.id = pirep_id));

create function public.add_pirep_comment(p_pirep_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_pirep public.pireps;
  v_body text := nullif(btrim(p_body), '');
  v_role text;
  v_name text;
  v_row public.pirep_comments;
begin
  if v_uid is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  select * into v_pirep from public.pireps where id = p_pirep_id;
  if not found then
    raise exception 'PIREP no encontrado' using errcode = 'P0002', hint = 'not_found';
  end if;
  if v_pirep.user_id = v_uid then
    v_role := 'pilot';
  elsif private.can_staff_airline(v_pirep.airline_id) then
    v_role := 'staff';
  else
    raise exception 'PIREP no encontrado' using errcode = '42501', hint = 'not_allowed';
  end if;
  if v_pirep.status = 'archived' and not private.is_org_admin() then
    raise exception 'El PIREP está archivado' using errcode = '55000', hint = 'archived';
  end if;
  if v_body is null then
    raise exception 'Escribe el comentario' using errcode = '22023', hint = 'empty_comment';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'El comentario es demasiado largo (máximo 2,000 caracteres)' using errcode = '22001', hint = 'comment_too_long';
  end if;
  if (select count(*) from public.pirep_comments c where c.author_id = v_uid and c.created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Demasiados comentarios en una hora; intenta más tarde' using errcode = '54000', hint = 'rate_limited';
  end if;
  select coalesce(nullif(btrim(p.display_name), ''), 'Piloto') into v_name from public.profiles p where p.id = v_uid;
  insert into public.pirep_comments (pirep_id, author_id, author_name, author_role, body)
  values (p_pirep_id, v_uid, coalesce(v_name, 'Piloto'), v_role, v_body)
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.add_pirep_comment(uuid, text) from public, anon;
grant execute on function public.add_pirep_comment(uuid, text) to authenticated;
