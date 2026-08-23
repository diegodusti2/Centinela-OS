const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const config = require('../config/env');

// Persistencia de la base de datos en GitHub para el plan free de Render:
// el disco es efimero y cada deploy (o reinicio tras dormir) lo borra. Este
// modulo sube una copia comprimida a un repositorio privado y la restaura al
// arrancar si la base local esta vacia.
//
// Configuracion (variables de entorno):
//   DB_BACKUP_REPO   = "propietario/repo" (repositorio PRIVADO de respaldo)
//   DB_BACKUP_TOKEN  = PAT de GitHub con permiso "Contents" (read/write)
//   DB_BACKUP_PATH   = ruta del archivo en el repo (defecto centinela.db.gz)
//   DB_BACKUP_BRANCH = rama (defecto main)

const REPO = config.dbBackupRepo;
const FILE = config.dbBackupPath;
const BRANCH = config.dbBackupBranch;

function enabled() {
  return Boolean(REPO && config.dbBackupToken);
}

function contentsUrl() {
  return `https://api.github.com/repos/${REPO}/contents/${FILE}`;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${config.dbBackupToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'centinela-os',
  };
}

// Descarga el respaldo de forma sincrona (curl esta disponible en Render).
// Se usa sincrono para poder restaurar ANTES de que better-sqlite3 abra la base.
function _downloadSync(url) {
  const args = [
    '-fsSL',
    '-H', `Authorization: Bearer ${config.dbBackupToken}`,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'X-GitHub-Api-Version: 2022-11-28',
    '-H', 'User-Agent: centinela-os',
    `${url}?ref=${BRANCH}`,
  ];
  return execFileSync('curl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// Restaura la base desde GitHub si el archivo local no existe o esta vacio.
// Debe ejecutarse antes de abrir la conexion de better-sqlite3.
function restoreIfMissing() {
  if (!enabled()) return false;
  const dbFile = config.dbPath;
  try {
    if (fs.existsSync(dbFile) && fs.statSync(dbFile).size > 0) return false;
  } catch (_) {
    /* sigue: no se puede leer, intenta restaurar */
  }
  try {
    const raw = _downloadSync(contentsUrl());
    const data = JSON.parse(raw);
    const encoded = data && data.content;
    if (!encoded) return false;
    const content = Buffer.from(encoded, 'base64');
    let db = content;
    try { db = zlib.gunzipSync(content); } catch (_) { /* sin comprimir */ }
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    fs.writeFileSync(dbFile, db);
    console.log('[dbSync] Base restaurada desde GitHub.');
    return true;
  } catch (e) {
    console.log('[dbSync] Sin respaldo en GitHub (o error):', e.message);
    return false;
  }
}

// Obtiene el SHA del archivo actual (para actualizarlo). Devuelve null si no existe.
async function _currentSha() {
  const res = await fetch(`${contentsUrl()}?ref=${BRANCH}`, { headers: authHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET sha: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.sha || null;
}

// Respalda la base comprimida a GitHub (async, en segundo plano).
async function backup() {
  if (!enabled()) return;
  try {
    const db = require('../db');
    const tmp = path.join(os.tmpdir(), `centinela-${Date.now()}.db`);
    await db.backup(tmp);
    const gz = zlib.gzipSync(fs.readFileSync(tmp));
    fs.unlinkSync(tmp);

    const sha = await _currentSha();
    const body = {
      message: `backup ${new Date().toISOString()}`,
      content: gz.toString('base64'),
      branch: BRANCH,
    };
    if (sha) body.sha = sha;

    const res = await fetch(contentsUrl(), {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PUT backup: ${res.status} ${await res.text()}`);
    console.log('[dbSync] Respaldo subido a GitHub.');
  } catch (e) {
    console.error('[dbSync] Error al respaldar:', e.message);
  }
}

function schedule() {
  if (!enabled()) return;
  const ms = config.dbBackupIntervalMinutes * 60 * 1000;
  setInterval(() => { backup().catch(() => {}); }, ms);
  console.log(`[dbSync] Respaldo automatico cada ${config.dbBackupIntervalMinutes} min.`);
}

module.exports = { enabled, restoreIfMissing, backup, schedule };
