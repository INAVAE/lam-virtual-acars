-- =============================================================================
-- LAM Virtual ACARS — reactivar un PIREP rechazado
--
-- - El piloto solicita la reactivación de su PIREP rechazado con un comentario
--   (request_pirep_reactivation). Queda en el PIREP y en su conversación.
-- - El administrador de la aerolínea o el superadministrador lo reactivan
--   (reactivate_pirep): de vuelta a revisión, o reactivado y aprobado (suma
--   horas, ciclo y avance de tour). También pueden declinar la solicitud.
-- - Solo PIREP rechazados que no estén archivados. El jefe de operaciones no
--   reactiva.
-- =============================================================================

alter table public.pireps
  add column reactivation_requested_at timestamptz,
  add column reactivation_requested_by uuid references public.profiles (id) on delete set null,
  add column reactivation_request text check (char_length(reactivation_request) <= 2000);
comment on column public.pireps.reactivation_requested_at is 'El piloto pidió reactivar el PIREP rechazado; se limpia al resolverse.';
comment on column public.pireps.reactivation_request is 'Comentario del piloto con la solicitud de reactivación.';
create index pireps_reactivation_requested_idx on public.pireps (airline_id) where reactivation_requested_at is not null;
create index pireps_reactivation_requested_by_idx on public.pireps (reactivation_requested_by);

-- -----------------------------------------------------------------------------
-- El piloto solicita la reactivación
-- -----------------------------------------------------------------------------
create function public.request_pirep_reactivation(p_pirep_id uuid, p_comment text)
returns public.pireps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_pirep public.pireps;
  v_comment text := nullif(btrim(p_comment), '');
  v_name text;
begin
  if v_uid is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  select * into v_pirep from public.pireps where id = p_pirep_id for update;
  if not found or v_pirep.user_id is distinct from v_uid then
    raise exception 'Solo el piloto del vuelo solicita su reactivación' using errcode = '42501', hint = 'not_allowed';
  end if;
  if v_pirep.status <> 'rejected' then
    raise exception 'Solo se solicita la reactivación de un PIREP rechazado' using errcode = '55000', hint = 'not_rejected';
  end if;
  if v_comment is null then
    raise exception 'Explica por qué pides la reactivación' using errcode = '22023', hint = 'comment_required';
  end if;
  if char_length(v_comment) > 2000 then
    raise exception 'El comentario es demasiado largo' using errcode = '22001', hint = 'comment_too_long';
  end if;
  if v_pirep.reactivation_requested_at is not null and v_pirep.reactivation_requested_at > now() - interval '1 minute' then
    raise exception 'Ya enviaste la solicitud; espera un momento para cambiarla' using errcode = '54000', hint = 'rate_limited';
  end if;

  update public.pireps
     set reactivation_requested_at = now(), reactivation_requested_by = v_uid, reactivation_request = v_comment
   where id = p_pirep_id
   returning * into v_pirep;

  select display_name into v_name from public.profiles where id = v_uid;
  insert into public.pirep_comments (pirep_id, author_id, author_name, author_role, body)
  values (p_pirep_id, v_uid, left(coalesce(v_name, 'Piloto'), 120), 'pilot', left('Solicitud de reactivación: ' || v_comment, 2000));
  return v_pirep;
end;
$$;
revoke all on function public.request_pirep_reactivation(uuid, text) from public, anon;
grant execute on function public.request_pirep_reactivation(uuid, text) to authenticated;
comment on function public.request_pirep_reactivation(uuid, text) is
  'El piloto pide reactivar su PIREP rechazado (no archivado) con un comentario.';

-- -----------------------------------------------------------------------------
-- El administrador o el superadministrador resuelven
--   p_action: 'review' (vuelve a revisión), 'approve' (reactivado y aprobado)
--             o 'decline' (declina la solicitud; sigue rechazado).
-- -----------------------------------------------------------------------------
create function public.reactivate_pirep(p_pirep_id uuid, p_action text, p_comment text default null)
returns public.pireps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_pirep public.pireps;
  v_comment text := nullif(btrim(p_comment), '');
  v_org_admin boolean := private.is_org_admin();
  v_name text;
  v_body text;
begin
  if v_uid is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  if p_action not in ('review', 'approve', 'decline') then
    raise exception 'Acción no válida' using errcode = '22023', hint = 'bad_action';
  end if;
  select * into v_pirep from public.pireps where id = p_pirep_id for update;
  if not found or not private.can_manage_airline(v_pirep.airline_id) then
    raise exception 'Solo el administrador de la aerolínea o el superadministrador reactivan un PIREP' using errcode = '42501', hint = 'not_allowed';
  end if;
  if v_pirep.user_id = v_uid and not v_org_admin then
    raise exception 'No puedes reactivar tu propio PIREP' using errcode = '42501', hint = 'own_pirep';
  end if;
  if v_pirep.status <> 'rejected' then
    raise exception 'Solo se reactiva un PIREP rechazado (los archivados se restauran primero)' using errcode = '55000', hint = 'not_rejected';
  end if;
  if p_action = 'decline' and v_comment is null then
    raise exception 'Escribe por qué declinas la solicitud' using errcode = '22023', hint = 'comment_required';
  end if;
  if p_action = 'decline' and v_pirep.reactivation_requested_at is null then
    raise exception 'El piloto no ha solicitado la reactivación' using errcode = '55000', hint = 'no_request';
  end if;
  if char_length(v_comment) > 2000 then
    raise exception 'El comentario es demasiado largo' using errcode = '22001', hint = 'comment_too_long';
  end if;

  if p_action = 'approve' then
    update public.pireps
       set status = 'accepted', review_comment = v_comment, reviewed_by = v_uid, reviewed_at = now(),
           reactivation_requested_at = null, reactivation_requested_by = null, reactivation_request = null
     where id = p_pirep_id
     returning * into v_pirep;
    perform private.apply_pirep_acceptance(v_pirep);
    v_body := 'PIREP reactivado y aprobado.';
  elsif p_action = 'review' then
    update public.pireps
       set status = 'pending', review_comment = null, reviewed_by = null, reviewed_at = null,
           reactivation_requested_at = null, reactivation_requested_by = null, reactivation_request = null
     where id = p_pirep_id
     returning * into v_pirep;
    v_body := 'PIREP reactivado: vuelve a revisión.';
  else
    update public.pireps
       set reactivation_requested_at = null, reactivation_requested_by = null, reactivation_request = null
     where id = p_pirep_id
     returning * into v_pirep;
    v_body := 'Solicitud de reactivación declinada; el PIREP sigue rechazado.';
  end if;

  select display_name into v_name from public.profiles where id = v_uid;
  insert into public.pirep_comments (pirep_id, author_id, author_name, author_role, body)
  values (p_pirep_id, v_uid, left(coalesce(v_name, 'Staff'), 120), 'staff', left(v_body || coalesce(' ' || v_comment, ''), 2000));
  return v_pirep;
end;
$$;
revoke all on function public.reactivate_pirep(uuid, text, text) from public, anon;
grant execute on function public.reactivate_pirep(uuid, text, text) to authenticated;
comment on function public.reactivate_pirep(uuid, text, text) is
  'Administrador de la aerolínea o superadministrador: reactiva un PIREP rechazado (review: vuelve a revisión; approve: aprobado) o declina la solicitud del piloto.';
