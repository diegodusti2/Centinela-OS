// Load configuration before the database module so .env is available everywhere.
const http = require('http');
const config = require('./config/env');
const db = require('./db');
const app = require('./app');
const ws = require('./ws');
const { hashPassword } = require('./utils/password');

// Apagado limpio: cierra el pool de PostgreSQL antes de terminar el proceso
// (Render envia SIGTERM en cada deploy).
function shutdown(signal) {
  console.log(`[${signal}] Apagando Centinela OS...`);
  db.close().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function seedAdmin() {
  const existing = await db.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (existing) return;
  if (!config.adminPassword) throw new Error('ADMIN_PASSWORD es obligatorio para crear el administrador');
  await db.run(`INSERT INTO users (name, username, email, password_hash, role)
    VALUES ($1, $2, $3, $4, 'admin')`,
    ['Administrador', config.adminUser, `${config.adminUser}@localhost`, hashPassword(config.adminPassword)]);
  if (!config.isProduction) console.warn(`Administrador local creado: ${config.adminUser}. Cambia ADMIN_PASSWORD antes de desplegar.`);
}

const server = http.createServer(app);

if (require.main === module) {
  (async () => {
    if (!config.databaseUrl) {
      console.warn('[WARN] DATABASE_URL no configurada: la base no persistira.');
    }
    await db.init();
    await seedAdmin();
    ws.init(server);
    server.listen(config.port, config.host, () => {
      console.log(`Centinela OS v3.0.0 escuchando en http://${config.host}:${config.port}`);
    });
  })().catch((e) => { console.error(e); process.exit(1); });
}

// Export the Express app directly for the existing API tests and tooling.
// The shared HTTP server remains available for the production entrypoint.
module.exports = app;
module.exports.server = server;
module.exports.seedAdmin = seedAdmin;
