# Centinela OS Server

Servidor Node.js para licencias, clientes, dispositivos, ubicaciones GPS, eventos, capturas autorizadas y comandos remotos de Centinela OS.

## Requisitos

- Node.js 18 o superior
- npm
- SQLite mediante `better-sqlite3`

## Ejecucion local

```powershell
Copy-Item .env.example .env
# Edita .env y cambia JWT_SECRET y ADMIN_PASSWORD
npm ci
npm start
```

El servidor queda disponible en `http://localhost:3000`. El dashboard web se sirve desde el mismo proceso:

```text
http://localhost:3000/dashboard
```

## Variables principales

```text
NODE_ENV=development
HOST=0.0.0.0
PORT=3000
DB_PATH=./data/centinela.db
JWT_SECRET=secreto-local-de-32-caracteres-o-mas
ADMIN_USER=admin
ADMIN_PASSWORD=tu-contrasena-local
```

En produccion `JWT_SECRET` y `ADMIN_PASSWORD` son obligatorios. Nunca subas `.env` a GitHub.

## Funciones

- Administracion de clientes, licencias y solicitudes de pago.
- Registro de dispositivos con token exclusivo del telefono.
- Ubicacion GPS, itinerario y eventos de seguridad.
- Comandos autorizados: `loc`, `tra`, `son`, `sil`, `par`, `es`, `lock`, `foto` y `video`.
- `foto` y `video` representan capturas de pantalla autorizadas mediante MediaProjection.
- Canal bidireccional WebSocket en `/ws` con reconexion automatica.
- Informe HTML detallado en `GET /api/report/:deviceId`.
- Dashboard responsive con mapa, comandos, eventos, capturas y exportacion de informes.

## Endpoints esenciales

- `GET /health`
- `POST /api/auth/login`
- `GET /api/devices`
- `GET /api/devices/:id/locations`
- `GET /api/devices/:id/events`
- `POST /api/commands`
- `GET /api/commands/:deviceId`
- `GET /api/report/:deviceId`
- `GET /dashboard`

## Pruebas

```powershell
npm test
npm run check
./test_full.ps1 -StartServer
```

Para una prueba en la red WiFi local:

```powershell
./test_wifi.ps1 -StartServer -StartDashboard
```

## Deploy en Render

El archivo `render.yaml` y la guia `DEPLOY_RENDER.md` dejan preparado el servicio web Node para Render Free.

Configuracion:

```text
Build Command: npm install
Start Command: npm start
Health Check: /health
```

En Render configura `NODE_ENV=production`, `ADMIN_PASSWORD`, `JWT_SECRET`, `PUBLIC_DASHBOARD_URL` y `CORS_ORIGINS`. El plan Free usa disco temporal; para datos persistentes utiliza un disco persistente o PostgreSQL.

## Seguridad

- No publiques `.env`, bases SQLite, capturas, comprobantes ni `node_modules`.
- Usa HTTPS/WSS en internet.
- Cambia la contrasena inicial del administrador.
- Concede captura de pantalla solo con consentimiento del propietario.
