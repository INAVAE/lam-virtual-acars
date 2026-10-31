# Contrato ACARS v1

API entre LAM ACARS Connector y la plataforma. La sirve la Edge Function `acars`:

```
https://fnsfgjtmwfiizofsjajm.supabase.co/functions/v1/acars/v1/<ruta>
```

- **Esquemas:** Zod en `packages/validation/src/acars.ts`. La Edge Function usa una copia idéntica (`supabase/functions/acars/contract.ts`; Web CI verifica que no difieran).
- **Ejemplos:** `docs/integrations/acars-v1-examples/*.json`. Los valida Zod (Vitest) y los modelos de C# deben producir los mismos campos (xUnit). Así el contrato no se duplica a mano sin control (ver [ADR 0006](../decisions/0006-conector-simconnect.md)).
- **Formato:** JSON en snake_case; marcas de tiempo ISO 8601 con zona (UTC).

## Autenticación

| Ruta | Autenticación |
| --- | --- |
| `GET /health`, `POST /link/start`, `POST /link/poll` | Ninguna |
| Todas las demás | `Authorization: Bearer lamd_…` (token de dispositivo) |

El token es opaco (`lamd_` + 43 caracteres base64url, 256 bits). El servidor guarda solo su SHA-256. El conector lo guarda cifrado con DPAPI. Un dispositivo revocado recibe `401 device_revoked` en el siguiente envío.

## Rutas

| Ruta | Cuerpo | Respuesta |
| --- | --- | --- |
| `GET /health` | — | `{ ok, api, version, time }` |
| `POST /link/start` | `{ device_name, app_version }` | `{ code: "K7QF-2M9P", poll_secret, expires_at, poll_interval_s }` |
| `POST /link/poll` | `{ code, poll_secret }` | `{ status: "pending" }` o, una sola vez, `{ status: "approved", token, device_id, pilot }` |
| `GET /me` | — | `{ device, pilot, active_session, flights[] }`: reservas activas y vuelo en curso, con origen, destino, aeronave, callsign y resumen del OFP |
| `POST /session/start` | `{ flight_id, aircraft: { title, icao, registration }, client_version }` | `{ session_id, resumed, phase, last_event_seq, last_point_seq, flight, config }` |
| `POST /position` | `{ session_id, position }` | `{ ok }` |
| `POST /track-batch` | `{ session_id, points[≤600] }` | `{ received, inserted, duplicates }` |

Cada punto de la traza puede llevar `fuel_kg` (combustible total a bordo, opcional; desde el conector 0.1.16). El evento `touchdown` lleva también `fuel_kg`.

La posición y cada punto de la traza pueden llevar `wind_dir_deg` (dirección verdadera de donde sopla el viento, 0–360) y `wind_kt` (velocidad, 0–400), ambos opcionales, desde el conector 0.1.21. Los eventos `takeoff` y `touchdown` agregan `wind_dir_deg`, `wind_kt`, `headwind_kt` (cabeza +, cola −) y `crosswind_kt` (desde la derecha +, desde la izquierda −).
| `POST /events` (también `/event`) | `{ session_id, events[≤50] }` | `{ received, inserted, duplicates }` |
| `POST /session/end` | `{ session_id, reason: completed\|aborted, latitude, longitude }` | `{ status, flight_id, final_airport }` (repetir el cierre devuelve `already_closed`) |

### Vinculación

1. El conector llama `link/start` y muestra el código.
2. El piloto lo escribe en la web (Settings → Dispositivos ACARS), que llama `approve_acars_link` con su sesión.
3. El conector consulta `link/poll` cada 3 s con el `poll_secret` (sin él, conocer el código no basta). Al aprobarse recibe su token una sola vez.

El código vence a los 10 minutos. Se limitan 20 códigos por hora por red.

### Inicio de sesión

Requisitos: el vuelo es del piloto, la reserva está activa y sin vencer, el piloto sigue siendo miembro activo de la aerolínea, el vuelo tiene OFP de SimBrief y no hay otro vuelo en curso. Al iniciar:

- el vuelo pasa a **En vuelo**;
- la aeronave pasa a **En vuelo**.

Si la sesión ya existe y está activa, se **reanuda**. La respuesta trae la última secuencia recibida de eventos y de puntos, para que el conector continúe sin repetirlas.

### Idempotencia

| Dato | Clave | Reenvío |
| --- | --- | --- |
| Evento | `id` (UUID del cliente) y `(vuelo, seq)` | Se ignora y se cuenta como duplicado |
| Punto de traza | `(vuelo, seq, sampled_at)` | Se ignora |
| Posición viva | Una fila por vuelo | Solo reemplaza si `sampled_at` es más reciente |
| Cierre | Sesión | Devuelve `already_closed` |

### Cierre

- `completed`: el vuelo y la reserva quedan **completados**. La aeronave queda disponible en el aeropuerto más cercano a la posición final (10 NM como máximo).
- `aborted`: el vuelo y la reserva quedan **cancelados** y la aeronave queda disponible.

En ambos casos se borra la posición viva. Las horas y los ciclos se suman al aprobar el PIREP (Fase 5).

## Errores

Cuerpo: `{ "error": { "code", "message", "details"? } }`. El mensaje está en español y se puede mostrar al piloto.

| HTTP | Códigos | Qué hace el conector |
| --- | --- | --- |
| 400 | `bad_request`, `batch_too_large`, `clock_skew` | Aparta los datos (no reintenta formato inválido); con `clock_skew` pide sincronizar el reloj |
| 401 | `invalid_token`, `device_revoked`, `account_suspended` | Deja de enviar y pide vincular de nuevo; la cola local se conserva |
| 403 | `not_member` | Muestra el mensaje |
| 404 | `link_invalid`, `flight_not_found`, `session_not_found`, `not_found` | Muestra el mensaje |
| 409 | `link_used`, `link_expired`, `session_closed`, `flight_not_available`, `booking_inactive`, `ofp_required`, `other_session_active` | Muestra el mensaje; con `session_closed` descarta lo pendiente de esa sesión |
| 429 | `rate_limited` (240 unidades por minuto por dispositivo) | Espera y reintenta |
| 5xx | `server_error` | Espera y reintenta con espera creciente (hasta 60 s) |

## Frecuencias

| Dato | Frecuencia | Tabla |
| --- | --- | --- |
| Posición viva | Cada 10 s | `flight_positions_live` |
| Traza | Lotes cuando hay conexión; 1 punto cada 2 a 60 s según la fase | `flight_track_points` (particionada por mes) |
| Eventos | Al momento | `flight_events` |

Un vuelo de una hora genera unas 360 posiciones, unos 600 puntos y unos 40 eventos.

## Prueba de humo

El flujo **Prueba de la API ACARS** (`scripts/acars-api-smoke.mjs`) comprueba en producción:

- salud y rutas desconocidas;
- rechazo de tokens;
- validación del contrato;
- `link/start` y `link/poll` sin aprobar.
