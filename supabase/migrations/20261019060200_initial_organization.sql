-- =============================================================================
-- LAM Virtual ACARS — Fase 1: datos iniciales de la organización
-- Las aerolíneas se crean inactivas y sin códigos: un superadministrador
-- las configura y activa desde la plataforma. No se inventan códigos ICAO/IATA.
-- =============================================================================

insert into public.organizations (slug, name)
values ('lam', 'Líneas Aéreas Mexicanas')
on conflict (slug) do nothing;

insert into public.airlines (organization_id, slug, name, brand_primary_color, is_unofficial_brand, description)
select o.id, v.slug, v.name, v.color, v.unofficial, v.description
from public.organizations o
cross join (values
  ('alas-del-sur',  'Alas del Sur',  '#0EA5E9', false, 'Aerolínea virtual de LAM.'),
  ('taesa',         'TAESA',         '#E11D48', true,  'Operación virtual no oficial inspirada en TAESA.'),
  ('fedex-virtual', 'FedEx Virtual', '#7C3AED', true,  'Operación virtual de carga no oficial inspirada en FedEx.'),
  ('viva-virtual',  'VIVA Virtual',  '#22C55E', true,  'Operación virtual no oficial inspirada en Viva Aerobus.')
) as v (slug, name, color, unofficial, description)
where o.slug = 'lam'
on conflict (slug) do nothing;
