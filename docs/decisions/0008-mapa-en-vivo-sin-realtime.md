# ADR 0008: Mapa en vivo por consulta periódica, sin Realtime

Estado: aceptada (2026-10-31)

## Contexto

La Fase 6 agrega Live Flights y el Operations Center. El conector envía la posición
de cada vuelo cada 10 s (`flight_positions_live`, una fila por vuelo) y la traza
por lotes. Supabase Realtime cobra por mensajes y conexiones, y en el plan
gratuito tiene cuotas bajas. Además, sus filtros por RLS sobre una tabla que se
reescribe cada 10 s multiplican el trabajo de la base.

## Decisión

- La web consulta `get_live_flights` cada 10 s, la misma frecuencia con la que llegan las posiciones, y solo mientras la pestaña está visible.
- Entre lecturas, la posición de cada avión se estima con su rumbo y su velocidad sobre el suelo (hasta 30 s).
- La traza del vuelo elegido (`get_live_flight_track`) se consulta cada 30 s.
- El Operations Center y las estadísticas se refrescan cada minuto.
- Todo se lee con funciones SECURITY DEFINER que comprueban la membresía:
  - Los pilotos ven los vuelos de sus aerolíneas.
  - El staff ve además las alertas.
  - El ranking es visible para todos los miembros, por decisión del usuario.

## Consecuencias

- Hay un retraso de hasta 10 s, el mismo que la frecuencia del conector, sin consumir cuota de Realtime.
- Con N pestañas abiertas son N/10 consultas por segundo. Si el volumen crece, se puede cambiar a Realtime (broadcast desde `acars_position`) sin tocar el conector.
- El mapa en vivo solo se ve con sesión iniciada. Si se abre al público, primero hay que revisar el volumen de teselas de OSM (ADR 0007).
