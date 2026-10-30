# Adaptadores de aeronave del conector

El conector lee la aeronave con un adaptador. El adaptador traduce lo que expone el
avión a una lectura del contrato (`SimSample`). Se elige por el título de la aeronave.
Si la aeronave publica un bloque del SDK de PMDG, también se elige por esos datos.
Código: `apps/acars-connector/src/LamAcars.Core/Aircraft/`.

| Adaptador | Coincide con | Además de las variables estándar |
| --- | --- | --- |
| Fenix A32x | título o ATC TYPE con "Fenix" | L:S_MIP_PARKING_BRAKE y L:B_CONFIG_CHOCKS. Con calzos, el avión cuenta como asegurado. |
| PMDG 737 | `737-600/700/800/900`, o "PMDG … 737" (sin MAX) | Bloque `PMDG_NG3_Data`: freno de estacionamiento, palanca del tren, flaps en grados (aguja) y variante exacta. |
| PMDG 777 | `777-200/300/F`, `77W`, `77L`, o "PMDG … 777" | Bloque `PMDG_777X_Data`: freno, tren, retén de flaps (si falta el ángulo estándar) y variante exacta. |
| Genérico | cualquier otra | Variables estándar de SimConnect. |

Todos los adaptadores reportan los flaps en grados con `TRAILING EDGE FLAPS LEFT ANGLE`.
El valor sale en los eventos `takeoff` y `touchdown` como `flaps_deg`, y `touchdown`
lleva también `gear_down`. La Fase 5 los usa para evaluar la configuración.

## SDK de PMDG

PMDG publica el estado del avión como ClientData de SimConnect, pero solo si
`[SDK] EnableDataBroadcast=1` está en el `*_Options.ini` del avión. Carpetas según
la documentación de PMDG para MSFS 2024:

- Microsoft Store: `%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalState\WASM\MSFS2024\pmdg-aircraft-7xx\work\`
- Steam: `%APPDATA%\Microsoft Flight Simulator 2024\WASM\MSFS2024\pmdg-aircraft-7xx\work\`

El conector busca esos archivos (también en las rutas de MSFS 2020). Si alguno no
tiene el ajuste, muestra un aviso con el botón **Activar**. El botón agrega la línea,
guarda una copia `.lam-backup` y pide recargar el avión.

Sin el SDK, los adaptadores PMDG se comportan igual que el genérico. A los 20 s
sin datos, la bitácora lo indica.

Cómo se lee el bloque:

- Se piden siempre las dos áreas: `MapClientDataNameToID`, `AddToClientDataDefinition` (desplazamiento 0, tamaño del struct) y `RequestClientData` con periodo `ON_SET`.
- Los datos llegan como `SIMCONNECT_RECV_CLIENT_DATA` (id 16) a partir del byte 40.
- Si llegan tres bloques en menos de 5 s y el título no identificó al avión, el conector cambia al adaptador PMDG.

Desplazamientos tomados de los encabezados del SDK (`offsetof`; tipos de 1, 2 y 4 bytes, mismo empaquetado en MSVC):

| Struct (tamaño) | Campo | Byte | Tipo |
| --- | --- | --- | --- |
| PMDG_NG3_Data (916) | FUEL_QtyCenter / Left / Right | 116 / 120 / 124 | float, lb |
| | MAIN_TEFlapsNeedle[0] | 492 | float, grados |
| | MAIN_GearLever | 506 | uchar: 0 UP, 1 OFF, 2 DOWN |
| | PED_annunParkingBrake | 574 | bool |
| | AircraftModel | 654 | ushort |
| PMDG_777X_Data (684) | GEAR_Lever | 212 | uchar: 0 UP, 1 DOWN |
| | FCTL_Flaps_Lever | 421 | uchar: retenes 0, 1, 5, 15, 20, 25, 30 |
| | BRAKES_ParkingBrakeLeverOn | 424 | bool |
| | FUEL_QtyCenter / Left / Right / Aux | 496 / 500 / 504 / 508 | float, lb |
| | AircraftModel | 542 | uchar |

Variante a ICAO:

- 737: 1 → B736. 2-4, 13-14 y 19-20 → B737. 5-7, 15-18 y 21-22 → B738. 8-12 → B739.
- 777: 1-2 → B772. 3 → B773. 4-5 → B77L. 6 → B77W.

El ICAO reportado por el avión tiene prioridad sobre el deducido del título. Se usa al
iniciar la sesión y en el aviso de tipo distinto al reservado.

## Verificación pendiente en el simulador

- Fenix: los valores de las L: del freno y los calzos (la bitácora registra cada cambio).
- PMDG: que el bloque llegue con `ON_SET` y que los campos coincidan. La bitácora registra modelo, freno, tren y flaps del SDK junto a las variables estándar.
