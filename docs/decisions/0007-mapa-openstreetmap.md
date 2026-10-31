# ADR 0007: Mapa del PIREP con OpenStreetMap

Estado: aceptada (2026-10-30)

## Contexto

El análisis del vuelo necesita un mapa base interactivo. En nuestras pruebas, las teselas de CARTO
respondieron "API KEY REQUIRED". Las teselas estándar de OpenStreetMap (`tile.openstreetmap.org`)
son gratuitas y tienen dos condiciones:

- **[Política de uso de teselas](https://operations.osmfoundation.org/policies/tiles/)**
- **[Guía de atribución](https://osmfoundation.org/wiki/Attribution)**, de la OSMF; los datos están bajo la [ODbL](https://opendatacommons.org/licenses/odbl/).

## Decisión

Se usa Leaflet 1.9 con las teselas estándar de OpenStreetMap y se cumplen sus condiciones así:

| Requisito | Cómo se cumple |
| --- | --- |
| Atribución visible en el mapa, que nombre OpenStreetMap y deje clara la licencia ODbL | Control de atribución de Leaflet en la esquina inferior derecha con "© OpenStreetMap contributors"; "OpenStreetMap" enlaza a https://www.openstreetmap.org/copyright. Nunca se oculta ni se colapsa, también en móvil. Texto de 12 px subrayado, con colores del tema. La revisión visual falla si el enlace no aparece. |
| Referer válido | El sitio declara `strict-origin-when-cross-origin` y la capa de teselas fija `referrerPolicy` con el mismo valor. |
| User-Agent válido | Lo envía el navegador; no se reemplaza. |
| Sin descargas masivas, precarga ni uso sin conexión | Solo se piden las teselas que muestra el mapa. No hay service worker ni prefetch. |
| Respetar el caché | No se envían `Cache-Control: no-cache` ni `Pragma: no-cache`; el navegador cachea según las cabeceras de OSM. |
| Sin tráfico automatizado | La revisión visual de la CI responde las teselas con una imagen neutra generada localmente y no llama a los servidores de OSM. |
| Usuarios con mucho tráfico deben usar otro proveedor | La URL y la atribución se configuran con `VITE_MAP_TILE_URL` y `VITE_MAP_ATTRIBUTION`, y la CSP se ajusta sola al origen. Con datos de OSM la atribución a OpenStreetMap sigue siendo obligatoria. |

En modo oscuro las teselas se invierten con CSS. Es solo presentación: el mapa,
sus datos y la atribución no cambian.

## Consecuencias

- **Volumen:** el uso actual (pilotos revisando PIREP) es bajo y cabe en la política. Si la aerolínea virtual crece, o se abre un mapa público en vivo (Fase 6), hay que revisar el volumen y, si hace falta, pasar a un proveedor propio o comercial cambiando las variables.
- **Leaflet:** tiene licencia BSD-2-Clause. Su aviso de copyright se conserva en el paquete (comentario `@preserve`) y el control de atribución enlaza a leafletjs.com.
