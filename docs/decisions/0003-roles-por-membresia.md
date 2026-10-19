# 0003. Roles por aerolínea como arreglo en la membresía

- Estado: aceptada
- Fecha: 2026-10-19

## Contexto

El prompt original sugería las tablas `roles`, `permissions` y `membership_roles`. Los roles son pocos y fijos (administrador, jefe de operaciones, piloto) y cada consulta protegida por RLS los evalúa.

## Decisión

Guardar los roles como `airline_role[]` en `airline_memberships` y el rol de organización en `organization_members`. Los permisos se expresan en funciones SQL (`private.can_manage_airline`, etc.) documentadas en `docs/database/permissions.md`.

## Consecuencias

- Políticas RLS más simples y rápidas (una búsqueda por clave única).
- Una persona puede tener varios roles en una aerolínea sin filas extra.
- Si se necesitan permisos configurables por aerolínea, se agregará una tabla de permisos sin cambiar las membresías.
