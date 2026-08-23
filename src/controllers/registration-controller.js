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

async function uniqueUsername(base) {
  let candidate = base;
  let suffix = 1;
  while (await db.get('SELECT id FROM users WHERE username = $1', [candidate])) {
    suffix += 1;
    candidate = `${base}.${suffix}`;
  }
  return candidate;
}

async function approveRegistration(registrationId, issuedBy) {
  const registration = await db.get('SELECT * FROM registrations WHERE id = $1', [registrationId]);
  if (!registration) throw new HttpError(404, 'Solicitud no encontrada', 'registration_not_found');
  if (registration.status !== 'pending' && registration.status !== 'paid') throw new HttpError(409, 'La solicitud ya fue procesada', 'registration_processed');
  const months = Number(registration.plan);
  if (!PLANS[months]) throw new HttpError(400, 'Plan no disponible', 'validation_error');
  const expiry = addMonths(new Date(), months);
  const code = license.generate(registration.device_id, expiry);
  const password = randomPassword();
  const username = await uniqueUsername(slug(registration.email.split('@')[0] || registration.name));

  const createdUser = await db.tx(async (q) => {
    const userResult = await q.run(`INSERT INTO users (name, username, email, phone, password_hash, role, setup_pending)
      VALUES ($1, $2, $3, $4, $5, 'client', 1) RETURNING id`,
      [registration.name, username, registration.email, registration.phone || '', hashPassword(password)]);
    const user = await q.get('SELECT * FROM users WHERE id = $1', [userResult.lastInsertRowid]);
    await q.run(`INSERT INTO devices (id, device_uid, user_id, name, status, online)
      VALUES ($1, $2, $3, $4, 'offline', 0)
      ON CONFLICT(id) DO UPDATE SET user_id = EXCLUDED.user_id, name = EXCLUDED.name`,
      [registration.device_id, registration.device_id, user.id, registration.name]);
    await q.run('INSERT INTO device_owners (device_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [registration.device_id, user.id]);
    await q.run(`INSERT INTO licenses (code, device_id, client_id, customer_name, customer_email, duration_months, price,
      status, type, expires_at, issued_by) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', 'standard', $8, $9)`,
      [code, registration.device_id, user.id, registration.name, registration.email, months, registration.price, expiry.toISOString(), issuedBy]);
    await q.run("UPDATE registrations SET status = 'approved', license_code = $1, processed_at = NOW() WHERE id = $2", [code, registration.id]);
    return user;
  });

  const createdLicense = await db.get('SELECT * FROM licenses WHERE code = $1', [code]);
  return {
    success: true,
    code,
    license: licenseView(createdLicense),
    account: { username, email: registration.email, pendingSetup: true },
    user: publicUser(createdUser),
  };
}

async function listRegistrations(req, res) {
  const rows = await db.all('SELECT id, name, email, phone, device_id, license_code, plan, price, status, payment_method, receipt_image, created_at, processed_at FROM registrations ORDER BY created_at DESC LIMIT $1', [limit(req.query.limit, 100)]);
  return res.json({ registrations: rows });
}

async function approve(req, res) {
  const id = integer(req.params.id, 'id', { min: 1 });
  return res.status(201).json(await approveRegistration(id, req.user.username));
}

async function reject(req, res) {
  const id = integer(req.params.id, 'id', { min: 1 });
  const result = await db.run("UPDATE registrations SET status = 'rejected', processed_at = NOW() WHERE id = $1 AND status = 'pending'", [id]);
  if (!result.changes) throw new HttpError(404, 'Solicitud pendiente no encontrada', 'registration_not_found');
  return res.json({ success: true, id, status: 'rejected' });
}

async function confirmDemoPayment(req, res) {
  const config = require('../config/env');
  if (!config.demoPayments) throw new HttpError(410, 'Los pagos demo estan desactivados. Usa un proveedor con webhook.', 'payment_disabled');
  const registrationId = integer(req.body.registrationId, 'registrationId', { min: 1 });
  const provider = text(req.body.provider, 'provider', { max: 30 }).toLowerCase();
  const transactionId = text(req.body.transactionId, 'transactionId', { max: 120 });
  if (provider !== 'demo') throw new HttpError(400, 'Solo se admite provider=demo en desarrollo', 'validation_error');
  if (!transactionId.startsWith('demo_')) throw new HttpError(400, 'transactionId demo no valido', 'validation_error');
  const registration = await db.get('SELECT status, payment_reference FROM registrations WHERE id = $1', [registrationId]);
  if (!registration) throw new HttpError(404, 'Solicitud no encontrada', 'registration_not_found');
  if (registration.status !== 'pending') throw new HttpError(409, 'La solicitud ya fue procesada', 'registration_processed');
  if (registration.payment_reference && registration.payment_reference !== transactionId) {
    throw new HttpError(409, 'La referencia de pago ya fue utilizada', 'payment_replayed');
  }
  await db.run("UPDATE registrations SET status = 'paid', payment_reference = $1 WHERE id = $2 AND status = 'pending'", [transactionId, registrationId]);
  return res.status(201).json(await approveRegistration(registrationId, 'demo_payment'));
}

async function checkStatus(req, res) {
  const id = integer(req.params.id, 'id', { min: 1 });
  const reg = await db.get('SELECT id, name, email, status, license_code, plan, price, receipt_image, created_at, processed_at FROM registrations WHERE id = $1', [id]);
  if (!reg) throw new HttpError(404, 'Solicitud no encontrada', 'registration_not_found');
  if (reg.status === 'approved' && reg.license_code) {
    const lic = await db.get('SELECT * FROM licenses WHERE code = $1', [reg.license_code]);
    const user = await db.get('SELECT * FROM users WHERE id = $1', [lic ? lic.client_id : null]);
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
