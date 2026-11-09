-- =============================================================================
-- LAM Virtual ACARS — El superadministrador y el administrador de la aerolínea
-- modifican un tour por completo, en cualquier estado
--
-- Antes, al publicarse, el código, los legs y los tipos de aeronave quedaban fijos
-- para todos, y quien lo propuso lo seguía editando. Ahora:
-- - Lo modifican por completo (datos, código, tipos, legs, fechas, reglas,
--   insignia y cerrarlo) el superadministrador y el administrador de la aerolínea
--   del tour, aunque ya esté publicado, cerrado o tenga pilotos con avance.
-- - Quien lo propuso (sin ser administrador) solo lo edita mientras es borrador o
--   fue rechazado. Sigue revisando las inscripciones.
-- - Los legs se actualizan conservando su id: los vuelos y PIREP ya hechos siguen
--   contando para su leg; un leg quitado deja sus vuelos como vuelos normales; las
--   inscripciones en curso se recalculan y quien ya lo terminó conserva la insignia.
-- =============================================================================

-- Para reordenar los legs sin chocar con el número único.
do $do$
begin
  execute 'alter table public.tour_legs drop constraint tour_legs_leg_number_check';
  execute 'alter table public.tour_legs add constraint tour_legs_leg_number_check check (leg_number between 1 and 120)';
end
$do$;

create function private.can_modify_tour(p_tour_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tours t
     where t.id = p_tour_id
       and (private.can_manage_airline(t.airline_id)
            or (t.created_by = (select auth.uid()) and t.status in ('draft', 'rejected')))
  );
$$;
revoke all on function private.can_modify_tour(uuid) from public;
grant execute on function private.can_modify_tour(uuid) to authenticated, service_role;

-- La insignia la sube quien puede modificar el tour.
create or replace function private.can_edit_tour_folder(p_folder text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_folder is null or p_folder !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.can_modify_tour(p_folder::uuid);
end;
$$;

create or replace function public.close_tour(p_tour_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.can_modify_tour(p_tour_id) then
    raise exception 'Solo el superadministrador o el administrador de la aerolínea cierran el tour' using errcode = '42501', hint = 'tour_admin_only';
  end if;
  update public.tours set status = 'closed', closed_at = now() where id = p_tour_id and status = 'published';
  if not found then
    raise exception '%', private.program_reason_message('tour_not_published') using errcode = 'P0001', hint = 'tour_not_published';
  end if;
end;
$$;

create or replace function public.save_tour(p_tour_id uuid, p_tour jsonb, p_legs jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_tour public.tours;
  v_id uuid := p_tour_id;
  v_airline uuid;
  v_types bigint[];
  v_leg jsonb;
  v_n integer := 0;
  v_origin public.airports;
  v_dest public.airports;
  v_enrollment uuid;
begin
  if v_uid is null then
    raise exception 'Se requiere iniciar sesión' using errcode = '28000';
  end if;
  v_types := coalesce((select array_agg(distinct x::bigint) from jsonb_array_elements_text(coalesce(p_tour -> 'aircraft_type_ids', '[]'::jsonb)) x), '{}');
  if exists (select 1 from unnest(v_types) t where not exists (select 1 from public.aircraft_types a where a.id = t)) then
    raise exception 'Hay un tipo de aeronave que no existe' using errcode = '22023';
  end if;

  if v_id is null then
    v_airline := (p_tour ->> 'airline_id')::uuid;
    if v_airline is null or not (private.is_airline_member(v_airline) or private.is_org_admin()) then
      raise exception 'Solo los miembros de la aerolínea crean tours en ella' using errcode = '42501';
    end if;
    begin
      insert into public.tours (airline_id, created_by, code, name, description, color, badge_path, aircraft_type_ids, starts_on, ends_on,
                                ordered_legs, allow_unreviewed_progress, max_unreviewed_legs, auto_approve_same_airline)
      values (v_airline, v_uid, upper(trim(p_tour ->> 'code')), trim(p_tour ->> 'name'), nullif(trim(p_tour ->> 'description'), ''),
              coalesce(p_tour ->> 'color', '#a855f7'), nullif(p_tour ->> 'badge_path', ''), v_types,
              (p_tour ->> 'starts_on')::date, (p_tour ->> 'ends_on')::date,
              coalesce((p_tour ->> 'ordered_legs')::boolean, true), coalesce((p_tour ->> 'allow_unreviewed_progress')::boolean, true),
              coalesce((p_tour ->> 'max_unreviewed_legs')::smallint, 2), coalesce((p_tour ->> 'auto_approve_same_airline')::boolean, false))
      returning id into v_id;
    exception when unique_violation then
      raise exception '%', private.program_reason_message('tour_code_taken') using errcode = '23505', hint = 'tour_code_taken';
    end;
    select * into v_tour from public.tours where id = v_id;
  else
    select * into v_tour from public.tours where id = v_id for update;
    if not found or not private.can_view_tour(v_id) then
      raise exception '%', private.program_reason_message('tour_not_found') using errcode = 'P0002', hint = 'tour_not_found';
    end if;
    -- Cambiarlo es del superadministrador y del administrador de su aerolínea, en cualquier estado;
    -- quien lo propuso solo mientras es borrador o fue rechazado.
    if not private.can_modify_tour(v_id) then
      raise exception 'Solo el superadministrador o el administrador de % modifican este tour', (select a.name from public.airlines a where a.id = v_tour.airline_id)
        using errcode = '42501', hint = 'tour_admin_only';
    end if;
    begin
      update public.tours set
        code = upper(trim(p_tour ->> 'code')),
        name = trim(p_tour ->> 'name'),
        description = nullif(trim(p_tour ->> 'description'), ''),
        color = coalesce(p_tour ->> 'color', color),
        badge_path = nullif(p_tour ->> 'badge_path', ''),
        aircraft_type_ids = v_types,
        starts_on = (p_tour ->> 'starts_on')::date,
        ends_on = (p_tour ->> 'ends_on')::date,
        ordered_legs = coalesce((p_tour ->> 'ordered_legs')::boolean, ordered_legs),
        allow_unreviewed_progress = coalesce((p_tour ->> 'allow_unreviewed_progress')::boolean, allow_unreviewed_progress),
        max_unreviewed_legs = coalesce((p_tour ->> 'max_unreviewed_legs')::smallint, max_unreviewed_legs),
        auto_approve_same_airline = coalesce((p_tour ->> 'auto_approve_same_airline')::boolean, auto_approve_same_airline)
      where id = v_id;
    exception when unique_violation then
      raise exception '%', private.program_reason_message('tour_code_taken') using errcode = '23505', hint = 'tour_code_taken';
    end;
  end if;

  if p_legs is not null then
    if jsonb_typeof(p_legs) <> 'array' or jsonb_array_length(p_legs) not between 1 and 60 then
      raise exception 'Un tour tiene de 1 a 60 legs' using errcode = '22023';
    end if;
    -- Los legs que siguen conservan su id: los vuelos y PIREP ya hechos siguen contando.
    -- Un leg que se quita deja sus vuelos como vuelos normales de la aerolínea.
    delete from public.tour_legs l
     where l.tour_id = v_id
       and l.id not in (select (x ->> 'id')::uuid from jsonb_array_elements(p_legs) x
                         where coalesce(x ->> 'id', '') ~ '^[0-9a-f-]{36}$');
    update public.tour_legs set leg_number = leg_number + 60 where tour_id = v_id;
    for v_leg in select value from jsonb_array_elements(p_legs) loop
      v_n := v_n + 1;
      select * into v_origin from public.airports where id = (v_leg ->> 'origin_airport_id')::bigint;
      select * into v_dest from public.airports where id = (v_leg ->> 'destination_airport_id')::bigint;
      if v_origin.id is null or v_dest.id is null then
        raise exception 'El leg % tiene un aeropuerto que no existe', v_n using errcode = '22023';
      end if;
      if v_origin.id = v_dest.id then
        raise exception 'El leg % sale y llega al mismo aeropuerto', v_n using errcode = '22023';
      end if;
      update public.tour_legs
         set leg_number = v_n, origin_airport_id = v_origin.id, destination_airport_id = v_dest.id,
             distance_nm = round(private.great_circle_nm(v_origin.latitude, v_origin.longitude, v_dest.latitude, v_dest.longitude))::integer,
             notes = nullif(trim(v_leg ->> 'notes'), '')
       where tour_id = v_id and coalesce(v_leg ->> 'id', '') ~ '^[0-9a-f-]{36}$' and id = (v_leg ->> 'id')::uuid;
      if not found then
        insert into public.tour_legs (tour_id, leg_number, origin_airport_id, destination_airport_id, distance_nm, notes)
        values (v_id, v_n, v_origin.id, v_dest.id,
                round(private.great_circle_nm(v_origin.latitude, v_origin.longitude, v_dest.latitude, v_dest.longitude))::integer,
                nullif(trim(v_leg ->> 'notes'), ''));
      end if;
    end loop;
    -- Quien va a la mitad puede terminarlo (si se quitaron legs) o seguir; quien ya lo terminó conserva su insignia.
    for v_enrollment in select e.id from public.tour_enrollments e where e.tour_id = v_id and e.status = 'approved' loop
      perform private.refresh_tour_enrollment(v_enrollment);
    end loop;
  end if;
  return v_id;
end;
$$;

-- La web sabe quién puede modificarlo (botón Editar y Cerrar).
do $do$
declare
  v_src text := pg_get_functiondef('private.tour_summary(public.tours)'::regprocedure);
  v_new text;
begin
  v_new := replace(v_src, $a$'can_edit', private.can_edit_tour(p_tour.id),$a$,
                          $b$'can_edit', private.can_edit_tour(p_tour.id),
    'can_modify', private.can_modify_tour(p_tour.id),$b$);
  if v_new = v_src then
    raise exception 'tour_summary no tiene la línea esperada';
  end if;
  execute v_new;
end
$do$;
