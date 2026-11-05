# Límites de FIR (VATSpy Data Project)

- `Boundaries.geojson`: copia sin cambios de [vatsimnetwork/vatspy-data-project](https://github.com/vatsimnetwork/vatspy-data-project) (commit `bb34408`, 2 nov 2026).
- `fir-index.json`: derivado de la sección `[FIRs]` de `VATSpy.dat` del mismo commit (código ICAO o prefijo → nombre y límite).

Ambos archivos son datos del VATSpy Data Project y se distribuyen bajo la licencia
[Creative Commons Atribución-CompartirIgual 4.0 Internacional (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/)
(texto completo en `LICENSE`). El índice derivado se comparte bajo la misma licencia.

LAM Virtual ACARS los usa para sombrear en el mapa en vivo la FIR de los controladores
CTR y FSS conectados a IVAO; el mapa muestra el crédito correspondiente. Estos datos
son de referencia para simulación y no deben usarse para navegación real.
