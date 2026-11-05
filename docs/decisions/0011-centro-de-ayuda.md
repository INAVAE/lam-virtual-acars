# ADR 0011: Centro de ayuda, manual en PDF y reporte de incidencias

Estado: aceptada (2026-11-05)

## Contexto

Los pilotos de prueba preguntan lo mismo por mensajes sueltos (dónde va el usuario de
SimBrief, por qué no aparece el vuelo en el conector, por qué una falta) y los reportes
de fallas llegan sin folio, sin navegador ni versión. Los otros proyectos del equipo
(ISEL) ya resuelven esto con un botón de ayuda en la barra superior, un manual con
preguntas frecuentes y diagnóstico de fallas, un PDF descargable y un buzón firmado.

## Decisión

- **Una sola fuente** para el contenido: `apps/web/src/content/help-content.ts`
  (capítulos con su público, preguntas frecuentes, «Si algo falla», novedades). Sin
  imports, para que Node la lea directamente.
- **En la web:** botón de ayuda (?) en la barra superior, con el contador de reportes
  sin revisar para quien los atiende, y la página `/help` con pestañas: Guía paso a
  paso, Preguntas frecuentes, Si algo falla, Reportar una incidencia, Reportes
  recibidos (staff) y Novedades, con búsqueda sin acentos.
- **Manual en PDF:** `scripts/build-manual.mjs` lo arma con Chromium a partir del mismo
  contenido y de capturas tomadas por `scripts/visual-check.mjs` (las `m-*`, tema claro,
  con un `.marks.json` para numerar elementos). Se genera en cada publicación del sitio
  dentro del workflow de Pages y se sirve en `manual/Manual-LAM-Virtual-ACARS.pdf`. Si
  falla, se conserva el PDF publicado antes y el sitio se publica igual.
- **Incidencias:** tabla `support_tickets` con folio `INC-AAAA-NNNNN`, tipo (falla,
  mejora, duda, otro), aerolínea opcional, módulo, folio relacionado, título, detalle y
  contexto técnico (navegador, ventana, tema, ruta, versión de la web). La firma
  (nombre y número de piloto) la pone un disparador. Atiende el staff de la aerolínea
  elegida o, si es de la plataforma, el superadministrador. Solo `status` y `response`
  son editables, nadie borra, y hay un máximo de 10 reportes por hora por persona.
- La web lleva su versión (`VITE_APP_VERSION` = número de publicación y commit), que se
  ve en la ayuda y viaja en cada reporte.

## Consecuencias

- Todo cambio visible para el usuario actualiza `help-content.ts` (capítulo y una línea
  en `MANUAL_CHANGES`); el PDF se regenera solo al publicar.
- Las capturas usan datos simulados: no exponen datos reales de pilotos.
- Sin avisos por correo todavía: el staff ve los reportes por el contador del botón de
  ayuda. Se puede agregar cuando haya SMTP propio.
