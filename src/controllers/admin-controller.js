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
  const storeAddress = text(req.body.storeAddress || req.body.address, 'storeAddress', { required: false, max: 200 });
  const depositBank = text(req.body.depositBank || req.body.bank, 'depositBank', { required: false, max: 80 });
  const depositAccount = text(req.body.depositAccount || req.body.account, 'depositAccount', { required: false, max: 80 });
  const depositHolder = text(req.body.depositHolder || req.body.holder, 'depositHolder', { required: false, max: 120 });
  const commissionRate = req.body.commissionRate !== undefined ? Number(req.body.commissionRate) : 20;
  if (isNaN(commissionRate) || commissionRate < 0 || commissionRate > 50) throw new HttpError(400, 'Comisión debe ser 0-50%', 'validation_error');
  const payoutMode = text(req.body.payoutMode || req.body.mode, 'payoutMode', { required: false, max: 30 }) || 'store_collects';
  if (!['store_collects','server_collects'].includes(payoutMode)) throw new HttpError(400, 'Modo de cobro inválido', 'validation_error');
  const storePhone = text(req.body.storePhone || req.body.phone2, 'storePhone', { required: false, max: 40 });
  const storeNotes = text(req.body.storeNotes || req.body.notes, 'storeNotes', { required: false, max: 500 });
  const exists = await db.get('SELECT id FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($2)', [username, userEmail]);
  if (exists) throw new HttpError(409, 'Usuario o email ya existe', 'conflict');
  const result = await db.run(`INSERT INTO users (name, username, email, phone, password_hash, role, store_address, store_deposit_bank, store_deposit_account, store_deposit_holder, store_commission_rate, store_payout_mode, store_notes)
    VALUES ($1,$2,$3,$4,$5,'store',$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [name, username, userEmail, storePhone, hashPassword(rawPassword), storeAddress, depositBank, depositAccount, depositHolder, commissionRate, payoutMode, storeNotes]);
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

async function updateStore(req, res) {
  const id = integer(req.params.id, 'id', { min: 1 });
  const store = await db.get("SELECT * FROM users WHERE id = $1 AND role = 'store'", [id]);
  if (!store) throw new HttpError(404, 'Tienda no encontrada', 'store_not_found');
  const { text } = require('../utils/validation');
  const fields = {};
  if (req.body.name !== undefined) fields.name = text(req.body.name, 'name', { max: 120 });
  if (req.body.storeAddress !== undefined) fields.store_address = text(req.body.storeAddress, 'storeAddress', { required: false, max: 200 });
  if (req.body.depositBank !== undefined) fields.store_deposit_bank = text(req.body.depositBank, 'depositBank', { required: false, max: 80 });
  if (req.body.depositAccount !== undefined) fields.store_deposit_account = text(req.body.depositAccount, 'depositAccount', { required: false, max: 80 });
  if (req.body.depositHolder !== undefined) fields.store_deposit_holder = text(req.body.depositHolder, 'depositHolder', { required: false, max: 120 });
  if (req.body.commissionRate !== undefined) {
    const v = Number(req.body.commissionRate);
    if (isNaN(v) || v < 0 || v > 50) throw new HttpError(400, 'Comisión 0-50', 'validation_error');
    fields.store_commission_rate = v;
  }
  if (req.body.payoutMode !== undefined) {
    const m = text(req.body.payoutMode, 'payoutMode', { required: false, max: 30 });
    if (m && !['store_collects','server_collects'].includes(m)) throw new HttpError(400, 'Modo inválido', 'validation_error');
    if (m) fields.store_payout_mode = m;
  }
  if (req.body.storeNotes !== undefined) fields.store_notes = text(req.body.storeNotes, 'storeNotes', { required: false, max: 500 });
  if (req.body.phone !== undefined) fields.phone = text(req.body.phone, 'phone', { required: false, max: 40 });
  if (Object.keys(fields).length === 0) throw new HttpError(400, 'Nada para actualizar', 'validation_error');
  const sets = Object.keys(fields).map((k,i)=>`${k} = $${i+1}`).join(', ');
  const vals = Object.values(fields);
  vals.push(id);
  await db.run(`UPDATE users SET ${sets}, updated_at = NOW() WHERE id = $${vals.length}`, vals);
  const updated = await db.get('SELECT * FROM users WHERE id = $1', [id]);
  return res.json({ success: true, store: publicUser(updated) });
}

async function uploadStorePhoto(req, res) {
  const id = integer(req.params.id, 'id', { min: 1 });
  const store = await db.get("SELECT id FROM users WHERE id = $1 AND role = 'store'", [id]);
  if (!store) throw new HttpError(404, 'Tienda no encontrada', 'store_not_found');
  if (!req.file) throw new HttpError(400, 'Foto requerida', 'validation_error');
  const url = `/uploads/${req.file.filename}`;
  await db.run('UPDATE users SET store_photo_url = $1, updated_at = NOW() WHERE id = $2', [url, id]);
  return res.json({ success: true, photoUrl: url });
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

module.exports = { stats, users, deleteUser, resetPassword, createStore, listStores, deleteStore, updateStore, uploadStorePhoto, storeStats };
