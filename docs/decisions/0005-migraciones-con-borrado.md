# 0005. Migraciones que contienen borrados

- Estado: aceptada
- Fecha: 2026-10-22

## Contexto

La conexión de Supabase que usa Claude pide confirmación manual para cualquier sentencia que borre datos (`DELETE`, `DROP`), aunque esté dentro del cuerpo de una función. Esa confirmación no siempre llega a la persona, y la migración se cancela.

## Decisión

1. Las migraciones se dividen para aislar las partes que contienen borrados.
2. Las partes sin borrados las aplica Claude.
3. Las partes con borrados las ejecuta el dueño del proyecto en el SQL Editor de Supabase, copiando el archivo del repositorio sin cambios.
4. El repositorio siempre refleja lo aplicado: un archivo por parte, en el mismo orden.

## Consecuencias

- `20261022070400_phase2_import_routes.sql` se aplicó desde el SQL Editor.
- El historial de migraciones remoto tiene versiones generadas por la conexión; antes de usar `supabase db push` hay que alinearlo con `supabase migration repair`.
- A futuro conviene un flujo de GitHub Actions que aplique migraciones con un token propio del proyecto.
