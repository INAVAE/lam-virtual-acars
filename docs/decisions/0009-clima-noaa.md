# ADR 0009: METAR y TAF del Aviation Weather Center (NOAA) con caché en Supabase

Estado: aceptada (2026-11-05)

## Contexto

Los pilotos piden ver el METAR de cualquier aeropuerto del mundo antes de despachar.
El Aviation Weather Center de NOAA (aviationweather.gov) ofrece METAR y TAF mundiales
gratis y sin llave, pero no permite CORS y limita a 100 consultas por minuto. Las
alternativas comerciales (CheckWX, AVWX) piden llave y tienen cuotas.

## Decisión

- La Edge Function `weather` (solo usuarios con sesión) recibe hasta 10 códigos ICAO, consulta `api/data/metar` y `api/data/taf` en formato JSON con un User-Agent propio y devuelve los datos ya reducidos.
- Caché en `public.weather_reports`, una fila por aeropuerto: el METAR se reutiliza 5 minutos y el TAF 15. Un aeropuerto sin datos también se guarda para no consultarlo en cada visita. Así, muchos pilotos pidiendo el mismo aeropuerto generan una sola consulta a NOAA.
- La tabla solo la toca la función con la clave secreta (RLS sin políticas, sin permisos para `anon` ni `authenticated`): nadie puede guardar un METAR falso desde el navegador.
- Si NOAA falla, la función responde con lo último guardado e indica el error (`upstream_error`).
- La lectura en español (viento, visibilidad en km o m, nubes, fenómenos, QNH en hPa e inHg, categoría de vuelo VFR/MVFR/IFR/LIFR de la FAA) se hace en la web (`apps/web/src/lib/weather.ts`, con pruebas).

## Consecuencias

- Sin costo ni llaves. Cada consulta a la función hace como máximo dos consultas a NOAA (METAR y TAF), y solo para los aeropuertos vencidos en la caché.
- La web vuelve a pedir cada 5 minutos mientras la página está abierta.
- El clima en vivo de MSFS 2024 puede diferir del METAR real; el METAR es la referencia para despachar y la que usan los controladores de IVAO.
