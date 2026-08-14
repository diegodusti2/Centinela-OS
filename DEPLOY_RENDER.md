# Deploy en Render (con disco persistente y respaldos)

## Opcion A: Git + Blueprint (recomendada)

1. Crea un repositorio en GitHub y sube `centinela_server`:
   - `git init && git add . && git commit -m "Centinela OS"`
   - `git remote add origin https://github.com/TU-USUARIO/centinela-os.git`
   - `git push -u origin main`

2. En [render.com](https://render.com) > New > Blueprint > selecciona el repo.

3. El blueprint (`render.yaml`) crea:
   - Servicio web plan **Starter** (los discos persistentes requieren plan de pago, $7/mes).
   - **Disco persistente** `/data` (1 GB) montado en el servicio.
   - `DB_PATH=/data/centinela.db`: la base de datos **sobrevive a los deploys**.
   - `JWT_SECRET` generado automaticamente.
   - Al crearlo te pedira `ADMIN_PASSWORD`, `PUBLIC_DASHBOARD_URL` y `CORS_ORIGINS`.

> Si ya tienes el servicio creado manualmente en Free, adjuntale el disco en
> Settings > Disks > Add disk (mount path `/data`) y cambia `DB_PATH` a
> `/data/centinela.db` en Environment. El primer deploy con disco se queda con
> la base vacia: vuelve a crear usuarios/registros o restaura un respaldo.

## Opcion B: Web Service manual

1. Render > New > Web Service > conecta el repo.
2. Configura:
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Plan: Starter ($7/mes) para poder adjuntar disco
3. Settings > Disks > Add disk: mount path `/data`, 1 GB.

## Variables de entorno obligatorias (pestana Environment)

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | Generate (Render lo crea automatico) |
| `ADMIN_USER` | `admin` |
| `ADMIN_PASSWORD` | Tu contrasena de administrador |
| `DB_PATH` | `/data/centinela.db` |
| `PUBLIC_DASHBOARD_URL` | `https://TU-APP.onrender.com` |
| `CORS_ORIGINS` | `https://TU-APP.onrender.com` |
| `DEMO_PAYMENTS` | `false` |
| `ALLOW_LEGACY_BASIC` | `false` |

## Respaldos automaticos

- En produccion el servidor crea un respaldo **diario** de la base en
  `/data/backups/` (los ultimos 14 se conservan, los mas viejos se eliminan).
- Respaldo manual inmediato (admin): `POST /api/admin/backup`.
- Para restaurar: detener el servicio, reemplazar `/data/centinela.db` por el
  respaldo elegido y desplegar de nuevo.

## Endurecimiento de seguridad (recomendado)

1. **Rotar secretos periodicamente** (Render > Environment > Generate):
   - `JWT_SECRET`: invalida todas las sesiones existentes.
   - `ADMIN_PASSWORD`: usar 16+ caracteres, generador de contrasenas.
2. CSP estricto activo en `/dashboard` (sin scripts/estilos inline).
3. Los respaldos contienen datos personales: no los descargues a equipos
   compartidos y borra los antiguos.

## URL final

`https://centinela-os.onrender.com` - acceso desde cualquier red abierta.

## Notas

- **WebSocket**: Render soporta WebSockets (canal de comandos en tiempo real).
- **Disco**: en Free el disco es temporal y la base se reinicia en cada deploy;
  usa Starter con disco persistente para datos reales.
- **Sleep**: el servicio Free se duerme tras 15 min sin trafico; el plan
  Starter no se duerme.
