const db = require('../db');
const license = require('../license');
const { PLANS } = require('../constants');
const { HttpError } = require('../utils/http');
const { hashPassword, randomPassword } = require('../utils/password');
const { publicUser } = require('../utils/users');
const { addMonths, licenseView } = require('./license-controller');
const { integer, limit, text } = require('../utils/validation');

function slug(value) {
  return String(value || 'client').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 36) || 'client';
}

function uniqueUsername(base) {
  let candidate = base;
  let suffix = 1;
  while (db.prepare('SELECT id FROM users WHERE username = ?').get(candidate)) {
    suffix += 1;
    candidate = `${base}.${suffix}`;
  }
  return candidate;
}

function approveRegistration(registrationId, issuedBy) {
  const registration = db.prepare('SELECT * FROM registrations WHERE id = ?').get(registrationId);
  if (!registration) throw new HttpError(404, 'Solicitud no encontrada', 'registration_not_found');
  if (registration.status !== 'pending' && registration.status !== 'paid') throw new HttpError(409, 'La solicitud ya fue procesada', 'registration_processed');
  const months = Number(registration.plan);
  if (!PLANS[months]) throw new HttpError(400, 'Plan no disponible', 'validation_error');
  const expiry = addMonths(new Date(), months);
  const code = license.generate(registration.device_id, expiry);
  const password = randomPassword();
  const username = uniqueUsername(slug(registration.email.split('@')[0] || registration.name));
  let createdUser;

  const transaction = db.transaction(() => {
    const userResult = db.prepare(`INSERT INTO users (name, username, email, phone, password_hash, role, setup_pending)
      VALUES (?, ?, ?, ?, ?, 'client', 1)`).run(
      registration.name, username, registration.email, registration.phone || '', hashPassword(password));
    createdUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userResult.lastInsertRowid);
    db.prepare(`INSERT INTO devices (id, device_uid, user_id, name, status, online)
      VALUES (?, ?, ?, ?, 'offline', 0)
      ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, name = excluded.name`).run(
      registration.device_id, registration.device_id, createdUser.id, registration.name);
    db.prepare('INSERT OR IGNORE INTO device_owners (device_id, user_id) VALUES (?, ?)').run(registration.device_id, createdUser.id);
    db.prepare(`INSERT INTO licenses (code, device_id, client_id, customer_name, customer_email, duration_months, price,
      status, type, expires_at, issued_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'standard', ?, ?)`).run(
      code, registration.device_id, createdUser.id, registration.name, registration.email, months, registration.price, expiry.toISOString(), issuedBy);
    db.prepare("UPDATE registrations SET status = 'approved', license_code = ?, processed_at = datetime('now') WHERE id = ?")
      .run(code, registration.id);
  });
  transaction();

  const createdLicense = db.prepare('SELECT * FROM licenses WHERE code = ?').get(code);
  return {
    success: true,
    code,
    license: licenseView(createdLicense),
    account: { username, email: registration.email, pendingSetup: true },
    user: publicUser(createdUser),
  };
}

function listRegistrations(req, res) {
  const rows = db.prepare('SELECT id, name, email, phone, device_id, license_code, plan, price, status, payment_method, receipt_image, created_at, processed_at FROM registrations ORDER BY created_at DESC LIMIT ?').all(limit(req.query.limit, 100));
  return res.json({ registrations: rows });
}

function approve(req, res) {
  const id = integer(req.params.id, 'id', { min: 1 });
  return res.status(201).json(approveRegistration(id, req.user.username));
}

function reject(req, res) {
  const id = integer(req.params.id, 'id', { min: 1 });
  const result = db.prepare("UPDATE registrations SET status = 'rejected', processed_at = datetime('now') WHERE id = ? AND status = 'pending'").run(id);
  if (!result.changes) throw new HttpError(404, 'Solicitud pendiente no encontrada', 'registration_not_found');
  return res.json({ success: true, id, status: 'rejected' });
}

function confirmDemoPayment(req, res) {
  const config = require('../config/env');
  if (!config.demoPayments) throw new HttpError(410, 'Los pagos demo estan desactivados. Usa un proveedor con webhook.', 'payment_disabled');
  const registrationId = integer(req.body.registrationId, 'registrationId', { min: 1 });
  const provider = text(req.body.provider, 'provider', { max: 30 }).toLowerCase();
  const transactionId = text(req.body.transactionId, 'transactionId', { max: 120 });
  if (provider !== 'demo') throw new HttpError(400, 'Solo se admite provider=demo en desarrollo', 'validation_error');
  if (!transactionId.startsWith('demo_')) throw new HttpError(400, 'transactionId demo no valido', 'validation_error');
  const registration = db.prepare('SELECT status, payment_reference FROM registrations WHERE id = ?').get(registrationId);
  if (!registration) throw new HttpError(404, 'Solicitud no encontrada', 'registration_not_found');
  if (registration.status !== 'pending') throw new HttpError(409, 'La solicitud ya fue procesada', 'registration_processed');
  if (registration.payment_reference && registration.payment_reference !== transactionId) {
    throw new HttpError(409, 'La referencia de pago ya fue utilizada', 'payment_replayed');
  }
  db.prepare("UPDATE registrations SET status = 'paid', payment_reference = ? WHERE id = ? AND status = 'pending'").run(transactionId, registrationId);
  return res.status(201).json(approveRegistration(registrationId, 'demo_payment'));
}

function checkStatus(req, res) {
  const id = integer(req.params.id, 'id', { min: 1 });
  const reg = db.prepare('SELECT id, name, email, status, license_code, plan, price, receipt_image, created_at, processed_at FROM registrations WHERE id = ?').get(id);
  if (!reg) throw new HttpError(404, 'Solicitud no encontrada', 'registration_not_found');
  if (reg.status === 'approved' && reg.license_code) {
    const lic = db.prepare('SELECT * FROM licenses WHERE code = ?').get(reg.license_code);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(lic ? lic.client_id : null);
    if (lic && user) {
      return res.json({
        id: reg.id,
        status: reg.status,
        licenseCode: lic.code,
        expiresAt: lic.expires_at,
        account: { username: user.username, email: user.email, pendingSetup: user.setup_pending === 1 },
      });
    }
  }
  return res.json({ id: reg.id, status: reg.status, processedAt: reg.processed_at });
}

module.exports = { listRegistrations, approve, reject, confirmDemoPayment, checkStatus, approveRegistration };
