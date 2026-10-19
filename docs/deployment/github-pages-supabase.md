# Despliegue: GitHub Pages + Supabase

La web se publica sola en cada push a `main`. Esta guía cubre la configuración que se hace una vez.

## 1. Supabase

### Migraciones

Aplicar en orden los archivos de `supabase/migrations` al proyecto. Con Supabase CLI:

```bash
supabase link --project-ref fnsfgjtmwfiizofsjajm
supabase db push
```

### Autenticación (panel de Supabase → Authentication → URL Configuration)

| Ajuste | Valor |
| --- | --- |
| Site URL | `https://inavae.github.io/lam-virtual-acars/` |
| Redirect URLs | `https://inavae.github.io/lam-virtual-acars/auth/callback` |
| | `https://inavae.github.io/lam-virtual-acars/restablecer` |
| | `http://localhost:5173/auth/callback` |
| | `http://localhost:5173/restablecer` |

En *Authentication → Sign In / Providers → Email*: confirmación de correo activada. En *Password*: mínimo 8 caracteres, letras y números.

> El correo integrado de Supabase tiene un límite bajo de envíos por hora y es solo para pruebas. Antes de abrir el registro a pilotos, configurar un SMTP propio en *Authentication → Emails → SMTP Settings*.

### Primer superadministrador

1. Regístrate en el sitio y confirma tu correo.
2. En el SQL Editor de Supabase ejecuta:

```sql
select private.grant_superadmin('tu-correo@ejemplo.com');
```

## 2. GitHub

### Pages

*Settings → Pages → Build and deployment → Source*: **GitHub Actions**.

### Variables del repositorio

*Settings → Secrets and variables → Actions → Variables*:

| Variable | Valor |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://fnsfgjtmwfiizofsjajm.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clave publicable (`sb_publishable_…`) del proyecto |

Son variables y no secretos porque ambos valores son públicos por diseño: terminan dentro del sitio. La protección real son las políticas RLS. La clave secreta de Supabase no se configura en GitHub en la Fase 1.

### Flujos

| Flujo | Cuándo corre | Qué hace |
| --- | --- | --- |
| `web-ci.yml` | PR y push a `main` | Tipos, lint, pruebas y build |
| `deploy-pages.yml` | Push a `main` (cambios de la web) o manual | Build con las variables y publicación en Pages |
| `supabase-ci.yml` | Cambios en `supabase/` | Aplica migraciones en una base local y corre pgTAP |
| `update-lockfile.yml` | Manual | Regenera `pnpm-lock.yaml` |

## 3. Costos

| Servicio | Uso | Costo en desarrollo | Cuándo cambia |
| --- | --- | --- | --- |
| GitHub (repositorio público, Actions, Pages) | Código, CI, sitio | Gratis | Repositorio privado con Pages requiere plan de pago |
| Supabase | Base de datos, Auth, Realtime, Edge Functions | Plan gratuito | Producción con pilotos reales: plan Pro (verificar precio vigente). El plan gratuito pausa proyectos inactivos |
| SMTP propio | Correos de registro y recuperación | Hay opciones gratuitas con límite diario | Al abrir el registro al público |
| SimBrief | OFP de cada piloto | Gratis, cuenta de cada piloto | No cambia |
| Dominio propio | URL sin `/lam-virtual-acars/` | Opcional | Costo anual |
| Firma de código del conector | Evitar avisos de Windows | Opcional | Costo anual, Fase 4 |

Antes de la Fase 6 se verifican los límites vigentes del plan de Supabase para Realtime y escrituras, midiendo el consumo real del mapa en vivo.
