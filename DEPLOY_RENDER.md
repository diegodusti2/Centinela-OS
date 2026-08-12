# Deploy en Render (Free)

## Opcion A: Git + Blueprint (recomendada)

1. Crea un repositorio en GitHub y sube `centinela_server`:
   - `git init && git add . && git commit -m "Centinela OS"`
   - `git remote add origin https://github.com/TU-USUARIO/centinela-os.git`
   - `git push -u origin main`

2. Edita `render.yaml` y reemplaza `TU-USUARIO` por tu usuario real.

3. En [render.com](https://render.com) > New > Blueprint > selecciona el repo.

## Opcion B: Web Service manual

1. Render > New > Web Service > conecta el repo (o usa "Public Git repository").
2. Configura:
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Plan: Free (512 MB RAM, suficiente)

## Variables de entorno obligatorias (pestana Environment)

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | Generate (Render lo crea automatico) |
| `ADMIN_USER` | `admin` |
| `ADMIN_PASSWORD` | Tu contrasena de administrador |
| `DB_PATH` | `/tmp/centinela.db` (pruebas) |
| `PUBLIC_DASHBOARD_URL` | `https://TU-APP.onrender.com` |
| `CORS_ORIGINS` | `https://TU-APP.onrender.com` |

## URL final

`https://centinela-os.onrender.com` - acceso desde cualquier red abierta.

## Notas

- **WebSocket**: Render soporta WebSockets en servicios web gratis (canal de comandos en tiempo real).
- **Disco**: en Free el disco es temporal; la base de datos se reinicia en cada deploy. Para produccion real usa plan Starter ($7/mes) con disco persistente.
- **Sleep**: el servicio Free se duerme tras 15 min sin trafico y despierta en la primera peticion (~30s).
