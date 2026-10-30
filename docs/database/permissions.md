# Roles y permisos

Los permisos se aplican en PostgreSQL con RLS y disparadores; la web solo oculta lo que el usuario no puede usar. Las pruebas están en `supabase/tests/database/` (001 Fase 1, 002 Fase 2, 003 Fase 3).

## Roles

| Rol | Ámbito | Dónde se guarda |
| --- | --- | --- |
| Superadministrador LAM | Organización | `organization_members.role = 'superadmin'` |
| Administrador de aerolínea | Una aerolínea | `'airline_admin' = any(airline_memberships.roles)` |
| Jefe de operaciones | Una aerolínea | `'ops_chief' = any(airline_memberships.roles)` |
| Piloto | Una aerolínea | `'pilot' = any(airline_memberships.roles)` |
| Visitante | Público | Rol `anon` de Supabase |

Una persona puede tener roles distintos en distintas aerolíneas. Solo cuentan las membresías con `status = 'active'` y perfiles con `account_status = 'active'`.

## Funciones de autorización (`private`)

| Función | Verdadero cuando quien llama… |
| --- | --- |
| `is_org_admin()` | es superadministrador activo |
| `has_airline_role(airline, roles[])` | tiene alguno de esos roles activos en la aerolínea |
| `is_airline_member(airline)` | tiene cualquier rol activo en la aerolínea |
| `can_manage_airline(airline)` | es superadministrador o administrador de la aerolínea |
| `can_staff_airline(airline)` | es superadministrador, administrador o jefe de operaciones |
| `is_staff_for_user(user)` | administra o supervisa alguna aerolínea de esa persona |

## Matriz de la Fase 1

| Tabla | Visitante | Piloto | Jefe de operaciones | Admin. de aerolínea | Superadmin |
| --- | --- | --- | --- | --- | --- |
| `organizations` | Leer | Leer | Leer | Leer | Leer, editar nombre |
| `airlines` | Leer activas | Leer activas y las suyas | Igual que piloto | Editar nombre, identidad visual y descripción de la suya | Todo |
| `airline_settings` | No | Leer de sus aerolíneas | Leer | Editar la suya | Todo |
| `airline_memberships` | No | Leer las suyas; solicitar ingreso como piloto pendiente; cancelar o dejar si solo es piloto | Leer las de su aerolínea | Alta, cambio de estado y roles (sin nombrar administradores), baja; nunca sobre sí mismo | Todo, incluido nombrar administradores |
| `profiles` | No | Leer y editar el suyo (sin correo, estado ni alta) | Leer perfiles de su aerolínea | Leer perfiles de su aerolínea | Leer y editar todos |
| `organization_members` | No | Ver si él mismo lo es | Igual | Igual | Leer, agregar y quitar a otros (no a sí mismo) |
| `audit_logs` | No | No | No | Leer los de su aerolínea | Leer todos |
| `get_dashboard_summary()` | No | Sus aerolíneas | Sus aerolíneas | Sus aerolíneas | Consolidado o por aerolínea |

## Matriz de la Fase 2

| Tabla | Piloto | Jefe de operaciones | Admin. de aerolínea | Superadmin |
| --- | --- | --- | --- | --- |
| `airports` | Leer | Leer | Leer | Todo (incluida la importación de OurAirports) |
| `aircraft_types` | Leer | Leer | Leer | Todo |
| `aircraft` | Leer la flota de sus aerolíneas | Igual | Alta, edición y baja en su aerolínea | Todo |
| `routes`, `route_aircraft_types` | Leer las de sus aerolíneas | Igual | Alta, edición, baja e importación CSV en su aerolínea | Todo |
| Storage `airline-logos` | Ver (público) | Ver | Subir y borrar en la carpeta de su aerolínea | Todo |

Reglas adicionales que impone la base de datos:

- Horas, ciclos y último vuelo de una aeronave no se editan a mano (sin permiso de columna).
- Los estados Asignada y En vuelo solo los pone el sistema.
- Una aeronave o ruta no cambia de aerolínea.
- La distancia de una ruta siempre la calcula el servidor.
- `import_routes` corre con los permisos de quien llama (SECURITY INVOKER) y guarda todo o nada.

## Matriz de la Fase 3

| Tabla o función | Piloto | Jefe de operaciones | Admin. de aerolínea | Superadmin |
| --- | --- | --- | --- | --- |
| `pilot_type_ratings` | Ver las suyas | Ver, otorgar y retirar en su aerolínea (no a sí mismo) | Igual que jefe de operaciones | Todo, incluidas las propias |
| `flight_bookings`, `flights` | Ver los suyos | Ver los de su aerolínea | Igual | Todo |
| `simbrief_ofps` | Ver e importar el OFP de su vuelo mientras no comienza | Ver los de su aerolínea | Igual | Ver todos |
| `book_flight()` | Reservar en aerolíneas donde tiene membresía activa | Igual | Igual | Igual (necesita membresía activa) |
| `cancel_booking()` | Cancelar las suyas | Cancelar las de su aerolínea | Igual | Todas |
| `route_aircraft_options()` | Aeronaves de la ruta con el motivo de bloqueo para él | Igual | Igual | Igual |

Nadie inserta ni modifica reservas o vuelos directamente: solo `book_flight`, `cancel_booking` y el vencimiento automático (`private.expire_bookings`, cada 10 minutos con pg_cron y antes de cada reserva).

Reglas de reserva (todas en `private.booking_block_reason` y `book_flight`):

| Regla | Código |
| --- | --- |
| La ruta existe y está activa | `route_inactive` |
| La aeronave es de la aerolínea de la ruta | `aircraft_other_airline` |
| La aeronave está disponible | `aircraft_unavailable` |
| El tipo está permitido en la ruta (si la ruta no marca tipos, cualquiera) | `type_not_allowed` |
| Carga y pasajeros compatibles (mixta sirve para ambas) | `operation_mismatch` |
| Habilitación del tipo, si la aerolínea la exige | `no_rating` |
| Aeronave en el origen (ubicación actual o, si falta, su base), si la aerolínea lo exige | `not_at_origin` |
| No superar `max_active_bookings` | `max_bookings` |
| Membresía activa y aerolínea activa | `not_member` |
| Callsign de 3 a 10 letras o números | `invalid_callsign` |
| Una reserva activa por aeronave | Índice único parcial `flight_bookings_one_active_per_aircraft` |

Una aeronave reservada queda en estado Asignada; mientras lo esté, nadie puede cambiar su estado, tipo o ubicación ni borrarla. Cancelar o vencer la reserva la deja Disponible.

## Reglas contra la escalada de privilegios

- Nadie puede crear su propia membresía activa ni con rol distinto de piloto.
- Un administrador de aerolínea no puede modificar su propia membresía ni la de otro administrador.
- Solo un superadministrador nombra administradores de aerolínea.
- Un superadministrador no puede quitarse a sí mismo, así que siempre queda al menos uno.
- El primer superadministrador se da de alta con `private.grant_superadmin(correo)` desde el SQL Editor; la función no es ejecutable desde la API.

## Avisos aceptados del linter de Supabase

| Aviso | Motivo |
| --- | --- |
| `authenticated_security_definer_function_executable` en `get_dashboard_summary` | Intencional: exige sesión, valida el acceso a la aerolínea pedida y devuelve solo conteos, sin datos personales |
| `authenticated_security_definer_function_executable` en `review_pirep` y `comment_pirep` | Intencional: son la única vía para decidir o comentar un PIREP; validan rol de staff (o dueño), estado pendiente y longitud del comentario |
| `authenticated_security_definer_function_executable` en `book_flight` y `cancel_booking` | Intencional: son la única vía para escribir reservas y vuelos; validan identidad, membresía y todas las reglas antes de escribir |
| `multiple_permissive_policies` en el INSERT de `airline_memberships` | Dos políticas (solicitud propia y alta por administrador). Impacto nulo con el volumen actual; unirlas requiere un DROP desde el SQL Editor |

## PIREP (Fase 5)

| Tabla o vista | Piloto | Jefe de operaciones | Administrador de aerolínea | Superadministrador |
| --- | --- | --- | --- | --- |
| `pireps` | Lee los suyos; comenta mientras están en revisión | Lee los de su aerolínea; acepta o rechaza (no los suyos) | Igual que el jefe de operaciones | Todo, incluso revisar los suyos |
| `pirep_scoring_rules` | Lee las de su aerolínea | Lee | Cambia activación, umbral, penalización y gravedad | Todo |
| `pilot_statistics` | Sus filas | Su aerolínea | Su aerolínea | Todo |

Nadie inserta ni edita PIREPs desde la API: los genera `private.build_pirep` al cerrar la sesión.
