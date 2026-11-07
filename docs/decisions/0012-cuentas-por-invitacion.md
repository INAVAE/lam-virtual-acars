# ADR 0012: Cuentas de piloto por invitación

Estado: aceptada (2026-11-06)

## Contexto

Cualquiera podía crear una cuenta con correo y contraseña y, tras confirmar el correo,
entrar a la plataforma. Aunque no perteneciera a una aerolínea veía el mapa en vivo, las
estadísticas y los catálogos. El equipo quiere aprobar a cada persona antes de que reciba
cualquier correo.

## Decisión

- **Solicitud sin cuenta:** el formulario público guarda una fila en `account_requests`
  con `request_pilot_account` (security definer, permitido a `anon`). No se crea el
  usuario de Supabase Auth ni se manda correo. La respuesta es igual exista o no el
  correo, para no revelar quién tiene cuenta.
- **Aprobación = invitación:** el superadministrador aprueba en Administration. La Edge
  Function `account-requests` llama primero a los RPC con el token de quien pulsa (así
  la base valida el permiso) y luego manda la invitación de Supabase Auth
  (`auth.admin.inviteUserByEmail`) con la clave de servicio. La invitación es el primer
  y único correo; su enlace abre «Crea tu contraseña».
- **Candado en la base:** un disparador `before insert` en `auth.users` rechaza los
  usuarios que Supabase Auth intente crear sin una solicitud aprobada. Cubre el registro
  directo por la API aunque el panel deje el registro abierto. Solo actúa con la sesión
  `supabase_auth_admin`; las inserciones de mantenimiento como `postgres` no se tocan.
- **Ingreso a la aerolínea sin cambios:** ya con cuenta, el piloto la solicita desde el
  Dashboard y la aprueba el staff de esa aerolínea.

## Alternativas descartadas

- *Dejar el registro y bloquear la entrada hasta aprobar:* el correo de confirmación
  saldría antes de la aprobación y quedarían usuarios sin revisar en Auth.
- *Hook de Auth «before user created»:* hace lo mismo que el disparador pero se configura
  en el panel y no se prueba con pgTAP.

## Consecuencias

- El envío depende del correo de Supabase Auth (límite bajo sin SMTP propio).
- El enlace de invitación vence en 24 horas; «Reenviar invitación» manda uno nuevo
  mientras la persona no haya entrado.
- Las cuentas que ya existían siguen igual.
