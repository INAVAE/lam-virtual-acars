# 0006. Conector: SimConnect por la API C, DLL incluida en la descarga y contrato por ejemplos

- Estado: aceptada
- Fecha: 2026-10-25

## Contexto

- El conector necesita SimConnect para leer MSFS 2024.
- El SDK trae dos DLL:
  - la nativa (`SimConnect.dll`);
  - un envoltorio administrado (`Microsoft.FlightSimulator.SimConnect.dll`).
- Ninguna de las dos está en NuGet.
- Microsoft no ha aclarado si se pueden redistribuir, aunque muchos ACARS las incluyen.
- Los ejecutores de CI no tienen el SDK.

El prompt pide modelos de C# generados desde JSON Schema. Generar código exige otra herramienta en el monorepositorio (y un archivo de bloqueo nuevo), sin una ganancia clara para un contrato de 7 rutas.

## Decisión

1. **Llamadas directas a la API C de SimConnect** (`DllImport` de `SimConnect.dll`). El conector compila sin el SDK. La DLL nativa solo se necesita al ejecutar, junto a `LamAcars.exe`.
2. **Datos etiquetados** (`SIMCONNECT_DATA_REQUEST_FLAG_TAGGED`). Si una aeronave no tiene una variable, las demás siguen llegando bien; lo que falta queda como «no disponible».
3. **La DLL va en la descarga, no en el repositorio.** El usuario lo decidió el 2026-10-25. El flujo de CI la toma de un borrador de publicación privado (`deps-simconnect`) y la mete en el zip. Si no está, el paquete lo indica.
4. **Contrato por ejemplos.** Los esquemas Zod son la fuente. La misma colección de ejemplos JSON:
   - la valida Zod en Vitest;
   - la comparan las pruebas xUnit con lo que serializan los modelos de C#.

   Un cambio en el contrato que no se refleje en ambos lados rompe CI.

## Consecuencias

- Un cambio en la estructura binaria de SimConnect obligaría a ajustar `Native.cs`. Es una API estable desde FSX.
- Riesgo de licencia bajo pero no nulo. Si Microsoft lo pidiera, el paquete dejaría de incluir la DLL y cada piloto la copiaría del SDK.
- Si el contrato crece mucho, se puede volver a generar modelos desde JSON Schema sin cambiar la API.
