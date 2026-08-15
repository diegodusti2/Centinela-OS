// Load configuration before the database module so .env is available everywhere.
const http = require('http');
const path = require('path');
const config = require('./config/env');
const db = require('./db');
const app = require('./app');
const ws = require('./ws');
const backup = require('./utils/backup');
const { hashPassword } = require('./utils/password');

// Apagado limpio: cierra el WebSocket y la base antes de terminar el proceso
// (Render envia SIGTERM en cada deploy).
function shutdown(signal) {
  console.log(`[${signal}] Apagando Centinela OS...`);
  try { db.close(); } catch (_) {}
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

function seedAdmin() {
  const existing = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (existing) return;
  if (!config.adminPassword) throw new Error('ADMIN_PASSWORD es obligatorio para crear el administrador');
  db.prepare(`INSERT INTO users (name, username, email, password_hash, role)
    VALUES (?, ?, ?, ?, 'admin')`).run(
    'Administrador',
    config.adminUser,
    `${config.adminUser}@localhost`,
    hashPassword(config.adminPassword),
  );
  if (!config.isProduction) console.warn(`Administrador local creado: ${config.adminUser}. Cambia ADMIN_PASSWORD antes de desplegar.`);
}

seedAdmin();

const server = http.createServer(app);

if (require.main === module) {
  ws.init(server);
  // Respaldo diario automatico de la base de datos (produccion).
  if (config.isProduction) backup.scheduleDaily();
  // Alerta temprana: en produccion la base debe vivir en un disco
  // persistente (/data); cualquier otra ubicacion se pierde al desplegar.
  if (config.isProduction && path.dirname(config.dbPath) !== '/data') {
    console.warn('[WARN] La base NO esta en un disco persistente. '
      + `dbPath=${config.dbPath}. Adjunta el disco en Render (mount /data) y usa DB_PATH=/data/centinela.db.`);
  }
  server.listen(config.port, config.host, () => {
    console.log(`Centinela OS v3.0.0 escuchando en http://${config.host}:${config.port}`);
  });
}

// Export the Express app directly for the existing API tests and tooling.
// The shared HTTP server remains available for the production entrypoint.
module.exports = app;
module.exports.server = server;
