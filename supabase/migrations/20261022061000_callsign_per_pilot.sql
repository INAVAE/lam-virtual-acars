-- =============================================================================
-- El callsign no es un dato fijo de la aerolínea: cada piloto elige el suyo.
-- Se limpia el valor cargado para LAM y se documenta la columna. El callsign
-- del vuelo se capturará en la reserva (Fase 3).
-- =============================================================================

update public.airlines set radio_callsign = null where slug = 'lineas-aereas-mexicanas';

comment on column public.airlines.radio_callsign is
  'Sin uso: el callsign lo elige cada piloto y se guardará por vuelo en la Fase 3.';
