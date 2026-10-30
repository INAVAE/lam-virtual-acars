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
| ACARS iniciado con motores encendidos | −5 |
| Pausa | Informativa (0) |
| Motor y al aire / toque y despegue | Informativa (0) |
| Cambio de aeronave | Grave (0) |
| Desvío | Grave (0) |
| Vuelo incompleto | Grave (−50) |
| Slew | Grave (−50) |
| Choque | Grave (−100) |

Cada regla cumplida queda en `pireps.findings` con su valor medido y el umbral que se usó.

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
- **Detalle:** resumen, trayectoria y perfil de altitud (SVG propio), despegue y aterrizaje, puntaje y faltas, revisión y bitácora de eventos.
- **Airlines → aerolínea:** puntaje mínimo y reglas de puntuación (solo el administrador las cambia).
- **Dashboard y My Flights:** el dashboard muestra tus horas y los PIREP por revisar; el historial de My Flights enlaza a cada PIREP.
