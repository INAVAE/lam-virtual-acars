-- =============================================================================
-- LAM Virtual ACARS — restaurar un PIREP archivado como aprobado
--
-- restore_pirep(p_pirep_id, p_status): el superadministrador desarchiva un PIREP.
-- Sin p_status vuelve a su estado anterior (como antes). Con p_status = 'accepted'
-- queda aprobado aunque antes estuviera en revisión o rechazado: se registra
-- quién lo aprobó y se suman sus horas, ciclos y avance de tour.
-- =============================================================================

do $do$
begin
  execute 'drop function public.restore_pirep(uuid)';
end;
$do$;

create function public.restore_pirep(p_pirep_id uuid, p_status public.pirep_status default null)
returns public.pireps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_pirep public.pireps;
  v_target public.pirep_status;
begin
  if not private.is_org_admin() then
    raise exception 'Solo el superadministrador restaura PIREP archivados' using errcode = '42501', hint = 'not_allowed';
  end if;
  if p_status is not null and p_status <> 'accepted' then
    raise exception 'Solo se puede restaurar a su estado anterior o como aprobado' using errcode = '22023', hint = 'bad_status';
  end if;
  select * into v_pirep from public.pireps where id = p_pirep_id for update;
  if not found or v_pirep.status <> 'archived' then
    raise exception 'El PIREP no está archivado' using errcode = '55000', hint = 'not_archived';
  end if;
  v_target := coalesce(p_status, v_pirep.archived_from, 'pending');
  update public.pireps
     set status = v_target,
         archived_from = null, archived_at = null, archived_by = null, archive_reason = null,
         -- Aprobado al restaurar (antes no lo estaba): queda registrado quién lo aprobó.
         reviewed_by = case when p_status = 'accepted' and v_pirep.archived_from is distinct from 'accepted' then v_uid else reviewed_by end,
         reviewed_at = case when p_status = 'accepted' and v_pirep.archived_from is distinct from 'accepted' then now() else reviewed_at end
   where id = p_pirep_id
   returning * into v_pirep;
  if v_pirep.status = 'accepted' then
    perform private.apply_pirep_acceptance(v_pirep);
  end if;
  return v_pirep;
end;
$$;
revoke all on function public.restore_pirep(uuid, public.pirep_status) from public, anon;
grant execute on function public.restore_pirep(uuid, public.pirep_status) to authenticated;
comment on function public.restore_pirep(uuid, public.pirep_status) is
  'Superadministrador: desarchiva un PIREP. Sin p_status vuelve a su estado anterior; con ''accepted'' queda aprobado (suma horas, ciclos y avance de tour).';
