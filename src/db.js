const { Pool } = require('pg');
const config = require('./config/env');

// Adaptador PostgreSQL. Reemplaza a better-sqlite3: expone helpers async
// (get/all/run/tx) para minimizar cambios en controladores y middleware.
// En los tests se puede inyectar un pool de pg-mem con setPool().

let poolOverride = null;

function createPool() {
  // node-postgres no soporta el parametro "channel_binding" de Neon: se elimina
  // para que la URL de Neon se pueda usar tal cual.
  const url = String(config.databaseUrl)
    .replace(/[?&]channel_binding=[^&]*/g, '')
    .replace(/\?$/, '');
  return new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    max: 10,
    connectionTimeoutMillis: 10000,
  });
}

let pool = null;
function getPool() {
  if (poolOverride) return poolOverride;
  if (!pool) pool = createPool();
  return pool;
}

function setPool(p) {
  poolOverride = p;
  pool = null;
}

async function query(text, params = []) {
  return getPool().query(text, params);
}

async function get(text, params = []) {
  const r = await getPool().query(text, params);
  return r.rows[0];
}

async function all(text, params = []) {
  const r = await getPool().query(text, params);
  return r.rows;
}

// Emula mejor-sqlite3 run(): devuelve { changes, lastInsertRowid }.
// Para obtener lastInsertRowid el INSERT debe terminar en "RETURNING id".
async function run(text, params = []) {
  const r = await getPool().query(text, params);
  const id = r.rows && r.rows[0] ? r.rows[0].id : undefined;
  return { changes: r.rowCount, lastInsertRowid: id };
}

// Transaccion: ejecuta fn(q) dentro de BEGIN/COMMIT/ROLLBACK, donde q es un
// helper de consultas acotado al cliente de la transaccion.
async function tx(fn) {
  const client = await getPool().connect();
  const q = {
    get: async (t, p = []) => (await client.query(t, p)).rows[0],
    all: async (t, p = []) => (await client.query(t, p)).rows,
    run: async (t, p = []) => {
      const r = await client.query(t, p);
      const id = r.rows && r.rows[0] ? r.rows[0].id : undefined;
      return { changes: r.rowCount, lastInsertRowid: id };
    },
  };
  try {
    await client.query('BEGIN');
    const out = await fn(q);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Convierte un valor de timestamp (Date de pg o string ISO) a milisegundos.
function toMs(value) {
  if (value == null) return NaN;
  if (value instanceof Date) return value.getTime();
  return Date.parse(String(value));
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'client',
  setup_pending INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  device_uid TEXT NOT NULL DEFAULT '',
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  android_version TEXT NOT NULL DEFAULT '',
  ip_address TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'offline',
  battery_level INTEGER,
  battery INTEGER,
  last_seen TIMESTAMPTZ,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_lat REAL,
  last_lng REAL,
  online INTEGER NOT NULL DEFAULT 0,
  shield_armed INTEGER NOT NULL DEFAULT 0,
  server_url TEXT NOT NULL DEFAULT '',
  device_token_hash TEXT,
  device_info_json TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS licenses (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  duration_months INTEGER NOT NULL DEFAULT 1,
  price REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  device_id TEXT,
  client_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'standard',
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS locations (
  id SERIAL PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  altitude REAL,
  accuracy REAL,
  speed REAL,
  bearing REAL,
  battery_level INTEGER,
  battery INTEGER,
  event TEXT NOT NULL DEFAULT 'tracking',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL DEFAULT 'OTHER',
  type TEXT NOT NULL DEFAULT 'OTHER',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  description TEXT NOT NULL DEFAULT '',
  latitude REAL,
  longitude REAL,
  image_url TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commands (
  id SERIAL PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  command_type TEXT NOT NULL DEFAULT '',
  command TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload TEXT NOT NULL DEFAULT '{}',
  params TEXT NOT NULL DEFAULT '{}',
  result TEXT,
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_owners (
  id SERIAL PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (device_id, user_id)
);

CREATE TABLE IF NOT EXISTS registrations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  device_id TEXT NOT NULL,
  license_code TEXT,
  plan INTEGER NOT NULL,
  price REAL NOT NULL,
  payment_reference TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  payment_method TEXT NOT NULL DEFAULT '',
  receipt_image TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_uid ON devices(device_uid);
CREATE INDEX IF NOT EXISTS idx_locations_device_time ON locations(device_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_device_time ON events(device_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_commands_device_status ON commands(device_id, status);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_registrations_status ON registrations(status, created_at);
`;

let initialized = false;

async function init() {
  if (initialized) return true;
  await getPool().query(SCHEMA);
  // Migración para tiendas: añade columnas si no existen (compat con DBs ya creadas)
  await getPool().query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS store_photo_url TEXT NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS store_address TEXT NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS store_deposit_bank TEXT NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS store_deposit_account TEXT NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS store_deposit_holder TEXT NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS store_commission_rate REAL NOT NULL DEFAULT 20;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS store_payout_mode TEXT NOT NULL DEFAULT 'store_collects';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS store_notes TEXT NOT NULL DEFAULT '';
  `);
  initialized = true;
  return true;
}

async function close() {
  if (pool && !poolOverride) return pool.end();
}

module.exports = { get, all, run, query, tx, init, close, toMs, setPool };
