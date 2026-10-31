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
  - Banner, color, `created_by` y estado: borrador, publicado, en curso, terminado, cancelado.
- **`event_registrations`:**
  - Evento, piloto, aerolínea con la que vuela, tipo de aeronave y, opcional, ruta o aeropuerto propuesto.
  - Estado: pendiente, aprobado, rechazado o retirado, con revisor y fecha.
- **Vuelo:**
  - `flights.event_id` y `pireps.event_id`.
  - La reserva puede elegir el evento si el piloto tiene un registro aprobado.
  - El origen y el destino se validan contra el escenario.
  - La ventana de tiempo se valida contra `starts_at` y `ends_at`.
- **Mapa:** `get_live_flights` devuelve `event` (folio, nombre, color, inicio y fin). El avión se dibuja con el color del evento; el recuadro muestra el nombre, el folio y la duración.
- **Página Eventos:** lista (próximos, en curso, pasados), detalle con participantes, inscripción y panel del creador para aprobar o rechazar. Al terminar, la tabla de resultados.

## 7.5 Tours

**Pedido:**

- **Quién los crea:** cada aerolínea crea sus propios tours de rutas a cualquier parte del mundo, con el número de vuelos (legs) que decida.
- **Aeronaves:** cada tour especifica los tipos de aeronave que pueden participar.
- **Mapa:** los aviones que vuelan un leg de tour tienen un color diferente. Al elegirlos en el mapa o verlos como vuelo activo, se indica el tour y el número de leg.

**Propuesta de modelo:**

- **`tours`:** aerolínea, código (por ejemplo, TOUR-MXL-01), nombre, descripción, imagen, color, tipos permitidos, fechas de vigencia opcionales y estado.
- **`tour_legs`:** tour, número de leg, origen, destino, distancia, notas y, opcional, una ruta sugerida.
- **`tour_progress`:**
  - Piloto, tour, leg actual, legs completados (con su PIREP), fecha de inicio y de fin.
  - Un leg cuenta cuando su PIREP se acepta.
- **Vuelo:**
  - `flights.tour_leg_id` y `pireps.tour_leg_id`.
  - La reserva ofrece el siguiente leg del piloto con los tipos permitidos.
  - Las rutas de un leg no tienen que existir en `routes`: son rutas propias del tour.
- **Mapa:** `get_live_flights` devuelve `tour` (código, nombre, color, leg actual y total). El recuadro muestra "Tour X · Leg 3/12".
- **Página Tours:** lista por aerolínea, detalle con mapa de los legs, avance del piloto y ranking de quién lo completó.

---

## Preguntas abiertas para la siguiente sesión

1. **Eventos:**
   - **Escenarios:** el pedido dice "2 escenarios" pero describe 3. ¿Son los tres? ¿Hace falta un cuarto, cualquier origen hacia cualquier destino?
   - **Creadores:** ¿quién puede crear eventos? ¿Solo el superadministrador, o también el administrador o el jefe de operaciones de cada aerolínea, con invitación a otras aerolíneas?
   - **Aeronaves:** ¿el piloto vuela con una aeronave de su flota (reserva normal) o puede volar cualquier tipo permitido sin matrícula de la flota?
   - **Resultados:** ¿hay ranking o premios del evento (llegada más suave, puntaje)?
2. **Tours:**
   - ¿Los legs se vuelan en orden obligatorio?
   - ¿Un leg cuenta con el PIREP aceptado, o también en revisión?
   - ¿Hay insignia o reconocimiento al completar el tour?
3. **Mapa:**
   - ¿Los colores de evento y tour reemplazan el color por fase de la figura, o se agrega un contorno o halo y se conserva la fase?
   - ¿Qué pasa con un vuelo que es de evento y de tour a la vez?
