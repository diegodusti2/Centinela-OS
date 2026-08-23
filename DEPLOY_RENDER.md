# Deploy en Render (con PostgreSQL en Neon)

Centinela OS usa **PostgreSQL** (Neon) para que la base persista incluso en el
plan **Free** de Render (que no tiene disco persistente). El disco efimero ya
no es un problema: todos los datos viven en Neon.

## 1. Crea la base en Neon

1. Ve a [neon.tech](https://neon.tech) y crea una cuenta gratuita.
2. Crea un proyecto (PostgreSQL 16) y una base de datos.
3. Copia la **connection string** (empieza con `postgresql://`). La veras en el
   dashboard como "Connection String" (usa la variante con pooler para mejor
   rendimiento: termina en `-pooler`).
4. El esquema (tablas e indices) se crea automaticamente al arrancar el
   servidor, no necesitas migrar nada.

## 2. Despliega en Render

### Opcion A: Git + Blueprint (recomendada)

1. Sube `centinela_server` a un repositorio de GitHub:
   - `git init && git add . && git commit -m "Centinela OS"`
   - `git remote add origin https://github.com/TU-USUARIO/centinela-os.git`
   - `git push -u origin main`

2. En [render.com](https://render.com) > New > Blueprint > selecciona el repo.

3. El blueprint (`render.yaml`) crea un servicio web **Free** y te pedira las
   variables `DATABASE_URL`, `ADMIN_PASSWORD`, `PUBLIC_DASHBOARD_URL` y
   `CORS_ORIGINS`.

### Opcion B: Web Service manual

1. Render > New > Web Service > conecta el repo.
2. Configura:
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Plan: Free
3. Settings > Environment: agrega `DATABASE_URL` con la connection string de Neon.

## Variables de entorno obligatorias (pestana Environment)

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `postgresql://...` (connection string de Neon) |
| `JWT_SECRET` | Generate (Render lo crea automatico) |
| `ADMIN_USER` | `admin` |
| `ADMIN_PASSWORD` | Tu contrasena de administrador |
| `PUBLIC_DASHBOARD_URL` | `https://TU-APP.onrender.com` |
| `CORS_ORIGINS` | `https://TU-APP.onrender.com` |
| `DEMO_PAYMENTS` | `false` |
| `ALLOW_LEGACY_BASIC` | `false` |

## Respaldo y recuperacion

- Neon incluye **point-in-time recovery** y snapshots automaticos en el plan
  free: la base se conserva entre deploys y reinicios.
- No se requiere disco en Render ni respaldo manual a GitHub.

## Endurecimiento de seguridad (recomendado)

1. **Rotar secretos periodicamente** (Render > Environment > Generate):
   - `JWT_SECRET`: invalida todas las sesiones existentes.
   - `ADMIN_PASSWORD`: usar 16+ caracteres, generador de contrasenas.
2. CSP estricto activo en `/dashboard` (sin scripts/estilos inline).
3. La connection string de Neon es sensible: no la compartas ni la subas al
   repositorio (usa `sync: false` en Render).

## URL final

`https://centinela-os.onrender.com` - acceso desde cualquier red abierta.

## Notas

- **WebSocket**: Render soporta WebSockets (canal de comandos en tiempo real).
- **Sleep**: el servicio Free se duerme tras 15 min sin trafico; la base en Neon
  NO se pierde (solo se pausa el servicio, no los datos).
- **Escala**: Neon free permite ~10 proyectos y PostgreSQL completo; si el
  volumen crece, sube el plan de Neon sin cambiar el codigo.
