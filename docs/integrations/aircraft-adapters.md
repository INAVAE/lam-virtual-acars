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

## Viento (conector 0.1.21)

Todos los adaptadores leen `AMBIENT WIND DIRECTION` (grados verdaderos, de donde sopla) y
`AMBIENT WIND VELOCITY` (nudos), que el simulador da para cualquier aeronave. Las componentes
de cabeza y cruzada se calculan con `PLANE HEADING DEGREES TRUE`.

## Cierre del vuelo y APU (conector 0.1.21)

El vuelo se completa solo con motores apagados, avión detenido, freno de estacionamiento (5 s)
y la APU apagada. Si el avión no informa APU (`ApuRunning` nulo), no se exige. Sin freno, basta
con 60 s detenido, también con la APU apagada. Mientras la APU siga encendida, el conector muestra
"Apaga la APU para cerrar el vuelo".

## Motores en marcha estables (conector 0.1.22)

El 2026-11-01 un A340-600 (PIREP-2026-00004 y PIREP-2026-00006, título en el simulador "ToLiss A346 PRO [Preset Pax]") alternó `GENERAL ENG COMBUSTION` entre 4 y 0 motores en cada lectura, desde el arranque hasta el final. El conector 0.1.21 registró cada cambio como arranque o apagado (6,550 pares en 28 min; 201,186 en 8 h), la fase se quedó en pushback (sin despegue, aterrizaje, combustible ni calzos puestos) y la cola de eventos dejó atrás a la traza y a la posición en vivo.

Desde la 0.1.22:

- **Motor en marcha:** combustión **o** `TURB ENG N2` ≥ 50 % (en turbinas, el ralentí ronda 55–70 %). En pistón el N2 es 0 y cuenta solo la combustión.
- **Filtro de apagado** (`EngineCountFilter`): un arranque cuenta de inmediato; un apagado solo si dura 3 s sin volver a verse en marcha. Así el parpadeo no cambia la fase.
- **Tope de eventos repetidos** (`EventFloodGuard`): máximo 16 por minuto de arranques, apagados, pausas, slew, sobrevelocidad y pérdida; lo demás se descarta con una nota `events_suppressed`. Los hitos (fases, calzos, despegue, aterrizaje) nunca se descartan.
- **Envío:** por ronda salen como máximo 4 lotes de eventos antes de la traza, para que la traza y la posición no esperen detrás de un atasco de eventos.
- **Servidor:** `acars_events` guarda como máximo 64 eventos de motor por sesión (protege de conectores anteriores).

No hace falta un adaptador propio de iniBuilds para esto: el genérico ya cubre cualquier avión que parpadee. Si el A340 o el A380 muestran otros huecos (freno de estacionamiento, flaps, APU), se agrega un adaptador con las variables que confirme un vuelo de prueba, como se hizo con Fenix y PMDG.

## APU no informada por la aeronave (2026-11-05)

Algunos complementos tienen su propia APU y no mueven la variable estándar `APU PCT RPM`: el conector la ve en «encendida» desde que se conecta y nunca la ve apagarse. Visto con «A380-800 EA Basic» (QTR783) y con el «A300 Freighter (PW)» (PIREP-2026-00005 y 00007).

- **Conector 0.1.24:** la APU apagada solo se exige para cerrar el vuelo si en ese vuelo ya se vio apagada al menos una vez (`PhaseMachine.ApuReported`); el aviso «Apaga la APU para cerrar el vuelo» sigue la misma regla.
- **Servidor (`20261106070000_apu_unreliable`):** si la APU estaba en marcha al conectar, no hubo ningún encendido ni apagado y el vuelo despegó, `metrics.fuel.apu` queda como `{unreliable: true}` y la web muestra «Sin dato» en lugar de contar todo el vuelo. Se corrigieron los PIREP 00005 y 00007.
- Para leer la APU de un complemento así hace falta su variable propia (L:var o SDK), como con PMDG. Pedir la bitácora del conector y el nombre exacto del avión.
- **Conector 0.1.26:** la bitácora anota, al cambiar, `APU PCT RPM`, `APU SWITCH`, `APU GENERATOR SWITCH:1` y `APU GENERATOR ACTIVE:1` en todos los aviones (línea «Genérico (SimConnect): APU SWITCH = 0»). Prueba para el piloto: avión en la puerta, encender la APU, esperar un minuto, apagarla y enviar `acars-AAAAMMDD.log` de ese día (fecha UTC).

## Cambio de aeronave (conector 0.1.27)

La identidad de la aeronave son cuatro cadenas de SimConnect: `TITLE`, `ATC ID`, `ATC MODEL` y `ATC TYPE`. El A380 de iniBuilds cambia `ATC ID` (la matrícula) un par de minutos después de cargar, y el conector registraba eso como `aircraft_changed`, que en el PIREP es falta grave. Desde 0.1.27 el evento solo se emite cuando cambia `TITLE`, y no con la primera lectura. El servidor (`build_pirep`) además ignora los eventos cuyo título es igual al de la sesión, lo que cubre a los conectores anteriores.
