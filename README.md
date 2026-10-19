# LAM Virtual ACARS

Plataforma de operaciones para las aerolíneas virtuales de **Líneas Aéreas Mexicanas (LAM)** en Microsoft Flight Simulator 2024: pilotos, aerolíneas, flota, rutas, reservas, seguimiento de vuelos y PIREP automáticos.

> Proyecto de simulación. Las aerolíneas basadas en marcas reales (TAESA, FedEx, Viva Aerobus) son operaciones virtuales no oficiales y no tienen relación con esas compañías.

## Estado

Fase 1 (fundación) en curso. El detalle de lo terminado, lo verificado y el siguiente paso está en [`docs/STATUS.md`](docs/STATUS.md).

| Fase | Contenido | Estado |
| --- | --- | --- |
| 1 | Cuentas, roles, aerolíneas, dashboard inicial, CI/CD | En curso |
| 2 | Administración de pilotos, aerolíneas, flota, aeropuertos y rutas | Pendiente |
| 3 | Reservas e integración con SimBrief | Pendiente |
| 4 | LAM ACARS Connector (Windows + SimConnect) | Pendiente |
| 5 | PIREP automático y evaluación | Pendiente |
| 6 | Mapa en vivo y Operations Center | Pendiente |
| 7 | Optimización y preparación para producción | Pendiente |

## Arquitectura

- **Web** (`apps/web`): Vite + React + TypeScript, publicada como sitio estático en GitHub Pages.
- **Backend**: Supabase (Auth, PostgreSQL con RLS, Realtime, Storage, Edge Functions). Es el único backend.
- **Conector** (`apps/acars-connector`, Fase 4): aplicación .NET para Windows que lee MSFS 2024 por SimConnect.

Más detalle en [`docs/architecture/overview.md`](docs/architecture/overview.md).

## Estructura

```
apps/
  web/                 Sitio web (GitHub Pages)
  acars-connector/     Conector Windows (Fase 4)
packages/
  shared-types/        Tipos de la base de datos
  validation/          Esquemas Zod compartidos
supabase/
  migrations/          Migraciones SQL versionadas
  tests/database/      Pruebas pgTAP de RLS
docs/                  Arquitectura, base de datos, despliegue y decisiones
.github/workflows/     CI y publicación
```

## Desarrollo local

Requisitos: Node 22, pnpm 10 y, para la base de datos local, Docker y Supabase CLI.

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # completa URL y clave publicable
pnpm dev                                       # http://localhost:5173

# Base de datos local y pruebas RLS
supabase db start
supabase test db
```

Comandos del monorepositorio:

| Comando | Qué hace |
| --- | --- |
| `pnpm dev` | Servidor de desarrollo de la web |
| `pnpm build` | Build de producción de la web |
| `pnpm typecheck` | Verificación de tipos en todos los paquetes |
| `pnpm lint` | ESLint |
| `pnpm test` | Pruebas unitarias (Vitest) |

## Despliegue

Cada push a `main` publica la web en GitHub Pages. La configuración necesaria (variables del repositorio, URL de redirección en Supabase y alta del primer superadministrador) está en [`docs/deployment/github-pages-supabase.md`](docs/deployment/github-pages-supabase.md).

## Seguridad

- En el navegador solo existen la URL del proyecto y la clave **publicable** de Supabase. Todos los permisos se aplican con RLS.
- Las claves secretas nunca se suben al repositorio ni al build; el flujo de publicación falla si detecta una.
- Matriz de permisos: [`docs/database/permissions.md`](docs/database/permissions.md).
