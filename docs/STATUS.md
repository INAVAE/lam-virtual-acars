# Estado del proyecto

Última actualización: 2026-10-22

## Fase actual: 1, Fundación

### Hecho

- Monorepositorio pnpm: `apps/web`, `packages/shared-types`, `packages/validation`.
- Migraciones de la Fase 1: organización, aerolíneas, perfiles, membresías, configuración y auditoría, con RLS y disparadores de reglas de negocio.
- 38 pruebas pgTAP de aislamiento y permisos: pasan en GitHub Actions sobre Supabase local (flujo Database CI).
- Migraciones aplicadas en el proyecto Supabase `fnsfgjtmwfiizofsjajm`: LAM y sus 4 aerolíneas creadas (inactivas, sin códigos).
- Web: acceso (registro, confirmación de correo, inicio de sesión, recuperación de contraseña), layout con barra lateral, selector de aerolínea con color de marca, reloj UTC, dashboard con datos reales, ajustes de perfil, cambio de contraseña y cierre de otras sesiones, modo oscuro y claro.
- CI en verde: Web CI (tipos, lint, pruebas y build) y Database CI.
- Documentación de arquitectura, modelo de datos, permisos, despliegue, costos y decisiones.

### Pendiente para cerrar la Fase 1

- [x] Aplicar las migraciones en el proyecto Supabase.
- [ ] Configurar en Supabase la Site URL y las URL de redirección de Pages (panel de Supabase; lo hace el dueño del proyecto).
- [ ] Activar Pages con origen GitHub Actions (Settings del repositorio; lo hace el dueño).
- [ ] Verificar los criterios de aceptación en el sitio publicado.
- [ ] Dar de alta al primer superadministrador.
- [ ] Reemplazar los tipos escritos a mano por los generados desde el proyecto.

### Criterios de aceptación

- [ ] El sitio carga desde GitHub Pages y las rutas profundas funcionan al recargar.
- [ ] Registro, verificación de correo, inicio y cierre de sesión, y recuperación de contraseña funcionan en Pages.
- [ ] Al registrarse se crea el perfil con número de piloto único.
- [x] Pruebas pgTAP demuestran el aislamiento entre aerolíneas y que nadie se asigna roles.
- [ ] El dashboard muestra conteos reales o estados vacíos.
- [x] Los módulos no construidos aparecen como pendientes con su fase.
- [x] Cada PR ejecuta lint, tipos, pruebas y build.
- [ ] `main` publica automáticamente en Pages.
- [ ] Ninguna clave secreta aparece en el repositorio ni en el build.

## Siguiente paso

Cerrar la Fase 1 en el sitio publicado y empezar la Fase 2 con el módulo Airlines (configurar códigos y activar aerolíneas) y la gestión de membresías.
