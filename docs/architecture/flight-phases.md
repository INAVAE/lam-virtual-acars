# Fases del vuelo

LAM ACARS detecta las fases en el conector, con las lecturas del simulador (unas 6 por segundo). La máquina de estados está en `apps/acars-connector/src/LamAcars.Core/Engine/PhaseMachine.cs`; si cambia una regla, se cambia aquí y se agrega o ajusta una grabación en `packages/flight-engine/fixtures`.

## Principios

- **Tiempo de permanencia:** una condición debe sostenerse un tiempo mínimo antes de cambiar de fase, para no reaccionar a un pico aislado.
- **Histéresis:** los umbrales de entrada y salida son distintos (por ejemplo, el rodaje empieza arriba de 5 kt y el aterrizaje termina abajo de 30 kt).
- **Pausa y slew:** con el simulador en pausa o en slew, el reloj de permanencia se detiene.
- **Contacto con la pista:** es inmediato. La primera lectura en tierra después de volar marca el aterrizaje.

## Reglas

| De | A | Condición | Permanencia |
| --- | --- | --- | --- |
| Aeronave conectada | Prevuelo | En tierra con motores apagados | Inmediata |
| Aeronave conectada | Motores encendidos / Rodaje de salida | En tierra con motores (en rodaje si GS > 5 kt) | Inmediata |
| Aeronave conectada | Ascenso / Crucero / Descenso / Aproximación | En el aire (reanudación): por VS y altura sobre el terreno | Inmediata |
| Prevuelo | Motores encendidos | Al menos un motor con combustión | 5 s |
| Prevuelo | Pushback | Pushback activo o retroceso con motores apagados | 2 s |
| Motores encendidos | Pushback | `PUSHBACK STATE` ≠ 3 o retroceso (`VELOCITY BODY Z` < −0.8 ft/s) | 2 s |
| Motores encendidos | Rodaje de salida | En tierra, GS > 5 kt, sin pushback | 5 s |
| Motores encendidos | Prevuelo | Todos los motores apagados | 10 s |
| Pushback | Rodaje de salida | En tierra, GS > 5 kt, sin pushback, con motores | 5 s |
| Rodaje de salida | Despegue | En tierra, GS ≥ 40 kt | 2 s |
| Despegue | Ascenso inicial | En el aire (evento `takeoff` con la hora de la primera lectura en el aire) | 1 s |
| Despegue | Rodaje de salida | Despegue abortado: en tierra con GS < 30 kt | 10 s |
| Ascenso inicial | Ascenso | Altura sobre el terreno ≥ 1,500 ft | Inmediata |
| Ascenso | Crucero | VS entre −300 y 300 fpm, a menos de 4,000 ft del nivel del plan de SimBrief (sin plan: arriba de 10,000 ft o de 5,000 ft AGL) | 60 s |
| Ascenso / Crucero | Descenso | VS < −500 fpm | 30 s |
| Crucero | Ascenso | VS > 500 fpm (ascenso escalonado) | 60 s |
| Descenso | Aproximación | Altura sobre el terreno ≤ 3,000 ft | 5 s |
| Descenso | Ascenso | VS > 500 fpm | 60 s |
| Aproximación | Ascenso | Motor y al aire: VS > 500 fpm arriba de 300 ft AGL (evento `note` go_around) | 15 s |
| Cualquier fase en el aire | Aterrizaje | Primera lectura en tierra | Inmediata |
| Aterrizaje | Rodaje de llegada | En tierra con GS < 30 kt | 5 s |
| Aterrizaje | Ascenso | Toque y despegue: en el aire con VS > 300 fpm | 10 s |
| Rodaje de llegada | Motores apagados | Todos los motores apagados y GS < 2 kt | 5 s |
| Motores apagados | Rodaje de llegada | Motores encendidos de nuevo | 10 s |
| Motores apagados | Vuelo completado | Detenido con freno de estacionamiento (5 s) o detenido sin freno (60 s) | Según el caso |

Al llegar a **Vuelo completado**, el conector cierra la sesión sola (`session/end` con `completed`). El piloto también puede terminar o abandonar el vuelo desde el conector.

## Eventos

| Evento | Cuándo |
| --- | --- |
| `phase_change` | En cada transición. `data`: `from`, `to` y, si aplica, `reason` |
| `block_off` | Primer movimiento en tierra (rodaje o pushback) antes de despegar. Incluye el combustible |
| `takeoff` | Al confirmar el ascenso inicial, con la hora y los datos de la primera lectura en el aire |
| `touchdown` | 2.5 s después del contacto. Ver métricas abajo |
| `block_on` | Detenido con freno de estacionamiento en el rodaje de llegada o al apagar motores |
| `engine_start`, `engine_shutdown` | Cambio en el número de motores con combustión |
| `sim_paused`, `sim_resumed`, `slew`, `crash` | Estado del simulador |
| `overspeed`, `stall` | Aviso del simulador sostenido 2 s |
| `aircraft_changed` | El piloto cambió de aeronave a mitad del vuelo |
| `connection_lost`, `connection_restored` | Se perdió o volvió la conexión con el simulador |
| `note` | `go_around`, `touch_and_go` o `rejected_takeoff` |

## Métricas del aterrizaje

| Dato | Fuente |
| --- | --- |
| Velocidad vertical | `PLANE TOUCHDOWN NORMAL VELOCITY` (ft/s × 60, negativa). Si la aeronave no la expone, la VS más negativa de los 2 s anteriores al contacto (`vs_source` lo indica) |
| Fuerza G | Máxima de `G FORCE` entre 1 s antes y 2.5 s después del contacto |
| Cabeceo y alabeo | `PLANE TOUCHDOWN PITCH/BANK DEGREES` o, si faltan, los de la lectura del contacto. El cabeceo se reporta positivo con la nariz arriba |
| IAS, GS y rumbo | Lectura del contacto |
| Rebotes | Despegues de más de 0.3 s y nuevo contacto mientras dura el aterrizaje |

La velocidad vertical es un indicador del aterrizaje, nunca el único criterio (Fase 5).

## Traza y posición viva

| Fases | Un punto cada |
| --- | --- |
| Despegue, ascenso inicial, aproximación, aterrizaje | 2 s |
| Ascenso, descenso | 5 s |
| Pushback y rodajes | 10 s |
| Crucero | 30 s |
| Prevuelo, motores encendidos o apagados | 60 s |

También hay un punto en cada cambio de fase. La posición viva se envía cada 10 s (el servidor puede cambiar el intervalo al iniciar la sesión).

## Grabaciones de prueba

| Archivo | Contenido |
| --- | --- |
| `synthetic-mmmx-mmgl.jsonl` | Vuelo sintético de 65 min (generado por `packages/flight-engine/scripts/synthetic_flight.py`) que recorre las 15 fases en orden, con aterrizaje de −152 fpm y 1.25 G |

Cuando haya vuelos reales, el conector guarda una lectura por segundo en `%LOCALAPPDATA%\LamAcars\recordings`. Esas grabaciones se agregan aquí para probar con datos reales.
