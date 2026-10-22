-- =============================================================================
-- Líneas Aéreas Mexicanas como aerolínea virtual, datos de plan de vuelo y
-- códigos ICAO de la alianza.
-- Fuente: identidad corporativa de LAM (ICAO MXL, callsign AGUILA,
-- RMK IVAOVA/MXL) y https://lineasaereasmexicanas.com.mx/es/alianzas
-- (ICAO WOS, TEJ, FDX y VIV). Red de operación: IVAO.
-- =============================================================================

alter table public.airlines
  add column network text not null default 'IVAO' check (network in ('IVAO', 'VATSIM', 'OFFLINE')),
  add column flight_plan_remarks text check (char_length(flight_plan_remarks) between 1 and 100);

comment on column public.airlines.network is 'Red de control aéreo donde opera la aerolínea.';
comment on column public.airlines.flight_plan_remarks is 'Texto para la casilla RMK del plan de vuelo (por ejemplo IVAOVA/MXL).';

grant update (network, flight_plan_remarks) on public.airlines to authenticated;

-- Líneas Aéreas Mexicanas: aerolínea propia de la organización, activa.
insert into public.airlines (
  organization_id, slug, name, icao_code, radio_callsign, flight_plan_remarks,
  brand_primary_color, brand_secondary_color, logo_path, is_unofficial_brand, is_active, description
)
select
  o.id, 'lineas-aereas-mexicanas', 'Líneas Aéreas Mexicanas', 'MXL', 'AGUILA', 'IVAOVA/MXL',
  '#057956', '#D6061C', 'airlines/lineas-aereas-mexicanas.png', false, true,
  'Aerolínea virtual de la alianza Líneas Aéreas Mexicanas. Unidos por la pasión de volar.'
from public.organizations o
where o.slug = 'lam'
on conflict (slug) do nothing;

-- Códigos ICAO publicados por la alianza. Se mantienen inactivas hasta
-- completar callsign y logotipo desde el módulo Airlines.
update public.airlines set
  icao_code = 'WOS',
  description = 'Aerolínea virtual de pasajeros enfocada en destinos nacionales y regionales.'
where slug = 'alas-del-sur';

update public.airlines set
  icao_code = 'TEJ',
  description = 'Operación virtual no oficial de pasajeros que retoma una identidad histórica de la aviación mexicana, con vuelos nacionales e internacionales.'
where slug = 'taesa';

update public.airlines set
  icao_code = 'FDX',
  description = 'Operación virtual no oficial de carga y logística, enfocada en la puntualidad.'
where slug = 'fedex-virtual';

update public.airlines set
  icao_code = 'VIV',
  description = 'Operación virtual no oficial de pasajeros con una red de rutas de alta actividad.'
where slug = 'viva-virtual';
