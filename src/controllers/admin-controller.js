const db = require('../db');
const { HttpError } = require('../utils/http');
const { limit, integer } = require('../utils/validation');
const { publicUser } = require('../utils/users');
const { hashPassword, randomPassword } = require('../utils/password');

function stats(req, res) {
  const totalUsers = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role IN ('client', 'user')").get().count;
  const totalDevices = db.prepare('SELECT COUNT(*) AS count FROM devices').get().count;
  const totalLicenses = db.prepare('SELECT COUNT(*) AS count FROM licenses').get().count;
  const activeLicenses = db.prepare("SELECT COUNT(*) AS count FROM licenses WHERE status = 'active' AND expires_at > datetime('now')").get().count;
  const estimatedRevenue = db.prepare("SELECT COALESCE(SUM(price), 0) AS value FROM licenses WHERE status <> 'revoked'").get().value;
  const pendingRegistrations = db.prepare("SELECT COUNT(*) AS count FROM registrations WHERE status = 'pending'").get().count;
  const monthlyRevenue = db.prepare(`SELECT substr(COALESCE(created_at, issued_at), 1, 7) AS month,
    COALESCE(SUM(price), 0) AS amount FROM licenses WHERE status <> 'revoked'
    GROUP BY month ORDER BY month DESC LIMIT 12`).all().reverse();
  return res.json({ totalUsers, totalDevices, totalLicenses, activeLicenses, estimatedRevenue, pendingRegistrations, monthlyRevenue });
}

function users(req, res) {
  const rows = db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM device_owners o WHERE o.user_id = u.id) AS device_count
    FROM users u WHERE u.role IN ('client', 'user') ORDER BY u.created_at DESC LIMIT ?`).all(limit(req.query.limit, 100));
  return res.json({ users: rows.map((row) => ({ ...publicUser(row), deviceCount: row.device_count })) });
}

function deleteUser(req, res) {
  const id = integer(req.params.id, 'id', { min: 1 });
  const user = db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('client', 'user')").get(id);
  if (!user) throw new HttpError(404, 'Cliente no encontrado', 'user_not_found');
  db.prepare('DELETE FROM device_owners WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM licenses WHERE client_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return res.json({ success: true, id, deleted: true });
}

function resetPassword(req, res) {
  const id = integer(req.params.id, 'id', { min: 1 });
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND role IN ('client', 'user')").get(id);
  if (!user) throw new HttpError(404, 'Cliente no encontrado', 'user_not_found');
  const password = randomPassword();
  db.prepare('UPDATE users SET password_hash = ?, setup_pending = 0 WHERE id = ?').run(hashPassword(password), id);
  return res.json({ success: true, id, username: user.username, email: user.email, password });
}

async function backupNow(req, res) {
  const backup = require('../utils/backup');
  const result = await backup.createBackup();
  return res.status(201).json({ success: true, backup: result.name });
}

module.exports = { stats, users, deleteUser, resetPassword, backupNow };
