# Contrato ACARS (`/acars/v1`)

Pendiente: se define en detalle al iniciar la Fase 4. Este documento fija lo acordado para que la Fase 3 no tome decisiones incompatibles.

| Endpoint | Propósito |
| --- | --- |
| `POST /acars/v1/link/start` | El conector pide un código corto de vinculación |
| `POST /acars/v1/link/poll` | El conector espera a que el piloto confirme el código en la web y recibe su token |
| `POST /acars/v1/session/start` | Inicia la sesión ACARS de una reserva activa |
| `POST /acars/v1/position` | Posición viva (cada 10 s) |
| `POST /acars/v1/track-batch` | Lote de puntos de traza |
| `POST /acars/v1/event` | Cambio de fase o evento operacional |
| `POST /acars/v1/session/end` | Cierre de la sesión y solicitud de PIREP |

Reglas:

- Autenticación con token de dispositivo opaco; el servidor guarda solo su hash y permite revocarlo.
- Cada evento y lote lleva un UUID generado por el cliente y un número de secuencia; el servidor descarta duplicados.
- Esquemas definidos con Zod en `packages/validation` y publicados como JSON Schema para generar los modelos de C#.
- Marcas de tiempo en UTC (ISO 8601).
