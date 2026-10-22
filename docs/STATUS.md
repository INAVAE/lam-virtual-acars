# Estado del proyecto

Última actualización: 2026-10-22

## Fase actual: 2, Administración

### Hecho

- Base de datos: aeropuertos, tipos de aeronave (25 iniciales), flota, rutas con distancia calculada, importación de rutas por CSV (`import_routes`), logotipos en Storage. 28 pruebas pgTAP nuevas (66 en total).
- Edge Function `import-airports`: importa OurAirports con los permisos del superadministrador que la llama.
- Web: Airlines (lista, ficha, logotipo, políticas, alta de aerolíneas), Pilots (solicitudes, roles, suspensión), Fleet (aeronaves y catálogo de tipos), Airports (búsqueda, filtros, importación, alta manual), Routes (filtros, edición, días, tipos permitidos, importación CSV con revisión previa), Administration (bitácora y superadministradores).
- Tipos de TypeScript generados desde el proyecto Supabase.
- CI: errores de compilación como anotaciones; revisión visual de 13 pantallas con sesión (datos simulados) después de cada publicación.

### Pendiente para cerrar la Fase 2

- [ ] Importar aeropuertos desde la web (Airports, Importar de OurAirports).
- [ ] Probar en el sitio con datos reales: crear una aeronave, una ruta e importar un CSV.
- [ ] Unir las dos políticas INSERT de `airline_memberships` (requiere ejecutar un DROP desde el SQL Editor).

### Criterios de aceptación

- [x] Un administrador de aerolínea gestiona su flota, rutas y pilotos, y no puede tocar otra aerolínea (pgTAP).
- [x] La importación CSV reporta errores por fila antes de confirmar (pgTAP y revisión visual).
- [x] Cambios de rol quedan en `audit_logs` y se ven en Administration.

## Fase 1, Fundación (terminada)

### Hecho

- Monorepositorio pnpm: `apps/web`, `packages/shared-types`, `packages/validation`.
- Migraciones de la Fase 1: organización, aerolíneas, perfiles, membresías, configuración y auditoría, con RLS y disparadores de reglas de negocio.
- 38 pruebas pgTAP de aislamiento y permisos: pasan en GitHub Actions sobre Supabase local (flujo Database CI).
- Migraciones aplicadas en el proyecto Supabase `fnsfgjtmwfiizofsjajm`: LAM y sus 4 aerolíneas creadas (inactivas, sin códigos).
- Web: acceso (registro, confirmación de correo, inicio de sesión, recuperación de contraseña), layout con barra lateral, selector de aerolínea con color de marca, reloj UTC, dashboard con datos reales, ajustes de perfil, cambio de contraseña y cierre de otras sesiones, modo oscuro y claro.
- CI en verde: Web CI (tipos, lint, pruebas y build), Database CI y Prueba del sitio publicado (8 comprobaciones con Chromium; capturas en la rama `ci/smoke-screenshots`).
- Sitio publicado: https://inavae.github.io/lam-virtual-acars/
- Documentación de arquitectura, modelo de datos, permisos, despliegue, costos y decisiones.

### Pendiente para cerrar la Fase 1

- [x] Aplicar las migraciones en el proyecto Supabase.
- [x] Configurar en Supabase la Site URL y las URL de redirección de Pages.
- [x] Activar Pages con origen GitHub Actions.
- [ ] Verificar los criterios de aceptación en el sitio publicado.
- [x] Dar de alta al primer superadministrador (LAM1001).
- [ ] Reemplazar los tipos escritos a mano por los generados desde el proyecto.

### Criterios de aceptación

- [x] El sitio carga desde GitHub Pages y las rutas profundas funcionan al recargar (prueba del sitio publicado).
- [x] Registro, verificación de correo e inicio de sesión funcionan en Pages (probado con la cuenta LAM1001).
- [ ] Cierre de sesión y recuperación de contraseña probados por una persona en Pages.
- [x] Al registrarse se crea el perfil con número de piloto único (LAM1001).
- [x] Pruebas pgTAP demuestran el aislamiento entre aerolíneas y que nadie se asigna roles.
- [x] El dashboard muestra conteos reales: consolidado de LAM con 4 aerolíneas registradas, 0 activas y 1 cuenta.
- [x] Los módulos no construidos aparecen como pendientes con su fase.
- [x] Cada PR ejecuta lint, tipos, pruebas y build.
- [x] `main` publica automáticamente en Pages y una prueba con Chromium revisa el sitio después de cada publicación.
- [x] Ninguna clave secreta aparece en el repositorio ni en el build (verificación en el flujo de publicación).

## Siguiente paso

Cerrar la Fase 2 con datos reales y empezar la Fase 3: reservas, callsign por vuelo elegido por el piloto, habilitaciones por tipo e integración con SimBrief.
