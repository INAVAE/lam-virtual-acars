-- =============================================================================
-- LAM Virtual ACARS — Fase 3 (4/4): vencimiento automático de reservas
-- book_flight ya vence las reservas atrasadas antes de validar; esta tarea
-- libera las aeronaves aunque nadie reserve. Si pg_cron no existe (pruebas
-- locales) se omite.
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('lam-expire-bookings', '*/10 * * * *', 'select private.expire_bookings()');
  end if;
end;
$$;
