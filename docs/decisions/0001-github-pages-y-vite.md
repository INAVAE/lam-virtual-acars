# 0001. Publicar en GitHub Pages con Vite

- Estado: aceptada
- Fecha: 2026-10-19

## Contexto

El proyecto se publica en GitHub Pages, que solo sirve archivos estáticos. Next.js pierde ahí sus funciones de servidor (rutas API, middleware, renderizado en servidor).

## Decisión

Construir la web como aplicación de una sola página con Vite, React y TypeScript. Toda la lógica de servidor vive en Supabase. Las rutas profundas funcionan copiando `index.html` como `404.html`.

## Consecuencias

- Costo cero de hosting y despliegue con GitHub Actions.
- No hay servidor propio: autorización solo en RLS, funciones SQL y Edge Functions.
- Sin cabeceras HTTP propias: la Content Security Policy se define con `<meta>`.
- Las rutas desconocidas responden con estado HTTP 404 aunque la app se muestre bien; no afecta a navegadores.
