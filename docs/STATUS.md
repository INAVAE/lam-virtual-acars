# Estado del proyecto

Última actualización: 2026-11-06 (cuentas de la plataforma)

## «Cambio de aeronave» falso con el A380 de iniBuilds (2026-11-07)

- PIREP-2026-00014 y 00019 (QTR783/784, Jesus Medina) marcaban la falta grave «Cambio de aeronave» aunque el avión fue el mismo todo el vuelo: el A380 cambia su matrícula ATC (ATC ID) un par de minutos después de cargar y el conector tomaba cualquier cambio de identidad como cambio de avión.
- `build_pirep` solo cuenta el evento si el título es distinto al de la sesión (migración `aircraft_change_same_title`, prueba 023). La falta del 00019 quedó anulada por el sistema con el motivo; el 00014 ya estaba anulado a mano.
- Conector 0.1.27: solo emite `aircraft_changed` cuando cambia el título, y la primera lectura de la aeronave (p. ej. al reabrir el conector a medio vuelo) ya no cuenta.

## Cuentas de la plataforma y revocar el acceso (2026-11-06)

- **Administration → Cuentas** (superadministrador): todas las cuentas con número LAM, correo, alta, último acceso, PIREP y aerolíneas con el estado de cada membresía; filtros «Sin aerolínea», «Con solicitud de ingreso pendiente» y «Con acceso revocado». Resuelve que quien ya entró pero no pidió aerolínea no aparecía en ningún lado. RPC `list_platform_accounts`.
- **Revocar acceso / Restaurar acceso:** `set_account_access` pone `profiles.account_status = 'suspended'` (que ya bloqueaba todas las funciones de aerolínea y el conector), guarda motivo, fecha y quién lo hizo (`suspended_at`, `suspended_by`, `suspension_note`) y cancela las reservas sin iniciar. La Edge Function `account-requests` (acciones `revoke` y `restore`) además bloquea el inicio de sesión en Supabase Auth (`ban_duration`). La web muestra «Tu acceso fue revocado» a una sesión abierta. Nadie se revoca a sí mismo; a otro superadministrador primero se le quita el rol. Queda en la bitácora.
- Migración `platform_accounts`, prueba 022 (15); 501 pruebas pgTAP. Capturas 57 y 58.

## Cuentas de piloto con aprobación previa (2026-11-06)

- Ya nadie crea su propia cuenta. «Solicitar cuenta de piloto» (`/registro`, sin contraseña) llama a `request_pilot_account` y guarda una fila en `account_requests` (nombre, correo, aerolínea de interés opcional, VID de IVAO y mensaje). No crea usuario ni manda correo, responde igual si el correo ya existe y tiene un freno de 30 solicitudes por hora en total, más un campo trampa para robots.
- El superadministrador revisa en **Administration → Solicitudes de cuenta** (el Dashboard avisa si hay pendientes): «Aprobar y enviar invitación», «Rechazar» (nota interna), «Reenviar invitación» y «Invitar a un piloto» directamente. La Edge Function `account-requests` llama a los RPC con el token de quien pulsa (`approve_account_request`, `reject_account_request`, `create_account_invitation`) y manda la invitación de Supabase Auth con la clave de servicio (`inviteUserByEmail`); anota el resultado con `record_account_invitation`.
- El piloto abre la invitación, crea su contraseña en `/restablecer?bienvenida=1` y entra; después solicita ingreso a una aerolínea como antes.
- **Candado:** el disparador `before_auth_user_created` en `auth.users` (`private.guard_auth_signup`) rechaza cualquier usuario nuevo que Supabase Auth intente crear sin una solicitud aprobada para ese correo, incluido el registro directo por la API. Las cuentas existentes no cambian.
- Migración `account_requests`, prueba 021 (18); 486 pruebas pgTAP. ADR 0012. Capturas 55, 56, m-09 y m-10.

## Distancia y tiempo por la ruta del plan (2026-11-06)

- Live Flights mide lo que falta por la ruta del plan de SimBrief (proyección sobre el tramo más cercano, con penalización si el rumbo no coincide; en línea recta si el avión está a más de 100 NM de la ruta). El tiempo al destino usa la velocidad sobre el suelo en crucero y la limita a 300 kt de 100 a 30 NM y a 220 kt en las últimas 30 NM. Con QTR783 el error bajó de 10–15 a 1–3 minutos.

## Vuelo directo y datos del vuelo en Live Flights (2026-11-05)

- **Flight Booking → «Reservar un nuevo vuelo directo»** (junto a «Registrar ruta»): origen, destino, número de vuelo, operación, aeronave (`direct_aircraft_options`) y callsign, sin ruta registrada. `book_direct_flight` deja el vuelo sin `route_id` o, con «Registrar la ruta de este vuelo», llama a `register_route` y `book_flight` en la misma transacción (ruta pendiente; si la reserva falla no queda ruta). Tras reservar, la misma ventana muestra «Crear en SimBrief» e «Importar de SimBrief» con el resumen del OFP. My Flights marca «Vuelo directo».
- Política nueva `airline_settings.allow_direct_flights` (activada por omisión; el administrador siempre puede). Migración `direct_flights`, prueba 020 (16); 468 pruebas pgTAP. Captura 54.
- **Live Flights:** el detalle del vuelo muestra la ruta del plan de SimBrief en texto (`get_live_flight_route.route`); cada tarjeta de la lista muestra NM recorridas, por volar y totales, y tiempo en curso, al destino y total estimado.

## APU no informada por la aeronave (2026-11-05)

- QTR783 (A380-800 EA Basic) y el A300 PW de Hugo dejan la APU fija en «encendida» todo el vuelo. El PIREP ahora la marca «Sin dato» (`apu.unreliable`, migración `apu_unreliable`, prueba 019) y el conector 0.1.24 solo exige apagarla si la vio apagada alguna vez. PIREP 00005 y 00007 corregidos. Detalle en `docs/integrations/aircraft-adapters.md`. 452 pruebas pgTAP.

## Centro de ayuda, manual en PDF e incidencias (2026-11-05)

- Botón de ayuda (?) en la barra superior (y «Help» en el menú) con el contador de reportes sin revisar para el staff. Página `/help`: Guía paso a paso (19 capítulos, cada uno con su público), Preguntas frecuentes, Si algo falla, Reportar una incidencia, Reportes recibidos (staff) y Novedades, con búsqueda sin acentos.
- **Manual en PDF** (`manual/Manual-LAM-Virtual-ACARS.pdf`, enlazado también en la página pública): lo genera `scripts/build-manual.mjs` en cada publicación con el mismo contenido (`apps/web/src/content/help-content.ts`) y capturas numeradas de la web con datos simulados (`m-*` de `scripts/visual-check.mjs`). Si falla, se publica el anterior.
- **Incidencias:** `support_tickets` (folio INC-AAAA-NNNNN, firma, tipo, aerolínea opcional, módulo, folio relacionado, contexto técnico, estado y respuesta). Atiende el staff de la aerolínea o el superadministrador si es de la plataforma; sin borrado; 10 por hora. ADR 0011. 448 pruebas pgTAP (018 nueva, 20). Capturas 50–53 y m-01 a m-08.
- La web muestra su versión (`VITE_APP_VERSION`, número de publicación y commit) en la ayuda y la adjunta a cada reporte.
- **Regla:** todo cambio visible para el usuario actualiza `help-content.ts` (capítulo y una línea en `MANUAL_CHANGES`).

## Mapa en vivo al estilo Webeye (2026-11-05)

- Interruptores de capas bajo el mapa (se recuerdan en el navegador): **Etiquetas** (logo y callsign fijos; solo callsign al alejar), **Ruta del plan** (puntos del navlog de SimBrief del vuelo elegido), **Radar** (RainViewer), **METAR** (categoría de vuelo en origen y destino) y **Control IVAO** (posiciones conectadas por tipo: DEL/GND/TWR en el aeropuerto, APP/DEP en círculo, CTR/FSS sombreando la FIR; panel con frecuencia, tiempo en línea y ATIS).
- Fuentes y condiciones legales en ADR 0010: Whazzup público de IVAO sin datos personales, límites de FIR del VATSpy Data Project (CC BY-SA 4.0, sin cambios y con crédito), RainViewer para uso personal y educativo.
- Servidor: `simbrief_ofps.navlog` y `get_live_flight_route`; `private.ivao_state`, `private.ivao_refresh()` (pg_cron + pg_net cada 30 s, solo si alguien mira el mapa) y `get_ivao_atc()`. 428 pruebas pgTAP (017 nueva). Captura 49.
- La ruta del plan aparece en los planes importados desde el 2026-11-05 (volver a importar el plan para los vuelos ya reservados).

## Clima: METAR y TAF (2026-11-05)

- **Weather** (menú Operación): METAR y TAF de cualquier aeropuerto del mundo, hasta 10 a la vez. Búsqueda en el catálogo o por código ICAO, sugerencias de los vuelos reservados, lista guardada en el navegador, actualización cada 5 minutos.
- Cada tarjeta muestra el METAR original, su hora y antigüedad (aviso si pasa de 90 minutos), la categoría de vuelo y la lectura en español (viento con flecha y ráfagas, visibilidad, QNH en hPa e inHg, temperatura y rocío, nubes, fenómenos), y el TAF con sus periodos.
- **My Flights** muestra el METAR de origen y destino de cada vuelo por iniciar; la ventana de reserva de **Flight Booking**, el clima actual de la ruta.
- Fuente: Aviation Weather Center de NOAA, vía la Edge Function `weather` con caché en `weather_reports` (ADR 0009). Capturas 47 y 48.

## Flota libre y rutas de pilotos (2026-11-04)

Retroalimentación de los pilotos: las habilitaciones y la disponibilidad de la flota complicaban el uso. Todo queda como opción en Airlines → Políticas operacionales, para no perder lo construido:

- **Exigir habilitación de tipo** (ya existía; activado en las 5 aerolíneas). Apagado: cada piloto vuela el tipo que prefiera; Pilots oculta la columna y el botón, y las habilitaciones guardadas se conservan.
- **Controlar la disponibilidad de la flota** (nuevo, activado). Apagado: cualquier piloto reserva cualquier matrícula aunque otro la tenga reservada o en vuelo; se ignoran Mantenimiento, Fuera de servicio y "aeronave en el origen"; el sistema deja de cambiar el estado. Fleet y el Operations Center solo listan las aeronaves (sin estado, base ni ubicación). Aplica también a tours y eventos. La regla de una reserva activa por aeronave pasó del índice único a las funciones de reserva.
- **Los pilotos registran rutas** (nuevo, activado). En Flight Booking → Registrar ruta: número de vuelo (el de SimBrief, único en la aerolínea), origen, destino, operación y duración opcional. La ruta nace **pendiente**, se puede reservar y pasa sola a **activa** con el primer PIREP aceptado que llegó a su destino (`pireps_activate_route`). Las del staff nacen activas. El autor puede quitar su ruta pendiente sin reservas activas; máximo 20 pendientes por piloto y aerolínea. Si ya existe una ruta con el mismo origen y destino, el formulario la muestra.
- **Tipos de aeronave por ruta opcionales** (formulario e importación CSV); Rutas y Flight Booking muestran "Volada con" los tipos de los vuelos completados (`get_route_type_usage`).
- Migraciones `free_fleet_pilot_routes_*`, `import_routes_optional_types` y `ops_fleet_multiple_bookings`. 414 pruebas pgTAP (016 nueva, 33). Capturas 43–46.

## Pruebas con pilotos (2026-11-03)

- **A340-600 (PIREP-2026-00004 y 00006):** la aeronave alternaba la combustión de los 4 motores en cada lectura; la fase se quedó en pushback y la cola de eventos dejó atrás la traza. Corregido en el conector 0.1.22 (motor en marcha por combustión o N2, filtro de apagado de 3 s, tope de eventos repetidos, envío que no deja esperando a la traza) y en el servidor (máximo 64 eventos de motor por sesión). Detalle en `docs/integrations/aircraft-adapters.md`.
- **Folio de PIREP:** `pireps.folio` (PIREP-AAAA-NNNNN), consecutivo; los 7 existentes se numeraron por fecha. Se ve en la lista (con búsqueda), en el detalle (con botón para copiar) y en My Flights.
- **Seleccionar todos / Ninguno** en las listas de tipos de aeronave (rutas, habilitaciones, tours y eventos) y de aerolíneas de un evento.
- **Carga de combustible (PIREP-2026-00006):** la carga en tierra antes de los calzos fuera (19,318 → 79,118 kg en preflight) se contaba como recarga. Ahora se informa aparte (`preflight_loaded_kg`) sin afectar el puntaje; solo lo agregado después de los calzos fuera es `refueled_kg` y activa la regla grave nueva `fuel_added_after_pushback` (−20, umbral 100 kg) en todas las aerolíneas. Los PIREP existentes recalcularon su resumen; puntaje y faltas sin cambio. PIREP-2026-00005 sí muestra 51,769 kg después de los calzos fuera: la sesión quedó abierta y tomó una muestra del vuelo siguiente (00007).
- 380 pruebas pgTAP (014 y 015 nuevas).

## Fase 7, mapa al estilo IVAO, Eventos y Tours (construida el 2026-10-31; detalle en docs/roadmap/fase-7-mapa-eventos-tours.md)

- [x] 7.1 Figura del avión según su categoría (`aircraft_types.map_category`: ligero, jet ejecutivo, turbohélice, regional, pasillo único, fuselaje ancho, cuatrimotor), con tamaño de 18 a 37 px. Se calcula sola y el superadministrador la cambia en Fleet → Tipos.
- [x] 7.2 Al elegir un avión: su trayectoria completa por fases con recuadro de parámetros y marcadores (`get_live_flight_trace`, por partes cada 15 s) y la ruta faltante en rojo punteado hasta el destino, que se oculta al aterrizar. Perfil del vuelo enfocado como en el PIREP.
- [x] 7.3 Selección de hasta 10 aviones con chips, foco y "Limpiar"; queda en la URL (`?flights=`) y en el navegador.
- [x] 7.5 Tours: `tours`, `tour_legs`, `tour_enrollments`, `pilot_badges`, bucket `tour-badges`; creación, aprobación del administrador, inscripción de cualquier aerolínea (aprobación del creador o automática para la misma aerolínea), reserva de legs con la flota propia, orden y máximo de legs en revisión, repetición si el PIREP se rechaza, insignia al terminar (en Settings y Dashboard). 37 pruebas pgTAP.
- [x] 7.4 Eventos: `events` (folio EVT-AAAA-NNNN) y `event_registrations`; tres escenarios, aprobación del administrador, registros aprobados por el creador, reservas desde 12 h antes, ranking por el criterio del premio (mejor puntaje, toma más suave, primero en llegar, mayor distancia). 30 pruebas pgTAP.
- [x] Exclusividad evento/tour al inscribirse; en el mapa la figura toma el color del evento o del tour y muestra folio y horario, o tour y leg. My Flights etiqueta los vuelos de tour y de evento.
- 364 pruebas pgTAP. Capturas 31, 31b y 36–42.
- Verificado con un vuelo real (2026-10-31): evento EVT-2026-0001 "Puente Aéreo MMMX - MMAA - Cargo" (escenario 1, mejor puntaje). Registro aprobado, reserva FDX022 con la flota de MXL (B738, 737-800BCF), 651 puntos de traza con viento, PIREP de 100 puntos sin faltas, toma −312 fpm, block 0:50, 197 NM; aceptado en revisión (MXL no tiene aprobación automática) y primer lugar del ranking.
- Pendiente: probar con un vuelo real un leg de tour.

## Fase 5, PIREP automático (construida; falta revisar un PIREP real en la web)

### Hecho

- Base de datos: `pireps`, `pirep_rule_definitions` (18 reglas), `pirep_scoring_rules` por aerolínea, `airline_settings.pirep_min_score` y la vista `pilot_statistics`. El cierre de una sesión completada genera el PIREP con faltas y puntaje; tarea de respaldo cada 10 minutos. `review_pirep` y `comment_pirep`; aceptar suma block time y ciclo a la aeronave. 44 pruebas pgTAP nuevas (199 en total).
- PIREP del vuelo real MXL106 (2026-10-28) generado al aplicar la migración: 90 puntos (toma firme −549 fpm medida con la versión anterior del conector, rodaje 32 kt), block 0:56, 207 NM, 2,068 kg; en revisión.
- Web: página PIREP (mis reportes, por revisar, todos), detalle con trayectoria y perfil de altitud, revisión y comentarios, reglas de puntuación en la aerolínea, horas y PIREP por revisar en el dashboard, enlace desde el historial de My Flights. Revisión visual: 28 pantallas sin errores (6 nuevas).
- Análisis del vuelo (2026-10-30): mapa Leaflet con OpenStreetMap, ruta por etapa o por altitud, gráficas de altitud, velocidad y combustible con cursor sincronizado y recuadro de datos.
- Combustible (2026-10-30): `flight_track_points.fuel_kg`, resumen en `pireps.metrics.fuel` (consumo por etapa, plan de SimBrief), regla opcional de reserva y panel en la web. Conector 0.1.16 (combustible en traza y aterrizaje, rodaje cada 3 s; 78 pruebas). 211 pruebas pgTAP.
- APU (2026-10-30): conector 0.1.17 registra encendido y apagado de la APU (88 pruebas); el PIREP muestra la franja de APU, minutos en marcha y combustible antes de los motores. 213 pruebas pgTAP.
- Actitud y ángulo de trayectoria (2026-10-30): conector 0.1.19 registra excursiones de alabeo y cabeceo (2 s o más); cuatro reglas nuevas (alabeo > 35°, cabeceo > +20° o < −7.5°, upset grave). La gráfica de altitud muestra el ángulo promedio de ascenso, descenso y aproximación. 226 pruebas pgTAP.
- Fase 6 (2026-10-31):
  - Live Flights: mapa en vivo cada 10 s con posición estimada entre lecturas, traza y viento (ADR 0008).
  - Statistics: aerolínea, ranking y la pestaña Aterrizajes, con promedios y proporciones de los parámetros de la toma por piloto.
  - Operations Center: vuelos activos con alertas, salidas y reservas, cola de PIREP, flota y rendimiento de pilotos.
  - Viento en la traza (conector 0.1.21), en las gráficas, el mapa y el PIREP; cizalladura a baja altura.
  - El vuelo se cierra con la APU apagada.
  - El conector avisa si hay una versión nueva.
  - Rodaje sin la aceleración de una salida directa.
  - Anulación de faltas en revisión.
  - Archivo y restauración de PIREP.
  - 281 pruebas pgTAP.
- Hora local (2026-10-30): zona horaria en el perfil (`profiles.time_zone`, Settings → Hora; automática = la del navegador) y hora principal UTC o local (clic en el reloj o en Settings). Toda hora Zulu muestra también la local: reloj, salidas programadas, horarios de ruta, PIREP, bitácora, mapa y gráficas; las fechas locales usan la zona elegida.
- Documento: `docs/architecture/pirep.md`.

### Para cerrar la Fase 5

- [ ] Revisar en la web el PIREP de MXL106 y aceptarlo (debe sumar 56 min y un ciclo a FVA106, hoy en 0, y a las horas del piloto).
- [ ] Volar un vuelo completo con el conector 0.1.21 y comprobar el PIREP generado al cerrar (flaps, tren, combustible por etapa, APU, actitud, viento, cierre con APU apagada y rodaje denso en el mapa).
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

Fase 7 (siguiente sesión): mapa al estilo IVAO (figuras por tipo, trayectoria y ruta faltante, selección múltiple), Tours y Eventos. Antes: probar la Fase 6 con un vuelo real usando el conector 0.1.21.
