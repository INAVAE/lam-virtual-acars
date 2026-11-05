# ADR 0010: Capas del mapa en vivo (plan de SimBrief, control de IVAO, radar y METAR) y su uso legal

Estado: aceptada (2026-11-05)

## Contexto

Los pilotos piden que el mapa en vivo se parezca al Webeye de IVAO: etiqueta fija con
logo y callsign, ruta del plan de vuelo con sus puntos, clima y control activo de IVAO
por tipo de posición. El usuario pidió usar solo fuentes públicas y cuidar los temas
legales.

## Fuentes y condiciones

| Capa | Fuente | Condiciones que aplicamos |
| --- | --- | --- |
| Ruta del plan | Navlog del OFP de SimBrief que el piloto importa (`simbrief_ofps.navlog`) | Datos del propio plan del piloto; solo los ven los miembros de su aerolínea (`get_live_flight_route`). |
| Control de IVAO | Whazzup v2 público, `api.ivao.aero/v2/tracker/whazzup` (se actualiza cada 15 s) | Los reglamentos de IVAO tratan los datos de sus miembros como confidenciales y solo sus usuarios ven los vuelos de otros. Por eso **no guardamos ni mostramos** VID, nombre, rango ni el tráfico de pilotos: solo callsign de la posición, tipo, frecuencia, coordenadas, hora de conexión y ATIS. Una sola descarga cada 30 s, solo si alguien abrió el mapa en los últimos 2 minutos, con User-Agent identificable. No usamos logotipos ni marcas de IVAO; se da crédito en el mapa. |
| Límites de FIR | [VATSpy Data Project](https://github.com/vatsimnetwork/vatspy-data-project), licencia CC BY-SA 4.0 | `Boundaries.geojson` se sirve **sin cambios** con su `LICENSE`; `fir-index.json` es un derivado de `VATSpy.dat` y se comparte con la misma licencia (`apps/web/public/data/vatspy/README.md`). Crédito y licencia en el mapa y bajo él. |
| Radar | RainViewer Weather Maps API (`api.rainviewer.com/public/weather-maps.json`, teselas en `tilecache.rainviewer.com`) | Desde 2026: uso personal y educativo, zoom máximo 7, 100 consultas por minuto por IP, esquema de color Universal Blue (2). LAM Virtual es una aerolínea virtual sin fines de lucro. Cada navegador pide sus teselas; se da crédito a RainViewer. |
| METAR | NOAA Aviation Weather Center (ADR 0009) | Dominio público; caché en Supabase. |

Todo el mapa es solo para simulación, no para navegación real.

## Decisión técnica

- **Etiquetas:** cada avión lleva logo y callsign; con zoom menor a 5 solo el callsign.
- **Ruta del plan:** `simbrief-ofp` guarda hasta 400 puntos (ident, tipo, lat, lon, aerovía). El mapa la dibuja punteada con el nombre de cada punto (sin TOC, TOD ni coordenadas sueltas) y, si hay plan, oculta la línea directa al destino.
- **IVAO:** `pg_cron` ejecuta `private.ivao_refresh()` cada 30 s con `pg_net`; procesa la respuesta anterior, guarda la lista reducida en `private.ivao_state` y borra la respuesta completa. `get_ivao_atc()` la entrega a cualquier usuario con sesión y marca que alguien mira el mapa. En el mapa: DEL, GND y TWR como círculo pequeño en el aeropuerto; APP y DEP como círculo de 55 km; CTR y FSS sombreando su FIR (o un círculo si no hay límite). Al hacer clic, panel con posición, frecuencia, tiempo en línea y ATIS.
- **Radar y METAR:** capas opcionales; el radar se dibuja bajo el control y los aviones con 65 % de opacidad.
- La CSP permite `api.rainviewer.com` (connect) y `tilecache.rainviewer.com` (img).

## Consecuencias

- Sin llaves ni costos. Si IVAO otorga una llave de API, se podrán agregar los polígonos exactos de sus posiciones y, con su autorización, el nombre del controlador.
- Si alguna fuente cambia sus condiciones, la capa se apaga desde la web sin tocar lo demás.
