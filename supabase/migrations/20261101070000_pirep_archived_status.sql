-- =============================================================================
-- LAM Virtual ACARS — Estado "archivado" del PIREP
-- Va en su propia migración: un valor nuevo de un enum no se puede usar en la
-- misma transacción que lo agrega (la siguiente migración lo usa).
-- =============================================================================
alter type public.pirep_status add value if not exists 'archived';
