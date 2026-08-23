const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config/env');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'client',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    device_uid TEXT NOT NULL DEFAULT '',
    user_id INTEGER,
    name TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    android_version TEXT NOT NULL DEFAULT '',
    ip_address TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'offline',
    battery_level INTEGER,
    last_seen TEXT,
    registered_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_lat REAL,
    last_lng REAL,
    battery INTEGER,
    online INTEGER NOT NULL DEFAULT 0,
    shield_armed INTEGER NOT NULL DEFAULT 0,
    server_url TEXT NOT NULL DEFAULT '',
    device_token_hash TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS licenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    duration_months INTEGER NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    device_id TEXT,
    client_id INTEGER,
    customer_name TEXT NOT NULL DEFAULT '',
    customer_email TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'standard',
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    issued_at TEXT NOT NULL DEFAULT (datetime('now')),
    issued_by TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    altitude REAL,
    accuracy REAL,
    speed REAL,
    bearing REAL,
    battery_level INTEGER,
    battery INTEGER,
    event TEXT NOT NULL DEFAULT 'tracking',
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    type TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    description TEXT NOT NULL DEFAULT '',
    latitude REAL,
    longitude REAL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    command_type TEXT NOT NULL,
    command TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    payload TEXT NOT NULL DEFAULT '{}',
    params TEXT NOT NULL DEFAULT '{}',
    result TEXT,
    requested_by INTEGER,
    expires_at TEXT,
    executed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS device_owners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(device_id, user_id),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    processed_at TEXT
  );
`);

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === column);
}

function addColumn(table, column, definition) {
  if (!hasColumn(table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Migrate databases created by the previous prototype without destroying local data.
[
  ['users', 'name', "TEXT NOT NULL DEFAULT ''"],
  ['users', 'phone', "TEXT NOT NULL DEFAULT ''"],
  ['users', 'updated_at', "TEXT NOT NULL DEFAULT ''"],
  ['users', 'setup_pending', 'INTEGER NOT NULL DEFAULT 0'],
  ['devices', 'device_uid', "TEXT NOT NULL DEFAULT ''"],
  ['devices', 'user_id', 'INTEGER'],
  ['devices', 'android_version', "TEXT NOT NULL DEFAULT ''"],
  ['devices', 'ip_address', "TEXT NOT NULL DEFAULT ''"],
  ['devices', 'status', "TEXT NOT NULL DEFAULT 'offline'"],
  ['devices', 'battery_level', 'INTEGER'],
  ['devices', 'battery', 'INTEGER'],
  ['devices', 'last_lat', 'REAL'],
  ['devices', 'last_lng', 'REAL'],
  ['devices', 'registered_at', "TEXT NOT NULL DEFAULT ''"],
  ['devices', 'online', 'INTEGER NOT NULL DEFAULT 0'],
  ['devices', 'shield_armed', 'INTEGER NOT NULL DEFAULT 0'],
  ['devices', 'server_url', "TEXT NOT NULL DEFAULT ''"],
  ['devices', 'device_token_hash', 'TEXT'],
  ['devices', 'device_info_json', "TEXT NOT NULL DEFAULT ''"],
  ['licenses', 'duration_months', 'INTEGER NOT NULL DEFAULT 1'],
  ['licenses', 'price', 'REAL NOT NULL DEFAULT 0'],
  ['licenses', 'client_id', 'INTEGER'],
  ['licenses', 'customer_name', "TEXT NOT NULL DEFAULT ''"],
  ['licenses', 'customer_email', "TEXT NOT NULL DEFAULT ''"],
  ['licenses', 'type', "TEXT NOT NULL DEFAULT 'standard'"],
  ['licenses', 'created_at', "TEXT NOT NULL DEFAULT ''"],
  ['licenses', 'issued_at', "TEXT NOT NULL DEFAULT ''"],
  ['licenses', 'issued_by', "TEXT NOT NULL DEFAULT ''"],
  ['locations', 'altitude', 'REAL'],
  ['locations', 'battery_level', 'INTEGER'],
  ['events', 'event_type', "TEXT NOT NULL DEFAULT 'OTHER'"],
  ['events', 'metadata_json', "TEXT NOT NULL DEFAULT '{}'"],
  ['events', 'created_at', "TEXT NOT NULL DEFAULT ''"],
  ['events', 'image_url', 'TEXT'],
  ['commands', 'command_type', "TEXT NOT NULL DEFAULT ''"],
  ['commands', 'payload', "TEXT NOT NULL DEFAULT '{}'"],
  ['commands', 'requested_by', 'INTEGER'],
  ['commands', 'expires_at', 'TEXT'],
  ['device_owners', 'id', 'INTEGER'],
  ['device_owners', 'assigned_at', "TEXT NOT NULL DEFAULT ''"],
  ['registrations', 'phone', "TEXT NOT NULL DEFAULT ''"],
  ['registrations', 'license_code', 'TEXT'],
  ['registrations', 'payload_json', "TEXT NOT NULL DEFAULT '{}'"],
  ['registrations', 'payment_reference', 'TEXT'],
  ['registrations', 'payment_method', "TEXT NOT NULL DEFAULT ''"],
  ['registrations', 'receipt_image', 'TEXT'],
].forEach(([table, column, definition]) => addColumn(table, column, definition));

db.exec(`
  UPDATE users SET role = 'client' WHERE role = 'user';
  UPDATE devices SET device_uid = id WHERE device_uid = '' OR device_uid IS NULL;
  UPDATE devices SET battery_level = battery WHERE battery_level IS NULL AND battery IS NOT NULL;
  UPDATE events SET event_type = type WHERE event_type = 'OTHER' OR event_type IS NULL;
  UPDATE commands SET command_type = command WHERE command_type = '' OR command_type IS NULL;
  UPDATE commands SET payload = params WHERE payload = '{}' AND params <> '{}';

  CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
  CREATE INDEX IF NOT EXISTS idx_devices_uid ON devices(device_uid);
  CREATE INDEX IF NOT EXISTS idx_locations_device_time ON locations(device_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_events_device_time ON events(device_id, timestamp);
  CREATE INDEX IF NOT EXISTS idx_commands_device_status ON commands(device_id, status);
  CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status, expires_at);
  CREATE INDEX IF NOT EXISTS idx_registrations_status ON registrations(status, created_at);
`);

module.exports = db;
