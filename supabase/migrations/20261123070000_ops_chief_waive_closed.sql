-- =============================================================================
-- LAM Virtual ACARS — el jefe de operaciones también ajusta faltas de PIREP ya calificados
--
-- waive_pirep_finding(): el staff de la aerolínea (administrador o jefe de
-- operaciones) anula o restaura faltas de los PIREP de su aerolínea en revisión
-- o ya calificados, aunque se hayan aprobado en automático. Archivados: solo el
-- superadministrador, que puede en cualquier PIREP de cualquier aerolínea.
-- =============================================================================

create or replace function public.waive_pirep_finding(p_pirep_id uuid, p_code text, p_reason text default null, p_waive boolean default true)
returns public.pireps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_pirep public.pireps;
  v_reason text := nullif(btrim(p_reason), '');
  v_name text;
  v_findings jsonb;
  v_org_admin boolean := private.is_org_admin();
begin
  if v_uid is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  select * into v_pirep from public.pireps where id = p_pirep_id for update;
  if not found or not private.can_staff_airline(v_pirep.airline_id) then
    raise exception 'PIREP no encontrado o sin permiso para revisarlo' using errcode = '42501', hint = 'not_allowed';
  end if;
  if v_pirep.user_id = v_uid and not v_org_admin then
    raise exception 'No puedes revisar tu propio PIREP' using errcode = '42501', hint = 'own_pirep';
  end if;
  -- En revisión o ya calificado (también en automático): el staff de la
  -- aerolínea del vuelo (administrador o jefe de operaciones). Archivado: solo
  -- el superadministrador.
  if v_pirep.status = 'archived' and not v_org_admin then
    raise exception 'Solo el superadministrador cambia faltas de un PIREP archivado'
      using errcode = '55000', hint = 'already_reviewed';
  end if;
  if not exists (select 1 from jsonb_array_elements(v_pirep.findings) f where f ->> 'code' = p_code) then
    raise exception 'El PIREP no tiene esa falta' using errcode = '22023', hint = 'finding_not_found';
  end if;
  if p_waive and v_reason is null then
    raise exception 'Escribe el motivo de la anulación' using errcode = '22023', hint = 'reason_required';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'El motivo es demasiado largo' using errcode = '22001', hint = 'reason_too_long';
  end if;
  select display_name into v_name from public.profiles where id = v_uid;
  select jsonb_agg(
           case when f ->> 'code' <> p_code then f
                when p_waive then f || jsonb_build_object('waived', true, 'waived_reason', v_reason, 'waived_by', v_uid,
                                                          'waived_by_name', v_name, 'waived_at', now())
                else f - 'waived' - 'waived_reason' - 'waived_by' - 'waived_by_name' - 'waived_at'
           end order by o)
    into v_findings
    from jsonb_array_elements(v_pirep.findings) with ordinality as x(f, o);
  update public.pireps
     set findings = v_findings,
         score = greatest(0, 100 - coalesce((
           select sum((f ->> 'penalty')::integer) from jsonb_array_elements(v_findings) f
            where not coalesce((f ->> 'waived')::boolean, false)), 0)),
         has_critical = exists (
           select 1 from jsonb_array_elements(v_findings) f
            where coalesce((f ->> 'critical')::boolean, false) and not coalesce((f ->> 'waived')::boolean, false))
   where id = p_pirep_id
   returning * into v_pirep;
  return v_pirep;
end;
$$;
