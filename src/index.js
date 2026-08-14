// Load configuration before the database module so .env is available everywhere.
const http = require('http');
const config = require('./config/env');
const db = require('./db');
const app = require('./app');
const ws = require('./ws');
const backup = require('./utils/backup');
const { hashPassword } = require('./utils/password');

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
  server.listen(config.port, config.host, () => {
    console.log(`Centinela OS v3.0.0 escuchando en http://${config.host}:${config.port}`);
  });
}

// Export the Express app directly for the existing API tests and tooling.
// The shared HTTP server remains available for the production entrypoint.
module.exports = app;
module.exports.server = server;
