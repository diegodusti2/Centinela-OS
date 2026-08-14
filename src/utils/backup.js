const fs = require('fs');
const path = require('path');
const db = require('../db');
const config = require('../config/env');

const BACKUP_DIR = path.join(config.projectRoot, 'data', 'backups');
const MAX_BACKUPS = 14;

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

async function createBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `centinela-${timestamp()}.db`;
  const dest = path.join(BACKUP_DIR, name);
  // better-sqlite3 realiza el respaldo online consistente (WAL seguro).
  await db.backup(dest);
  pruneBackups();
  return { name, path: dest };
}

function pruneBackups() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => /^centinela-\d{8}-\d{4}\.db$/.test(f))
    .sort()
    .reverse();
  for (const old of files.slice(MAX_BACKUPS)) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch (_) {}
  }
}

function scheduleDaily() {
  const hours = 24 * 60 * 60 * 1000;
  // Primer respaldo a los 10 min del arranque y luego cada 24 h.
  setTimeout(() => {
    createBackup().then((b) => console.log(`[backup] ${b.name}`)).catch((e) => console.error('[backup] error', e.message));
    setInterval(() => {
      createBackup().then((b) => console.log(`[backup] ${b.name}`)).catch((e) => console.error('[backup] error', e.message));
    }, hours);
  }, 10 * 60 * 1000);
}

module.exports = { createBackup, scheduleDaily };
