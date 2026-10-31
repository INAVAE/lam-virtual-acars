# PIREP automático

El PIREP se genera en la base de datos cuando LAM ACARS cierra una sesión como
completada. Usa los eventos y la traza que el conector ya envió; el conector manda
el cierre solo cuando todo lo anterior salió. Si la generación falla, el cierre no
falla. La tarea `lam-build-missing-pireps` (pg_cron, cada 10 minutos) genera los
PIREP que falten.

- **Vuelos abandonados:** no generan PIREP.
- **"Terminar vuelo" sin despegar ni aterrizar:** genera un PIREP con la falta grave "Vuelo incompleto".

## Qué se mide

| Dato | Fuente |
| --- | --- |
| Block time | `block_off` → `block_on`. Si falta alguno, se usan el inicio y el cierre de la sesión (marcado como estimado). Es el tiempo que suma al aprobarse. |
| Tiempo en vuelo | Primer `takeoff` → último `touchdown`. |
| Combustible | `fuel_kg` de `block_off` menos el de `block_on`. |
| Distancia | Suma ortodrómica entre los puntos de la traza. |
| Altitud máxima, rodaje máximo, IAS máxima bajo 10,000 ft | Traza (`flight_track_points`). |
| Aterrizaje | Último `touchdown`: VS, G, cabeceo, alabeo, rebotes, IAS, flaps y tren. |
| Desvío | El aeropuerto más cercano al cierre (10 NM) es distinto del destino, o no hay ninguno. |

## Puntuación

Cada PIREP empieza con 100 puntos. Resta la penalización de cada regla activa que se
cumple, con un mínimo de 0. LAM define el catálogo de reglas en
`pirep_rule_definitions`. Cada aerolínea ajusta las suyas en `pirep_scoring_rules`:
activación, umbral, penalización y si la falta es grave. Las aerolíneas nuevas reciben
todas las reglas al crearse. Los cambios se aplican a los PIREP que se generen después.

| Regla | Por omisión |
| --- | --- |
| Aterrizaje duro | VS ≤ −600 fpm: −20 |
| Aterrizaje firme | VS ≤ −400 fpm sin llegar a duro: −5 |
| Fuerza G | > 1.8 G: −10 |
| Rebote | −5 |
| Cabeceo al aterrizar | > 9°: −10 |
| Alabeo al aterrizar | > 5°: −5 |
| 250 kt bajo 10,000 ft | IAS > 260 kt: −5 |
| Rodaje rápido | GS > 30 kt: −5 |
| Sobrevelocidad | −10 |
| Pérdida | −15 |
| Aterrizaje bajo la reserva (combustible al aterrizar < reserva final del plan de SimBrief) | Desactivada; −10 al activarla |
| ACARS iniciado con motores encendidos | −5 |
| Pausa | Informativa (0) |
| Motor y al aire / toque y despegue | Informativa (0) |
| Cambio de aeronave | Grave (0) |
| Desvío | Grave (0) |
| Vuelo incompleto | Grave (−50) |
| Slew | Grave (−50) |
| Choque | Grave (−100) |

Cada regla cumplida queda en `pireps.findings` con su valor medido y el umbral que se usó.

## Combustible

- **Medición:** desde el conector 0.1.16, cada punto de traza lleva `fuel_kg` y el evento `touchdown` también.
- **Resumen:** `private.pirep_fuel_metrics` lo guarda en `pireps.metrics.fuel` y se conserva aunque la traza se borre:
  - niveles en calzos fuera, despegue, aterrizaje y calzos puestos;
  - consumo en rodaje de salida, en viaje, en rodaje de llegada y total;
  - consumo, tiempo y flujo (kg/h) por etapa: rodaje de salida, despegue y ascenso, crucero, descenso y aproximación, rodaje de llegada;
  - cargas detectadas (subidas de más de 50 kg);
  - plan de SimBrief en kg (bloque, viaje, reserva final y combustible al aterrizar aproximado).
- **APU (conector 0.1.17):** notas `{kind: "apu", state: start|stop|running}` cuando la APU queda en marcha o se apaga, con 5 s de estabilidad y la hora del cambio. `running` indica que ya estaba encendida al iniciar ACARS.
  - Genérico: `APU PCT RPM` ≥ 95 %.
  - PMDG 737: selector en ON/START y EGT de APU > 300 °C.
  - PMDG 777: `APURunning` del SDK.
  - El resumen agrega `apu` (minutos, arranques, primera y última hora) y `before_engines_kg`, el combustible gastado antes del primer arranque de motor.
- **Vuelos anteriores:** sin combustible en la traza, la gráfica se interpola entre los eventos y se marca como aproximada.
- **PIREP existentes:** recibieron su resumen al aplicar la migración.

## Revisión

El PIREP se acepta solo si la aerolínea tiene activada la aprobación automática, el
puntaje alcanza `pirep_min_score` (80 por omisión) y no hay ninguna falta grave. En
cualquier otro caso queda **En revisión**.

Revisa el jefe de operaciones o el administrador de la aerolínea con
`review_pirep(id, decisión, comentario)`:

- Rechazar exige un motivo.
- Una decisión no se cambia.
- Nadie revisa su propio PIREP, salvo el superadministrador.

Mientras el PIREP está en revisión, el piloto puede comentarlo con `comment_pirep`.

## Efectos al aceptar

- **Aeronave:** suma el block time a `total_minutes` y un ciclo a `cycles` si hubo aterrizaje.
- **Piloto:** las horas, vuelos, distancia y promedios salen de la vista `pilot_statistics`, que solo cuenta los PIREP aceptados. No hay contadores aparte que puedan desincronizarse.
- **Aeronave en un desvío:** queda donde aterrizó, porque el cierre ya la movió.

## Web

- **PIREP:** mis reportes con estadísticas, cola "Por revisar" (los más antiguos primero) y todos los de la aerolínea.
- **Detalle:** resumen, análisis del vuelo, despegue y aterrizaje, puntaje y faltas, revisión y bitácora de eventos.
- **Análisis del vuelo** (`flight-analysis-panel.tsx`):
  - **Mapa:** Leaflet con teselas de OpenStreetMap; en modo oscuro se invierten con CSS.
    - Zoom con la rueda y desplazamiento arrastrando; pantalla completa.
    - La ruta se colorea por etapa o por bandas de altitud.
    - Muestra los aeropuertos (salida, destino y llegada real si hubo desvío) y los eventos (calzos, motores, despegue, contacto con pista, motor y al aire, pausa, avisos).
    - Botones para encuadrar la ruta, la salida y el destino a zoom 14, donde se ven pista y rodaje.
  - **Gráficas:** altitud coloreada por etapa, IAS y GS, y combustible con la línea de la reserva del plan, en el tiempo.
    - Cinta y fondo por fase, con un punto en cada cambio de fase.
    - Marcadores de eventos con su recuadro; franja de APU en marcha sobre la gráfica de combustible.
  - **Cursor compartido:** pasar el puntero por la ruta o por las gráficas mueve un avión en el mapa (orientado por el rumbo) y el cursor en las gráficas.
    - El recuadro muestra hora Z, T+, fase, altitud, VS, IAS, GS, rumbo, distancia recorrida, combustible, flujo (kg/h), posición y el evento cercano.
    - Un clic fija el punto; las flechas recorren la traza.
  - **Extremos:** altitud, IAS, GS, ascenso y descenso máximos; un clic lleva al punto.
- **Panel Combustible:** niveles, consumo por etapa y plan de SimBrief contra real.
- **Airlines → aerolínea:** puntaje mínimo y reglas de puntuación (solo el administrador las cambia).
- **Dashboard y My Flights:** el dashboard muestra tus horas y los PIREP por revisar; el historial de My Flights enlaza a cada PIREP.
