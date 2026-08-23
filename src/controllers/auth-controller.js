const db = require('../db');
const { HttpError } = require('../utils/http');
const { email, password, text, object, plan } = require('../utils/validation');
const { hashPassword, verifyPassword, needsRehash } = require('../utils/password');
const { issueUserToken, issueResetToken, verifyResetToken } = require('../utils/token');
const { publicUser } = require('../utils/users');
const { PLANS } = require('../constants');

async function registerRequest(req, res) {
  const name = text(req.body.name, 'name', { max: 120 });
  const userEmail = email(req.body.email);
  const phone = text(req.body.phone, 'phone', { required: false, max: 40 });
  const deviceId = text(req.body.deviceId || req.body.deviceUid, 'deviceId', { max: 160 });
  const months = plan(req.body.plan);
  if (!PLANS[months]) throw new HttpError(400, 'Plan no disponible', 'validation_error');

  const duplicate = await db.get("SELECT id FROM registrations WHERE lower(email) = lower($1) AND device_id = $2 AND status = 'pending'", [userEmail, deviceId]);
  if (duplicate) throw new HttpError(409, 'Ya existe una solicitud pendiente para ese dispositivo', 'duplicate_registration');

  const result = await db.run(`
    INSERT INTO registrations (name, email, phone, device_id, plan, price, payment_method, payload_json, status)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending') RETURNING id`,
    [name, userEmail, phone, deviceId, months, PLANS[months].price, text(req.body.paymentMethod || req.body.metadata?.payment || '', 'paymentMethod', { required: false, max: 40 }), JSON.stringify(object(req.body.metadata, 'metadata'))]);

  return res.status(202).json({
    success: true,
    registrationId: Number(result.lastInsertRowid),
    status: 'pending',
    plan: months,
    price: PLANS[months].price,
    message: 'Solicitud recibida. Un administrador debe aprobarla antes de activar la cuenta.',
  });
}

async function login(req, res) {
  const identifier = text(req.body.identifier || req.body.username || req.body.email, 'username');
  const rawPassword = password(req.body.password);
  const user = await db.get('SELECT * FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($2)', [identifier, identifier]);
  if (!user || !verifyPassword(rawPassword, user.password_hash)) {
    const pending = await db.get("SELECT id FROM registrations WHERE lower(email) = lower($1) AND status = 'pending' ORDER BY id DESC LIMIT 1", [identifier]);
    if (pending) throw new HttpError(403, 'Tu solicitud esta pendiente de aprobacion administrativa', 'account_pending');
    throw new HttpError(401, 'Credenciales incorrectas', 'invalid_credentials');
  }
  if (needsRehash(user.password_hash)) {
    await db.run('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hashPassword(rawPassword), user.id]);
  }
  const token = issueUserToken(user);
  const safe = publicUser(user);
  return res.json({ token, user: safe, username: safe.username, role: safe.role, email: safe.email });
}

function profile(req, res) {
  return res.json({ user: publicUser(req.user) });
}

async function updateProfile(req, res) {
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

  const conflict = await db.get('SELECT id FROM users WHERE lower(username) = lower($1) AND id <> $2', [requestedUsername, req.user.id]);
  if (conflict) throw new HttpError(409, 'Ese usuario ya esta en uso', 'username_taken');

  const nextHash = hasPasswordChange ? hashPassword(String(req.body.newPassword)) : req.user.password_hash;
  await db.run('UPDATE users SET name = $1, username = $2, email = $3, phone = $4, password_hash = $5, updated_at = NOW() WHERE id = $6', [requestedName, requestedUsername, requestedEmail, requestedPhone, nextHash, req.user.id]);

  const updated = await db.get('SELECT * FROM users WHERE id = $1', [req.user.id]);
  const safe = publicUser(updated);
  return res.json({ token: issueUserToken(updated), user: safe, username: safe.username, role: safe.role, email: safe.email });
}

function logout(req, res) {
  return res.json({ success: true });
}

async function setupAccount(req, res) {
  const deviceId = text(req.body.deviceId, 'deviceId', { max: 160 });
  const licenseCode = text(req.body.licenseCode || req.body.code, 'licenseCode', { max: 80 }).toUpperCase();
  const requestedUsername = text(req.body.username, 'username', { max: 80 });
  const newPassword = password(req.body.password);
  if (!/^[a-zA-Z0-9._-]{3,80}$/.test(requestedUsername)) {
    throw new HttpError(400, 'username solo puede contener letras, numeros, punto, guion y guion bajo', 'validation_error');
  }

  const lic = await db.get('SELECT * FROM licenses WHERE code = $1', [licenseCode]);
  if (!lic) throw new HttpError(404, 'Licencia no reconocida', 'license_not_found');
  const expiry = db.toMs(lic.expires_at);
  if (lic.status === 'revoked' || lic.status === 'expired' || !Number.isFinite(expiry) || expiry <= Date.now()) {
    throw new HttpError(403, 'Licencia vencida o revocada', 'license_invalid');
  }
  if (lic.device_id && lic.device_id !== deviceId) throw new HttpError(403, 'Licencia de otro dispositivo', 'license_mismatch');
  if (!lic.client_id) throw new HttpError(400, 'La licencia no tiene cuenta asociada', 'license_no_account');
  const user = await db.get('SELECT * FROM users WHERE id = $1', [lic.client_id]);
  if (!user) throw new HttpError(404, 'Cuenta no encontrada', 'user_not_found');
  if (user.setup_pending !== 1) throw new HttpError(409, 'Esta cuenta ya fue configurada', 'account_configured');

  const conflict = await db.get('SELECT id FROM users WHERE lower(username) = lower($1) AND id <> $2', [requestedUsername, user.id]);
  if (conflict) throw new HttpError(409, 'Ese usuario ya esta en uso', 'username_taken');

  await db.run('UPDATE users SET username = $1, password_hash = $2, setup_pending = 0, updated_at = NOW() WHERE id = $3', [requestedUsername, hashPassword(newPassword), user.id]);
  const updated = await db.get('SELECT * FROM users WHERE id = $1', [user.id]);
  const safe = publicUser(updated);
  return res.json({ token: issueUserToken(updated), user: safe, username: safe.username, role: safe.role, email: safe.email });
}

function normalizeName(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function resetRequest(req, res) {
  const name = text(req.body.name, 'name', { max: 120 });
  const userEmail = email(req.body.email);
  const deviceId = text(req.body.deviceId, 'deviceId', { max: 160 });

  const user = await db.get('SELECT * FROM users WHERE lower(email) = lower($1)', [userEmail]);
  const device = user ? await db.get('SELECT * FROM devices WHERE id = $1 AND user_id = $2', [deviceId, user.id]) : null;
  const registration = await db.get("SELECT * FROM registrations WHERE lower(email) = lower($1) AND device_id = $2 AND status = 'approved' ORDER BY id DESC LIMIT 1", [userEmail, deviceId]);
  const userMatches = Boolean(user && normalizeName(user.name) === normalizeName(name));
  const regMatches = Boolean(registration && normalizeName(registration.name) === normalizeName(name));
  if (!user || !device || (!userMatches && !regMatches)) {
    throw new HttpError(400, 'Los datos no coinciden con los del registro', 'identity_mismatch');
  }

  const resetToken = issueResetToken(user.id);
  return res.json({ success: true, resetToken, username: user.username });
}

async function resetPassword(req, res) {
  const resetToken = text(req.body.resetToken || req.body.token, 'resetToken', { max: 500 });
  const newPassword = password(req.body.newPassword || req.body.password);
  let payload;
  try {
    payload = verifyResetToken(resetToken);
  } catch (_) {
    throw new HttpError(400, 'El enlace de restablecimiento no es valido o expiro', 'invalid_reset_token');
  }
  const user = await db.get('SELECT * FROM users WHERE id = $1', [Number(payload.sub)]);
  if (!user) throw new HttpError(404, 'Cuenta no encontrada', 'user_not_found');
  await db.run('UPDATE users SET password_hash = $1, setup_pending = 0, updated_at = NOW() WHERE id = $2', [hashPassword(newPassword), user.id]);
  return res.json({ success: true, username: user.username });
}

module.exports = { registerRequest, login, profile, updateProfile, logout, setupAccount, resetRequest, resetPassword };
