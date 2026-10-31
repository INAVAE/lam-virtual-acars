# Estado del proyecto

Última actualización: 2026-10-29

## Fase 5, PIREP automático (construida; falta revisar un PIREP real en la web)

### Hecho

- Base de datos: `pireps`, `pirep_rule_definitions` (18 reglas), `pirep_scoring_rules` por aerolínea, `airline_settings.pirep_min_score` y la vista `pilot_statistics`. El cierre de una sesión completada genera el PIREP con faltas y puntaje; tarea de respaldo cada 10 minutos. `review_pirep` y `comment_pirep`; aceptar suma block time y ciclo a la aeronave. 44 pruebas pgTAP nuevas (199 en total).
- PIREP del vuelo real MXL106 (2026-10-28) generado al aplicar la migración: 90 puntos (toma firme −549 fpm medida con la versión anterior del conector, rodaje 32 kt), block 0:56, 207 NM, 2,068 kg; en revisión.
- Web: página PIREP (mis reportes, por revisar, todos), detalle con trayectoria y perfil de altitud, revisión y comentarios, reglas de puntuación en la aerolínea, horas y PIREP por revisar en el dashboard, enlace desde el historial de My Flights. Revisión visual: 28 pantallas sin errores (6 nuevas).
- Análisis del vuelo (2026-10-30): mapa Leaflet con OpenStreetMap, ruta por etapa o por altitud, gráficas de altitud, velocidad y combustible con cursor sincronizado y recuadro de datos.
- Combustible (2026-10-30): `flight_track_points.fuel_kg`, resumen en `pireps.metrics.fuel` (consumo por etapa, plan de SimBrief), regla opcional de reserva y panel en la web. Conector 0.1.16 (combustible en traza y aterrizaje, rodaje cada 3 s; 78 pruebas). 211 pruebas pgTAP.
- APU (2026-10-30): conector 0.1.17 registra encendido y apagado de la APU (88 pruebas); el PIREP muestra la franja de APU, minutos en marcha y combustible antes de los motores. 213 pruebas pgTAP.
- Actitud y ángulo de trayectoria (2026-10-30): conector 0.1.18 registra excursiones de alabeo y cabeceo (2 s o más); cuatro reglas nuevas (alabeo > 35°, cabeceo > +20° o < −7.5°, upset grave). La gráfica de altitud muestra el ángulo promedio de ascenso, descenso y aproximación. 226 pruebas pgTAP.
- Hora local (2026-10-30): zona horaria en el perfil (`profiles.time_zone`, Settings → Hora; automática = la del navegador) y hora principal UTC o local (clic en el reloj o en Settings). Toda hora Zulu muestra también la local: reloj, salidas programadas, horarios de ruta, PIREP, bitácora, mapa y gráficas; las fechas locales usan la zona elegida.
- Documento: `docs/architecture/pirep.md`.

### Para cerrar la Fase 5

- [ ] Revisar en la web el PIREP de MXL106 y aceptarlo (debe sumar 56 min y un ciclo a FVA106, hoy en 0, y a las horas del piloto).
- [ ] Volar un vuelo completo con el conector 0.1.18 y comprobar el PIREP generado al cerrar (flaps, tren, combustible por etapa, APU, actitud y rodaje denso en el mapa).
- [ ] Probar la aprobación automática en una aerolínea con el ajuste activado.

## Fase 4, LAM ACARS Connector (terminada; PMDG 737 verificado con el SDK en tierra)

### Hecho

- Base de datos: `acars_devices`, `acars_link_codes`, `flight_sessions`, `flight_positions_live`, `flight_track_points` (particionada por mes, particiones en `private`) y `flight_events`, con RLS de solo lectura para piloto y staff. Ingesta solo por funciones `acars_*` ejecutables por service_role. 42 pruebas pgTAP nuevas (154 en total).
- Edge Function `acars` (contrato v1): vinculación por código, token de dispositivo (solo hash en la base), sesiones reanudables, posición viva, traza, eventos y cierre, todo idempotente; límite de 240 unidades por minuto por dispositivo. Prueba de humo en producción: 8/8.
- Web: Settings → Dispositivos ACARS (vincular y revocar) y estado ACARS en My Flights (fase, altitud, velocidad, último contacto).
- Conector (`apps/acars-connector`, .NET 8): app de bandeja WPF, SimConnect por la API C con datos etiquetados, adaptador genérico, máquina de 15 fases, análisis de aterrizaje, cola SQLite, sincronización con reintentos, token con DPAPI, grabación de una lectura por segundo. 30 pruebas xUnit con un vuelo sintético y los ejemplos del contrato.
- CI: pruebas del núcleo en Linux, paquete para Windows (zip con SHA-256) y publicación opcional como versión descargable.
- Documentos: `docs/architecture/flight-phases.md`, `docs/integrations/acars-api.md`, ADR 0006.

### Para cerrar la Fase 4

- [x] Subir `SimConnect.dll` al borrador `deps-simconnect` y publicar la primera versión del conector (connector-v0.1.5, 2026-10-27).
- [x] Vincular el conector desde Settings (PC_IVAN, 2026-10-28).
- [x] Vuelo real con aeronave predeterminada (MXL106 MMMX-MMAA, 737-800, 2026-10-28): 21 eventos y 618 puntos sin huecos, aterrizaje en MMAA, aeronave disponible en MMAA. Ajustes en 0.1.9: fase Motores encendidos tras un pushback con motores apagados, aterrizaje con las variables tardías de MSFS (−294 fpm), tipo deducido del título y borrado de la posición viva.
- [x] Cortar internet a mitad del vuelo (2026-10-28, ascenso a FL120, 07:57:27-07:57:55 UTC): el evento generado sin conexión llegó 18 s después, secuencias 0-11 sin huecos ni duplicados, 95 puntos sin huecos.
- [x] Revocar el dispositivo desde la web con el vuelo en curso (07:58:06 UTC): el siguiente envío recibió 401 `device_revoked`, el conector pidió vincular de nuevo y la base no recibió nada más (último contacto 07:57:55).
- [x] Adaptadores Fenix, PMDG 737 y PMDG 777 (`docs/integrations/aircraft-adapters.md`). PMDG lee el bloque ClientData del SDK (desplazamientos calculados sobre los encabezados) y el conector activa `EnableDataBroadcast=1` con un botón. Flaps en grados y tren en los eventos de despegue y aterrizaje.
- [ ] Probar en vuelo: Fenix (L: del freno y calzos) y PMDG 737/777 (bloque del SDK), con la bitácora del conector.

### Criterios de aceptación

- [x] Un vuelo real en MSFS 2024 con aeronave predeterminada registra todas las fases en orden (la grabación real reproduce las 15 fases con 0.1.9; prueba xUnit).
- [x] Al cortar internet a mitad de vuelo no se pierde ni se duplica ningún evento (real, xUnit y pgTAP).
- [x] Revocar el dispositivo detiene la ingesta en el siguiente envío (real, pgTAP y xUnit).

## Fase 3, Reservas y SimBrief (verificada con datos reales el 2026-10-24)

### Hecho

- Base de datos: `pilot_type_ratings`, `flight_bookings`, `flights` y `simbrief_ofps` con RLS. Reservas solo por `book_flight` y `cancel_booking`, que validan todas las reglas en el servidor. Una reserva activa por aeronave (índice único), máximo por piloto, vencimiento automático cada 10 minutos (pg_cron) y antes de cada reserva. Política nueva por aerolínea: Exigir habilitación de tipo (activada por defecto).
- 46 pruebas pgTAP nuevas (112 en total), en verde en local y en Database CI.
- Edge Function `simbrief-ofp`: trae el último OFP del usuario de SimBrief del piloto y lo guarda con su token (sin clave secreta). La base calcula las diferencias contra la reserva.
- Web: Flight Booking (rutas activas, aeronaves con el motivo de bloqueo, callsign del piloto, reservas de la aerolínea para el staff), My Flights (tarjeta por vuelo, enlace a SimBrief Dispatch, importación y comparación del OFP, cancelación, historial), habilitaciones en Pilots, interruptor en Políticas y reservas activas en el dashboard.
- Revisión visual: 21 pantallas sin errores (8 nuevas).

### Para cerrar la Fase 3 (prueba con datos reales)

- [x] Otorgarte una habilitación en Pilots (lo puede hacer el superadministrador, incluso para sí mismo).
- [x] Reservar una ruta con una aeronave compatible y tu callsign (MXL106, MMBT a MMSD, A320).
- [x] Guardar tu usuario de SimBrief en Settings, generar el OFP con el botón Crear en SimBrief e importarlo en My Flights (ruta, FL360, combustible, pesos, alterno y PDF del OFP correctos).
- [ ] Generar un OFP con otro destino o tipo y comprobar que se avisa la diferencia.
- [ ] Cancelar la reserva y ver la aeronave Disponible de nuevo.

### Criterios de aceptación

- [x] Un piloto solo reserva combinaciones válidas y la base rechaza las inválidas (pgTAP: tipo, habilitación, carga/pasajeros, ubicación, disponibilidad, máximo, membresía, callsign).
- [x] Una aeronave no se reserva dos veces y cancelar o vencer la libera (pgTAP).
- [x] Un OFP real de SimBrief se importa y se avisan las diferencias (aviso real de matrícula distinta: MXL106 en la flota, G-FENX en SimBrief).

## Fase 2, Administración (terminada)

### Hecho

- Base de datos: aeropuertos, tipos de aeronave (25 iniciales), flota, rutas con distancia calculada, importación de rutas por CSV (`import_routes`), logotipos en Storage. 28 pruebas pgTAP nuevas (66 en total).
- Edge Function `import-airports`: importa OurAirports con los permisos del superadministrador que la llama.
- Web: Airlines (lista, ficha, logotipo, políticas, alta de aerolíneas), Pilots (solicitudes, roles, suspensión), Fleet (aeronaves y catálogo de tipos), Airports (búsqueda, filtros, importación, alta manual), Routes (filtros, edición, días, tipos permitidos, importación CSV con revisión previa), Administration (bitácora y superadministradores).
- Tipos de TypeScript generados desde el proyecto Supabase.
- CI: errores de compilación como anotaciones; revisión visual de 13 pantallas con sesión (datos simulados) después de cada publicación.

### Verificado con datos reales (2026-10-22)

- [x] Importación de OurAirports desde la web: 5,947 aeropuertos.
- [x] Alta de aeronave y de rutas en el sitio publicado.

### Pendiente menor

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

Cerrar la Fase 5 con un PIREP real revisado y seguir con la Fase 6 (mapa en vivo, Operations Center y estadísticas). Antes: PIREP automático a partir de eventos y traza, métricas, puntuación configurable, revisión y estadísticas del piloto.
