const db = require('../db');
const { HttpError } = require('../utils/http');
const { email, password, text, object, plan } = require('../utils/validation');
const { hashPassword, verifyPassword, needsRehash } = require('../utils/password');
const { issueUserToken } = require('../utils/token');
const { publicUser } = require('../utils/users');
const { PLANS } = require('../constants');

function registerRequest(req, res) {
  const name = text(req.body.name, 'name', { max: 120 });
  const userEmail = email(req.body.email);
  const phone = text(req.body.phone, 'phone', { required: false, max: 40 });
  const deviceId = text(req.body.deviceId || req.body.deviceUid, 'deviceId', { max: 160 });
  const months = plan(req.body.plan);
  if (!PLANS[months]) throw new HttpError(400, 'Plan no disponible', 'validation_error');

  const duplicate = db.prepare("SELECT id FROM registrations WHERE lower(email) = lower(?) AND device_id = ? AND status = 'pending'").get(userEmail, deviceId);
  if (duplicate) throw new HttpError(409, 'Ya existe una solicitud pendiente para ese dispositivo', 'duplicate_registration');

  const result = db.prepare(`
    INSERT INTO registrations (name, email, phone, device_id, plan, price, payment_method, payload_json, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(name, userEmail, phone, deviceId, months, PLANS[months].price, text(req.body.paymentMethod || req.body.metadata?.payment || '', 'paymentMethod', { required: false, max: 40 }), JSON.stringify(object(req.body.metadata, 'metadata')));

  return res.status(202).json({
    success: true,
    registrationId: Number(result.lastInsertRowid),
    status: 'pending',
    plan: months,
    price: PLANS[months].price,
    message: 'Solicitud recibida. Un administrador debe aprobarla antes de activar la cuenta.',
  });
}

function login(req, res) {
  const identifier = text(req.body.identifier || req.body.username || req.body.email, 'username');
  const rawPassword = password(req.body.password);
  const user = db.prepare('SELECT * FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)').get(identifier, identifier);
  if (!user || !verifyPassword(rawPassword, user.password_hash)) {
    const pending = db.prepare("SELECT id FROM registrations WHERE lower(email) = lower(?) AND status = 'pending' ORDER BY id DESC LIMIT 1").get(identifier);
    if (pending) throw new HttpError(403, 'Tu solicitud esta pendiente de aprobacion administrativa', 'account_pending');
    throw new HttpError(401, 'Credenciales incorrectas', 'invalid_credentials');
  }
  if (needsRehash(user.password_hash)) {
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hashPassword(rawPassword), user.id);
  }
  const token = issueUserToken(user);
  const safe = publicUser(user);
  return res.json({ token, user: safe, username: safe.username, role: safe.role, email: safe.email });
}

function profile(req, res) {
  return res.json({ user: publicUser(req.user) });
}

function updateProfile(req, res) {
  const requestedUsername = req.body.username === undefined
    ? req.user.username
    : text(req.body.username, 'username', { max: 80 });
  if (!/^[a-zA-Z0-9._-]{3,80}$/.test(requestedUsername)) {
    throw new HttpError(400, 'username solo puede contener letras, numeros, punto, guion y guion bajo', 'validation_error');
  }
  const requestedName = req.body.name === undefined
    ? req.user.name
    : text(req.body.name, 'name', { max: 120 });
  const requestedEmail = req.body.email === undefined
    ? req.user.email
    : email(req.body.email);
  const requestedPhone = req.body.phone === undefined
    ? req.user.phone || ''
    : text(req.body.phone, 'phone', { required: false, max: 40 });
  const hasUsernameChange = requestedUsername.toLowerCase() !== req.user.username.toLowerCase();
  const hasPasswordChange = req.body.newPassword !== undefined && req.body.newPassword !== '';
  const currentPassword = req.body.currentPassword === undefined ? '' : String(req.body.currentPassword);

  if ((hasUsernameChange || hasPasswordChange) && !verifyPassword(currentPassword, req.user.password_hash)) {
    throw new HttpError(401, 'La contraseña actual no es valida', 'invalid_current_password');
  }
  if (hasPasswordChange) password(req.body.newPassword);

  const conflict = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?) AND id <> ?').get(requestedUsername, req.user.id);
  if (conflict) throw new HttpError(409, 'Ese usuario ya esta en uso', 'username_taken');

  const nextHash = hasPasswordChange ? hashPassword(String(req.body.newPassword)) : req.user.password_hash;
  db.prepare(`UPDATE users SET name = ?, username = ?, email = ?, phone = ?, password_hash = ?, updated_at = datetime('now')
    WHERE id = ?`).run(requestedName, requestedUsername, requestedEmail, requestedPhone, nextHash, req.user.id);

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const safe = publicUser(updated);
  return res.json({ token: issueUserToken(updated), user: safe, username: safe.username, role: safe.role, email: safe.email });
}

function logout(req, res) {
  return res.json({ success: true });
}

module.exports = { registerRequest, login, profile, updateProfile, logout };
