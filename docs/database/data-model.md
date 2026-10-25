# Modelo de datos

El esquema separa la plantilla (ruta), la operación (vuelo), el estado vivo, los eventos, la traza histórica y el reporte final (PIREP). Toda tabla operacional lleva `airline_id` para aislar datos por aerolínea con RLS.

## Fase 1 (implementado)

```mermaid
erDiagram
  organizations ||--o{ airlines : agrupa
  organizations ||--o{ organization_members : tiene
  profiles ||--o{ organization_members : es
  airlines ||--|| airline_settings : configura
  airlines ||--o{ airline_memberships : tiene
  profiles ||--o{ airline_memberships : pertenece
  airlines |o--o{ profiles : "aerolínea principal"
  auth_users ||--|| profiles : crea

  organizations {
    uuid id PK
    text slug UK
    text name
  }
  airlines {
    uuid id PK
    uuid organization_id FK
    text slug UK
    text name
    text icao_code UK "3 letras, obligatorio para activar"
    text iata_code UK
    text network "IVAO, VATSIM u OFFLINE"
    text flight_plan_remarks "RMK, ej. IVAOVA/MXL"
    text brand_primary_color
    bool is_unofficial_brand
    bool is_active
  }
  profiles {
    uuid id PK "= auth.users.id"
    int pilot_number UK "desde 1001"
    text email
    text display_name
    text country_code
    text simbrief_username
    uuid primary_airline_id FK
    account_status account_status
  }
  organization_members {
    uuid organization_id PK
    uuid user_id PK
    org_role role
  }
  airline_memberships {
    uuid id PK
    uuid airline_id FK
    uuid user_id FK
    airline_role_array roles
    membership_status status
    uuid decided_by FK
  }
  airline_settings {
    uuid airline_id PK
    smallint max_active_bookings
    smallint booking_expiry_hours
    bool auto_approve_pireps
    bool public_tracking
  }
```

`audit_logs` no tiene claves foráneas a propósito: conserva el historial aunque se borre la persona o la aerolínea.

### Reglas que impone la base de datos

| Regla | Mecanismo |
| --- | --- |
| Una aerolínea activa tiene código ICAO | `check airlines_active_requires_icao` |
| Una persona tiene una sola membresía por aerolínea | `unique (airline_id, user_id)` |
| Cada aerolínea tiene configuración | Disparador `airlines_create_settings` |
| El perfil se crea al registrarse | Disparador `on_auth_user_created` sobre `auth.users` |
| El correo del perfil sigue al de Auth | Disparador `on_auth_user_email_changed` |
| Solo un superadministrador cambia códigos, estado u organización de una aerolínea | Disparador `airlines_guard_update` |
| El piloto no cambia su correo, estado ni fecha de alta | Disparador `profiles_guard_update` |
| La aerolínea principal requiere membresía activa | Disparador `profiles_guard_update` |
| Solo un superadministrador nombra o modifica administradores de aerolínea | Disparador `airline_memberships_guard_write` |
| Cambiar el estado de una membresía registra quién y cuándo | Disparador `airline_memberships_guard_write` |
| Al perder la membresía activa se limpia la aerolínea principal | Disparador `airline_memberships_clear_primary` |
| Cambios administrativos auditados | Disparadores `*_audit` |

### Decisión: roles como arreglo en la membresía

Los roles por aerolínea se guardan como `airline_role[]` en `airline_memberships` en lugar de las tablas `roles`, `permissions` y `membership_roles`. Ver [ADR 0003](../decisions/0003-roles-por-membresia.md).

## Fase 2 (implementado)

```mermaid
erDiagram
  airlines ||--o{ aircraft : opera
  aircraft_types ||--o{ aircraft : "es de tipo"
  airports |o--o{ aircraft : "base y ubicación"
  airlines ||--o{ routes : programa
  airports ||--o{ routes : "origen y destino"
  routes ||--o{ route_aircraft_types : permite
  aircraft_types ||--o{ route_aircraft_types : "es permitido en"
```

| Tabla | Contenido |
| --- | --- |
| `airports` | Catálogo global (ICAO, IATA, nombre, ciudad, país, coordenadas, elevación, tipo, origen OurAirports o manual) |
| `aircraft_types` | Catálogo global por designador ICAO (25 tipos iniciales) con estela, motor, capacidad y velocidad de crucero |
| `aircraft` | Flota por aerolínea: matrícula única, número de flota, configuración, estado, base, ubicación, horas y ciclos |
| `routes` | Plantillas de vuelo: número, origen, destino, distancia calculada, duración, hora UTC, días (máscara de bits), tipo de operación |
| `route_aircraft_types` | Tipos de aeronave permitidos por ruta |

Logotipos: bucket público `airline-logos` en Storage, una carpeta por aerolínea (`{airline_id}/logo-*.png`).

## Fase 3 (implementado)

```mermaid
erDiagram
  airlines ||--o{ pilot_type_ratings : otorga
  profiles ||--o{ pilot_type_ratings : tiene
  aircraft_types ||--o{ pilot_type_ratings : "habilita en"
  profiles ||--o{ flight_bookings : reserva
  routes |o--o{ flight_bookings : "de la ruta"
  aircraft |o--o{ flight_bookings : aparta
  flight_bookings ||--|| flights : genera
  flights ||--o| simbrief_ofps : "plan de vuelo"
```

| Tabla | Contenido |
| --- | --- |
| `pilot_type_ratings` | Tipos que cada piloto puede volar en cada aerolínea; quién y cuándo la otorgó |
| `flight_bookings` | Reserva: piloto, ruta, aeronave, estado (activa, volada, cancelada, vencida) y vencimiento |
| `flights` | Operación: copia de la ruta (número, origen, destino, distancia, duración, salida programada), aeronave y matrícula, callsign del piloto, red y RMK. Estados: reservado, en vuelo, completado, cancelado |
| `simbrief_ofps` | Último OFP de SimBrief del vuelo (ruta, nivel, combustibles, pesos, PDF) y las diferencias con la reserva |

Por qué reserva y vuelo son tablas distintas: la reserva controla el apartado de la aeronave y su vencimiento; el vuelo es el registro operacional que usarán el ACARS (Fase 4) y el PIREP (Fase 5) y no cambia si la ruta se edita o se borra.

El callsign se guarda en `flights.callsign` y lo escribe el piloto al reservar.

Diferencias del OFP (las calcula el disparador `simbrief_ofps_set`, no el cliente): origen, destino y tipo (importancia alta); matrícula, callsign y plan con más de 24 h (importancia baja).

## Fases siguientes (diseño conceptual)

| Grupo | Tablas | Fase |
| --- | --- | --- |
| ACARS | `acars_devices`, `acars_link_codes`, `flight_sessions`, `flight_positions_live`, `flight_track_points`, `flight_events` | 4 |
| PIREP | `pireps`, `pirep_reviews`, `scoring_rule_sets`, `flight_scores` | 5 |
| Estadísticas | `pilot_statistics` y vistas de agregados | 5 y 6 |

Cada fase diseña en detalle sus tablas al empezar, para no fijar decisiones antes de tiempo.

### Telemetría (Fase 4)

| Dato | Frecuencia hacia la nube | Tabla | Retención |
| --- | --- | --- | --- |
| Posición viva | Cada 10 s | `flight_positions_live` (una fila por vuelo, sobrescrita) | Se borra al terminar |
| Traza | Lotes cada 60 s, puntos reducidos por fase | `flight_track_points` (particionada por mes) | 90 días |
| Eventos | Inmediato, con idempotencia | `flight_events` | Permanente |

## Aerolíneas registradas

| Aerolínea | ICAO | Operación | RMK | Sitio | Estado |
| --- | --- | --- | --- | --- | --- |
| Líneas Aéreas Mexicanas | MXL | Pasajeros y carga | IVAOVA/MXL | lineasaereasmexicanas.com.mx | Activa |
| Alas del Sur | WOS | Pasajeros | Sin definir | alasdelsurva.org | Activa |
| TAESA | TEJ | Pasajeros | Sin definir | taesava.com | Activa |
| FedEx Virtual | FDX | Carga | Sin definir | Sin sitio | Activa |
| VIVA Virtual | VIV | Pasajeros | Sin definir | Sin sitio | Activa |

Fuentes: identidad corporativa de LAM, lineasaereasmexicanas.com.mx/es/alianzas y los sitios de cada aerolínea. Todas operan en IVAO; TAESA indica también VATSIM. Los colores se tomaron de cada logotipo.

**Callsign:** no es un dato de la aerolínea. Cada piloto elige el suyo al reservar y se guarda en `flights.callsign`. La columna `airlines.radio_callsign` queda sin uso.

Paleta de LAM, tomada del emblema: verde `#057956`, rojo `#D6061C`, blanco, azul noche `#0A1420`, superficie `#182837` y dorado `#C8A96A`.
