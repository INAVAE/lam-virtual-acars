# Fase 7 (pendiente): mapa al estilo IVAO, Eventos y Tours

Estado: **pendiente**. Pedida por el usuario el 2026-10-31; se construye en la siguiente sesión.
Nada de esto está implementado todavía.

Orden sugerido:

1. Mapa: 7.1 → 7.2 → 7.3.
2. Tours (7.5), que es más acotado: una aerolínea, sus rutas.
3. Eventos (7.4), que cruza aerolíneas e incluye aprobación de registros.

Tours y Eventos comparten el color en el mapa y la etiqueta del vuelo activo.

---

## 7.1 Figura del avión según su tamaño y tipo

**Pedido:** los aviones del mapa se diferencian por tamaño y tipo, como en IVAO. Así se distingue un monomotor o un avión pequeño de un 737-800 o un A320, y de un 777 o un A380.

**Propuesta:**

- **Categoría de cada tipo:** sale de `aircraft_types`, que ya tiene `wake_category` (L/M/H/J) y `engine_type` (jet/turboprop/piston). Se agrega una columna `map_category` con valor calculado por omisión y editable por tipo:

  | Categoría | Ejemplos | Silueta |
  | --- | --- | --- |
  | `light` | C172, PA28, SR22 (pistón, L) | Ala alta o baja, hélice, la más pequeña |
  | `turboprop` | AT76, DH8D, C208 | Dos hélices, mediana-pequeña |
  | `regional_jet` | CRJ9, E190 | Reactor pequeño, motores en cola o bajo el ala |
  | `narrowbody` | A20N, B738, A321 | Bimotor de pasillo único |
  | `widebody` | B77W, B788, A359 | Bimotor grande |
  | `jumbo` | A388, B744 | Cuatrimotor, la más grande |

- **Tamaño en el mapa:** de 18 px (`light`) a 36 px (`jumbo`). Se escala un poco con el zoom.
- **SVG:** una silueta propia por categoría, sin copiar los íconos de IVAO. Se colorea por fase, como hoy.
- **Datos:** `get_live_flights` devuelve `map_category`. Si el tipo no tiene categoría, se usa `narrowbody`.

## 7.2 Trayectoria del avión elegido y ruta faltante

**Pedido:**

- Al hacer clic en un avión, su trayectoria volada queda visible con las fases, los indicadores y los parámetros, igual que en el mapa del PIREP.
- Desde su posición actual, una línea punteada roja marca la ruta faltante directa a su destino.
- Todo se actualiza hasta la llegada.

**Propuesta:**

- **Trayectoria volada:** se reutiliza lo del análisis del PIREP (`segmentsBy`, colores por fase, marcadores de eventos, recuadro con altitud, VS, IAS, GS, viento y fase).
  - `get_live_flight_track` hoy devuelve [lat, lon, alt, fase]. Hay que ampliarlo con GS, IAS, VS, rumbo, hora y viento, o crear una variante, para tener el recuadro completo.
- **Ruta faltante:** arco de círculo máximo desde la posición estimada actual hasta el destino, en rojo punteado. Se recalcula en cada tic (cada segundo con la posición estimada; cada 10 s con la lectura real).
- **Actualización:** traza cada 30 s, o pidiendo solo los puntos nuevos desde el último `seq`. Al aterrizar, la línea roja desaparece.

## 7.3 Selección de varios aviones

**Pedido:** con un clic se muestra la ruta de un avión y queda visible. Se pueden elegir varios aviones a la vez, muy parecido a IVAO.

**Propuesta:**

- Clic en un avión: lo agrega a la selección o lo quita. Cada uno conserva su traza y su ruta faltante.
- Cada avión elegido aparece como "chip" sobre el mapa, con su callsign y un botón para quitarlo, más un botón "Limpiar".
- El panel de detalle muestra el último elegido, con pestañas para cambiar entre los demás.
- La selección se guarda en la URL (`?flights=a,b,c`) para poder compartirla, y se recuerda en el navegador.
- Límite sugerido: 10 vuelos elegidos, para no saturar la consulta de trazas.

## 7.4 Eventos

**Pedido:**

- **Participantes:** se programa un evento en el que participan pilotos de diferentes aerolíneas, con diferentes aeronaves.
- **Escenarios:**
  1. Todos salen del mismo aeropuerto y llegan al mismo destino.
  2. Salen de cualquier aeropuerto hacia un mismo destino.
  3. Salen de un mismo aeropuerto hacia destinos diferentes.
- **Quién crea:** cualquier piloto de una aerolínea puede crear un evento; el administrador de su aerolínea lo aprueba antes de publicarse.
- **Registro:** los pilotos se inscriben, y el administrador del evento (quien lo creó) aprueba cada registro.
- **PIREP:** cuentan para el piloto en su aerolínea, como cualquier vuelo.
- **Mapa:** los aviones del evento tienen un color diferente y muestran el nombre, el folio y la duración del evento.

**Propuesta de modelo:**

- **`events`:**
  - `id`, `folio` (por ejemplo, EVT-2026-0001, único), nombre, descripción.
  - `scenario` (`same_origin_same_destination` | `any_origin_same_destination` | `same_origin_any_destination`).
  - Aeropuertos de salida y de destino según el escenario, y lista opcional de aeropuertos permitidos.
  - `starts_at` y `ends_at`.
  - Tipos de aeronave permitidos (opcional) y aerolíneas participantes (todas o una lista).
  - Banner, color, `created_by` y la aerolínea del creador.
  - Estado: borrador, enviado (espera la aprobación del administrador de la aerolínea del creador), publicado, en curso, terminado, cancelado o rechazado.
  - Quién aprobó la publicación y cuándo.
- **`event_registrations`:**
  - Evento, piloto, aerolínea con la que vuela, tipo de aeronave y, opcional, ruta o aeropuerto propuesto.
  - Estado: pendiente, aprobado, rechazado o retirado, con revisor y fecha.
- **Vuelo:**
  - `flights.event_id` y `pireps.event_id`.
  - La reserva puede elegir el evento si el piloto tiene un registro aprobado.
  - El origen y el destino se validan contra el escenario.
  - La ventana de tiempo se valida contra `starts_at` y `ends_at`.
- **Mapa:** `get_live_flights` devuelve `event` (folio, nombre, color, inicio y fin). Solo la figura del avión toma el color del evento; la trayectoria conserva los colores por fase. El recuadro muestra el nombre, el folio y la duración.
- **Página Eventos:** lista (próximos, en curso, pasados), detalle con participantes, inscripción y panel del creador para aprobar o rechazar. Al terminar, la tabla de resultados.

## 7.5 Tours

**Pedido:**

- **Quién los crea:** un piloto o un administrador de la aerolínea, con tours de rutas a cualquier parte del mundo y el número de legs que decida.
- **Aeronaves:** cada tour especifica los tipos de aeronave que pueden participar.
- **Inscripción:**
  - Cualquier piloto de cualquier aerolínea se puede inscribir al tour que desee.
  - Vuela con la flota de su propia aerolínea; el PIREP le cuenta como un vuelo normal de su aerolínea.
  - El creador del tour aprueba cada inscripción. El tour puede configurarse para aprobar solo las de pilotos de la misma aerolínea del tour.
- **Legs:**
  - Se configuran al crear el tour, que define si deben volarse en orden o en cualquier orden.
  - Un leg cuenta con su PIREP aceptado o en revisión.
  - El tour configura si se pueden volar legs siguientes sin que el anterior esté revisado, y cuántos como máximo pueden quedar sin revisión, para no acumular vuelos.
- **Mapa:** los aviones que vuelan un leg de tour tienen un color diferente. Al elegirlos en el mapa o verlos como vuelo activo, se indica el tour y el número de leg.

**Propuesta de modelo:**

- **`tours`:**
  - Aerolínea, `created_by` (piloto o administrador), código (por ejemplo, TOUR-MXL-01), nombre, descripción, imagen, color, tipos permitidos, fechas de vigencia opcionales y estado.
  - `ordered_legs` (bool): en orden o en cualquier orden.
  - `allow_unreviewed_progress` (bool) y `max_unreviewed_legs` (entero): cuántos legs puede volar el piloto con PIREP aún en revisión.
  - `auto_approve_same_airline` (bool): aprobar sin revisión las inscripciones de pilotos de la misma aerolínea.
- **`tour_legs`:** tour, número de leg, origen, destino, distancia, notas y, opcional, una ruta sugerida.
- **`tour_enrollments`:** tour, piloto, aerolínea con la que vuela; estado pendiente, aprobada, rechazada o retirada; quién la aprobó (el creador, o automática si es de la misma aerolínea y el tour lo permite).
- **`tour_progress`:**
  - Inscripción, leg y PIREP con que se voló.
  - Un leg cuenta con el PIREP aceptado o en revisión. Si el PIREP se rechaza o se archiva, el leg vuelve a estar pendiente.
  - Antes de reservar un leg se valida: el orden (si el tour lo exige) y el máximo de legs sin revisión (si el tour permite avanzar sin revisión; si no, el leg anterior debe estar aceptado).
- **Vuelo:**
  - `flights.tour_leg_id` y `pireps.tour_leg_id`.
  - La reserva ofrece los legs disponibles del piloto (el siguiente si el tour va en orden), con la aeronave de su aerolínea y los tipos permitidos.
  - Las rutas de un leg no tienen que existir en `routes`: son rutas propias del tour.
- **Mapa:** `get_live_flights` devuelve `tour` (código, nombre, color, leg actual y total). Solo la figura del avión toma el color del tour; la trayectoria conserva los colores por fase. El recuadro muestra "Tour X · Leg 3/12".
- **Página Tours:** lista por aerolínea, detalle con mapa de los legs, avance del piloto y ranking de quién lo completó.

---

## Decisiones del usuario (2026-10-31)

- **Eventos:**
  - Son 3 escenarios (el "2" del pedido fue un error de redacción).
  - Cualquier piloto de una aerolínea puede crear un evento, y el administrador de su aerolínea lo aprueba.
  - El creador del evento aprueba los registros.
- **Tours:**
  - Cualquier piloto de cualquier aerolínea se inscribe al tour que desee, vuela con su propia flota y el PIREP le cuenta como un vuelo normal de su aerolínea.
  - Los legs se configuran al crear el tour, que define si van en orden o en cualquier orden.
  - Un PIREP de tour cuenta aunque esté en revisión.
  - El tour configura si se puede avanzar sin la revisión del leg anterior y el máximo de legs sin revisión.
  - El creador del tour (piloto o administrador) aprueba las inscripciones; el tour puede aprobar solas las de pilotos de su misma aerolínea.
- **Mapa:** el color de evento o tour no reemplaza al de la fase; solo se colorea la figura del avión, no la ruta ni la trayectoria.

## Preguntas que quedan

1. **Eventos:**
   - **Aeronaves:** ¿el piloto vuela con su propia flota y una reserva normal, como en los tours? Supuesto por omisión: sí.
   - **Resultados:** ¿hay ranking o premios del evento (llegada más suave, puntaje)?
2. **Tours:**
   - ¿El tour que crea un piloto también lo aprueba el administrador de su aerolínea antes de publicarse, como los eventos?
   - ¿Hay insignia o reconocimiento al completar el tour?
3. **Mapa:** ¿qué color lleva un vuelo que es de evento y de tour a la vez? Supuesto por omisión: el del evento, con ambas etiquetas en el recuadro.
