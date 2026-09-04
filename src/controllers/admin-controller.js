const db = require('../db');
const { HttpError } = require('../utils/http');
const { limit, integer } = require('../utils/validation');
const { publicUser } = require('../utils/users');
const { hashPassword, randomPassword } = require('../utils/password');

async function stats(req, res) {
  const totalUsers = (await db.get("SELECT COUNT(*) AS count FROM users WHERE role IN ('client', 'user')")).count;
  const totalDevices = (await db.get('SELECT COUNT(*) AS count FROM devices')).count;
  const totalLicenses = (await db.get('SELECT COUNT(*) AS count FROM licenses')).count;
  const activeLicenses = (await db.get("SELECT COUNT(*) AS count FROM licenses WHERE status = 'active' AND expires_at > NOW()")).count;
  const estimatedRevenue = (await db.get("SELECT COALESCE(SUM(price), 0) AS value FROM licenses WHERE status <> 'revoked'")).value;
  const pendingRegistrations = (await db.get("SELECT COUNT(*) AS count FROM registrations WHERE status = 'pending'")).count;
  const monthlyRevenue = (await db.all(`SELECT TO_CHAR(COALESCE(created_at, issued_at), 'YYYY-MM') AS month,
    COALESCE(SUM(price), 0) AS amount FROM licenses WHERE status <> 'revoked'
    GROUP BY month ORDER BY month DESC LIMIT 12`)).reverse();
  return res.json({
    totalUsers: Number(totalUsers),
    totalDevices: Number(totalDevices),
    totalLicenses: Number(totalLicenses),
    activeLicenses: Number(activeLicenses),
    estimatedRevenue: Number(estimatedRevenue),
    pendingRegistrations: Number(pendingRegistrations),
    monthlyRevenue,
  });
}

async function users(req, res) {
  const rows = await db.all(`SELECT u.*, (SELECT COUNT(*) FROM device_owners o WHERE o.user_id = u.id) AS device_count
    FROM users u WHERE u.role IN ('client', 'user') ORDER BY u.created_at DESC LIMIT $1`, [limit(req.query.limit, 100)]);
  return res.json({ users: rows.map((row) => ({ ...publicUser(row), deviceCount: Number(row.device_count) })) });
}

async function deleteUser(req, res) {
  const id = integer(req.params.id, 'id', { min: 1 });
  const user = await db.get("SELECT id FROM users WHERE id = $1 AND role IN ('client', 'user')", [id]);
  if (!user) throw new HttpError(404, 'Cliente no encontrado', 'user_not_found');
  await db.run('DELETE FROM device_owners WHERE user_id = $1', [id]);
  await db.run('DELETE FROM licenses WHERE client_id = $1', [id]);
  await db.run('DELETE FROM users WHERE id = $1', [id]);
  return res.json({ success: true, id, deleted: true });
}

async function resetPassword(req, res) {
  const id = integer(req.params.id, 'id', { min: 1 });
  const user = await db.get("SELECT * FROM users WHERE id = $1 AND role IN ('client', 'user')", [id]);
  if (!user) throw new HttpError(404, 'Cliente no encontrado', 'user_not_found');
  const password = randomPassword();
  await db.run('UPDATE users SET password_hash = $1, setup_pending = 0 WHERE id = $2', [hashPassword(password), id]);
  return res.json({ success: true, id, username: user.username, email: user.email, password });
}

async function createStore(req, res) {
  const { text, email } = require('../utils/validation');
  const name = text(req.body.name, 'name', { max: 120 });
  const username = text(req.body.username, 'username', { max: 80 });
  const userEmail = email(req.body.email);
  const rawPassword = text(req.body.password, 'password', { max: 128 });
  if (rawPassword.length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres', 'validation_error');
  if (!/^[a-zA-Z0-9._-]{3,80}$/.test(username)) throw new HttpError(400, 'Username solo letras, numeros, punto, guion', 'validation_error');
  const exists = await db.get('SELECT id FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($2)', [username, userEmail]);
  if (exists) throw new HttpError(409, 'Usuario o email ya existe', 'conflict');
  const result = await db.run('INSERT INTO users (name, username, email, password_hash, role) VALUES ($1,$2,$3,$4,\'store\') RETURNING id', [name, username, userEmail, hashPassword(rawPassword)]);
  const created = await db.get('SELECT * FROM users WHERE id = $1', [result.lastInsertRowid]);
  return res.status(201).json({ success: true, store: publicUser(created) });
}

async function listStores(req, res) {
  const rows = await db.all("SELECT * FROM users WHERE role = 'store' ORDER BY created_at DESC LIMIT $1", [limit(req.query.limit, 100)]);
  return res.json({ stores: rows.map(publicUser) });
}

async function deleteStore(req, res) {
  const id = integer(req.params.id, 'id', { min: 1 });
  const store = await db.get("SELECT id FROM users WHERE id = $1 AND role = 'store'", [id]);
  if (!store) throw new HttpError(404, 'Tienda no encontrada', 'store_not_found');
  await db.run('DELETE FROM users WHERE id = $1', [id]);
  return res.json({ success: true, id, deleted: true });
}

async function storeStats(req, res) {
  const totalClients = (await db.get("SELECT COUNT(*) AS count FROM users WHERE role IN ('client','user')")).count;
  const pendingRegistrations = (await db.get("SELECT COUNT(*) AS count FROM registrations WHERE status = 'pending'")).count;
  const totalLicenses = (await db.get('SELECT COUNT(*) AS count FROM licenses')).count;
  const activeLicenses = (await db.get("SELECT COUNT(*) AS count FROM licenses WHERE status = 'active' AND expires_at > NOW()")).count;
  const totalStores = (await db.get("SELECT COUNT(*) AS count FROM users WHERE role = 'store'")).count;
  return res.json({
    totalClients: Number(totalClients),
    pendingRegistrations: Number(pendingRegistrations),
    totalLicenses: Number(totalLicenses),
    activeLicenses: Number(activeLicenses),
    totalStores: Number(totalStores),
  });
}

module.exports = { stats, users, deleteUser, resetPassword, createStore, listStores, deleteStore, storeStats };
