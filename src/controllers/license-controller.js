const db = require('../db');
const license = require('../license');
const config = require('../config/env');
const { PLANS } = require('../constants');
const { HttpError } = require('../utils/http');
const { text, email, integer, plan, limit } = require('../utils/validation');

function addMonths(from, months) {
  const expiry = new Date(from.getTime());
  expiry.setUTCMonth(expiry.getUTCMonth() + months);
  return expiry;
}

function licenseView(row) {
  return {
    id: row.id,
    code: row.code,
    durationMonths: row.duration_months,
    price: row.price,
    status: row.status,
    deviceId: row.device_id,
    clientId: row.client_id,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    expiresAt: row.expires_at,
    createdAt: row.created_at || row.issued_at,
    type: row.type,
  };
}

async function generateLicense(req, res) {
  const deviceId = text(req.body.deviceId, 'deviceId', { max: 160 });
  const months = plan(req.body.durationMonths || req.body.plan);
  if (!PLANS[months]) throw new HttpError(400, 'Plan no disponible', 'validation_error');
  const customerName = text(req.body.customerName || req.body.name, 'customerName', { required: false, max: 120 });
  const customerEmail = req.body.customerEmail || req.body.email ? email(req.body.customerEmail || req.body.email) : '';
  const clientId = req.body.clientId === undefined ? null : integer(req.body.clientId, 'clientId', { min: 1 });
  if (clientId !== null && !(await db.get("SELECT id FROM users WHERE id = $1 AND role IN ('client', 'user')", [clientId]))) {
    throw new HttpError(400, 'clientId no corresponde a un cliente', 'validation_error');
  }
  const expiresAt = addMonths(new Date(), months);
  const code = license.generate(deviceId, expiresAt);
  const result = await db.run(`INSERT INTO licenses (code, device_id, client_id, customer_name, customer_email,
    duration_months, price, status, type, expires_at, issued_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', 'standard', $8, $9) RETURNING id`,
    [code, deviceId, clientId, customerName, customerEmail, months, PLANS[months].price, expiresAt.toISOString(), req.user.username]);
  const row = await db.get('SELECT * FROM licenses WHERE id = $1', [result.lastInsertRowid]);
  return res.status(201).json({ ...licenseView(row), success: true });
}

function generateTestLicense(req, res) {
  if (config.isProduction) throw new HttpError(404, 'Ruta no disponible', 'not_found');
  const hours = integer(req.body.durationHours, 'durationHours', { min: 1, max: 72, defaultValue: 3 });
  const generated = license.generateTest(hours);
  return res.status(201).json({ code: generated.code, expiresAt: generated.expiry.toISOString(), type: 'test' });
}

async function validateLicense(req, res) {
  const code = text(req.body.code, 'code', { max: 80 }).toUpperCase();
  const deviceId = text(req.body.deviceId, 'deviceId', { max: 160 });
  const row = await db.get('SELECT * FROM licenses WHERE code = $1', [code]);
  if (!row) return res.json({ valid: false, error: 'Codigo no reconocido' });
  const expiry = db.toMs(row.expires_at);
  if (row.status === 'revoked' || row.status === 'expired' || !Number.isFinite(expiry) || expiry <= Date.now()) {
    if (row.status === 'active') await db.run("UPDATE licenses SET status = 'expired' WHERE id = $1", [row.id]);
    return res.json({ valid: false, error: 'Codigo vencido o revocado' });
  }
  if (row.device_id && row.device_id !== deviceId) return res.json({ valid: false, error: 'Licencia de otro dispositivo' });
  return res.json({ valid: true, expiry: row.expires_at, license: licenseView(row) });
}

async function listLicenses(req, res) {
  const status = req.query.status && req.query.status !== 'all' ? text(req.query.status, 'status', { max: 20 }) : null;
  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  let query, params;
  if (isAdmin) {
    query = status ? 'SELECT * FROM licenses WHERE status = $1 ORDER BY created_at DESC LIMIT $2' : 'SELECT * FROM licenses ORDER BY created_at DESC LIMIT $1';
    params = status ? [status, limit(req.query.limit, 100)] : [limit(req.query.limit, 100)];
  } else {
    query = status ? 'SELECT * FROM licenses WHERE client_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT $3' : 'SELECT * FROM licenses WHERE client_id = $1 ORDER BY created_at DESC LIMIT $2';
    params = status ? [req.user.id, status, limit(req.query.limit, 100)] : [req.user.id, limit(req.query.limit, 100)];
  }
  const rows = await db.all(query, params);
  return res.json({ licenses: rows.map(licenseView) });
}

async function stats(req, res) {
  const total = (await db.get('SELECT COUNT(*) AS count FROM licenses')).count;
  const active = (await db.get("SELECT COUNT(*) AS count FROM licenses WHERE status = 'active' AND expires_at > NOW()")).count;
  const revenue = (await db.get("SELECT COALESCE(SUM(price), 0) AS value FROM licenses WHERE status <> 'revoked'")).value;
  return res.json({ totalLicenses: Number(total), activeLicenses: Number(active), expiredLicenses: Number(total) - Number(active), estimatedRevenue: Number(revenue) });
}

async function deviceStatus(req, res) {
  const deviceId = text(req.params.deviceId, 'deviceId', { max: 160 });
  const row = await db.get("SELECT * FROM licenses WHERE device_id = $1 AND status = 'active' ORDER BY created_at DESC, id DESC LIMIT 1", [deviceId]);
  if (!row) return res.json({ active: false });
  const expiry = db.toMs(row.expires_at);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    await db.run("UPDATE licenses SET status = 'expired' WHERE id = $1 AND status = 'active'", [row.id]);
    return res.json({ active: false });
  }
  const user = row.client_id ? await db.get('SELECT * FROM users WHERE id = $1', [row.client_id]) : null;
  return res.json({
    active: true,
    expiresAt: row.expires_at,
    issuedAt: row.issued_at || row.created_at,
    licenseCode: row.code,
    pendingSetup: Boolean(user && user.setup_pending === 1),
    username: user ? user.username : null,
  });
}

async function revoke(req, res) {
  const id = integer(req.params.id, 'id', { min: 1 });
  const result = await db.run("UPDATE licenses SET status = 'revoked' WHERE id = $1 AND status <> 'revoked'", [id]);
  if (!result.changes) throw new HttpError(404, 'Licencia no encontrada', 'license_not_found');
  return res.json({ success: true, id, status: 'revoked' });
}

async function deleteLicense(req, res) {
  const id = integer(req.params.id, 'id', { min: 1 });
  const result = await db.run('DELETE FROM licenses WHERE id = $1', [id]);
  if (!result.changes) throw new HttpError(404, 'Licencia no encontrada', 'license_not_found');
  return res.json({ success: true, id, deleted: true });
}

module.exports = { generateLicense, generateTestLicense, validateLicense, listLicenses, stats, revoke, deleteLicense, deviceStatus, licenseView, addMonths };
