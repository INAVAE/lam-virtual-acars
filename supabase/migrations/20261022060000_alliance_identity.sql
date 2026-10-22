-- =============================================================================
-- Identidad de las aerolíneas de la alianza: logotipos, colores tomados de
-- cada logotipo, tipo de operación, sitio web y descripciones de
-- https://lineasaereasmexicanas.com.mx/es/alianzas. Las cuatro aparecen ahí
-- como miembros de la comunidad y se activan.
-- =============================================================================

alter table public.airlines
  add column operation_type text not null default 'passenger'
    check (operation_type in ('passenger', 'cargo', 'mixed')),
  add column website_url text
    check (website_url ~ '^https://[^\s]+$' and char_length(website_url) <= 200);

comment on column public.airlines.operation_type is 'Pasajeros, carga o mixta.';
comment on column public.airlines.website_url is 'Sitio web propio de la aerolínea virtual, si existe.';

grant update (operation_type, website_url) on public.airlines to authenticated;

update public.airlines set
  operation_type = 'mixed',
  website_url = 'https://lineasaereasmexicanas.com.mx'
where slug = 'lineas-aereas-mexicanas';

update public.airlines set
  brand_primary_color = '#D29006',
  brand_secondary_color = '#08765D',
  logo_path = 'airlines/alas-del-sur.png',
  operation_type = 'passenger',
  website_url = 'https://www.alasdelsurva.org',
  description = 'Aerolínea virtual orientada a conectar destinos nacionales y regionales mediante una operación cercana, dinámica y con identidad propia.',
  is_active = true
where slug = 'alas-del-sur';

update public.airlines set
  brand_primary_color = '#FCBA5A',
  brand_secondary_color = '#AE2430',
  logo_path = 'airlines/taesa.png',
  operation_type = 'passenger',
  website_url = 'https://taesava.com',
  description = 'Operación virtual no oficial que recupera una identidad emblemática de la aviación mexicana y la lleva a una experiencia virtual actual.',
  is_active = true
where slug = 'taesa';

update public.airlines set
  brand_primary_color = '#4D148C',
  brand_secondary_color = '#FC6600',
  logo_path = 'airlines/fedex-virtual.png',
  operation_type = 'cargo',
  description = 'Operación virtual no oficial de carga, inspirada en la precisión, el alcance y la coordinación logística de una red en constante movimiento.',
  is_active = true
where slug = 'fedex-virtual';

update public.airlines set
  brand_primary_color = '#1E88E5',
  logo_path = 'airlines/viva-virtual.png',
  operation_type = 'passenger',
  description = 'Operación virtual no oficial, ágil y directa, que acerca a más pilotos a una experiencia moderna de aviación virtual.',
  is_active = true
where slug = 'viva-virtual';
