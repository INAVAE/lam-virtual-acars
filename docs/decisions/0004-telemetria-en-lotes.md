# 0004. Telemetría con posición viva sobrescrita y traza en lotes

- Estado: propuesta (se implementa en la Fase 4)
- Fecha: 2026-10-19

## Decisión

El conector muestrea a alta frecuencia en local y envía a la nube: una posición viva cada 10 segundos (una fila por vuelo, sobrescrita), la traza histórica en lotes reducidos cada 60 segundos y los eventos al momento con idempotencia. El aterrizaje se calcula en el conector con una ventana de alta frecuencia.

## Consecuencias

- Escrituras acotadas por vuelo, compatibles con el plan gratuito durante el desarrollo.
- El mapa interpola entre posiciones para que el movimiento sea continuo.
- El consumo real se mide en la Fase 6 antes de ajustar frecuencias.
