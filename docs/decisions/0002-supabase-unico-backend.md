# 0002. Supabase como único backend

- Estado: aceptada
- Fecha: 2026-10-19

## Decisión

Supabase concentra autenticación, base de datos, tiempo real, archivos y funciones. El navegador usa solo la clave publicable; la clave secreta existe únicamente en los secretos de Edge Functions. El conector ACARS escribirá solo mediante Edge Functions con un token de dispositivo.

## Consecuencias

- Las políticas RLS son la frontera de seguridad y se prueban con pgTAP en cada cambio.
- Las operaciones que no deben hacerse con permisos del usuario (aprobar PIREP, ingesta ACARS) irán en Edge Functions.
