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

function generateLicense(req, res) {
  const deviceId = text(req.body.deviceId, 'deviceId', { max: 160 });
  const months = plan(req.body.durationMonths || req.body.plan);
  if (!PLANS[months]) throw new HttpError(400, 'Plan no disponible', 'validation_error');
  const customerName = text(req.body.customerName || req.body.name, 'customerName', { required: false, max: 120 });
  const customerEmail = req.body.customerEmail || req.body.email ? email(req.body.customerEmail || req.body.email) : '';
  const clientId = req.body.clientId === undefined ? null : integer(req.body.clientId, 'clientId', { min: 1 });
  if (clientId !== null && !db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('client', 'user')").get(clientId)) {
    throw new HttpError(400, 'clientId no corresponde a un cliente', 'validation_error');
  }
  const expiresAt = addMonths(new Date(), months);
  const code = license.generate(deviceId, expiresAt);
  const result = db.prepare(`INSERT INTO licenses (code, device_id, client_id, customer_name, customer_email,
    duration_months, price, status, type, expires_at, issued_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'standard', ?, ?)`).run(
    code, deviceId, clientId, customerName, customerEmail, months, PLANS[months].price, expiresAt.toISOString(), req.user.username);
  const row = db.prepare('SELECT * FROM licenses WHERE id = ?').get(result.lastInsertRowid);
  return res.status(201).json({ ...licenseView(row), success: true });
}

function generateTestLicense(req, res) {
  if (config.isProduction) throw new HttpError(404, 'Ruta no disponible', 'not_found');
  const hours = integer(req.body.durationHours, 'durationHours', { min: 1, max: 72, defaultValue: 3 });
  const generated = license.generateTest(hours);
  return res.status(201).json({ code: generated.code, expiresAt: generated.expiry.toISOString(), type: 'test' });
}

function validateLicense(req, res) {
  const code = text(req.body.code, 'code', { max: 80 }).toUpperCase();
  const deviceId = text(req.body.deviceId, 'deviceId', { max: 160 });
  const row = db.prepare('SELECT * FROM licenses WHERE code = ?').get(code);
  if (!row) return res.json({ valid: false, error: 'Codigo no reconocido' });
  const expiry = Date.parse(row.expires_at);
  if (row.status === 'revoked' || row.status === 'expired' || !Number.isFinite(expiry) || expiry <= Date.now()) {
    if (row.status === 'active') db.prepare("UPDATE licenses SET status = 'expired' WHERE id = ?").run(row.id);
    return res.json({ valid: false, error: 'Codigo vencido o revocado' });
  }
  if (row.device_id && row.device_id !== deviceId) return res.json({ valid: false, error: 'Licencia de otro dispositivo' });
  return res.json({ valid: true, expiry: row.expires_at, license: licenseView(row) });
}

function listLicenses(req, res) {
  const status = req.query.status && req.query.status !== 'all' ? text(req.query.status, 'status', { max: 20 }) : null;
  const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
  let query, params;
  if (isAdmin) {
    query = status ? 'SELECT * FROM licenses WHERE status = ? ORDER BY created_at DESC LIMIT ?' : 'SELECT * FROM licenses ORDER BY created_at DESC LIMIT ?';
    params = status ? [status, limit(req.query.limit, 100)] : [limit(req.query.limit, 100)];
  } else {
    query = status ? 'SELECT * FROM licenses WHERE client_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?' : 'SELECT * FROM licenses WHERE client_id = ? ORDER BY created_at DESC LIMIT ?';
    params = status ? [req.user.id, status, limit(req.query.limit, 100)] : [req.user.id, limit(req.query.limit, 100)];
  }
  const rows = db.prepare(query).all(...params);
  return res.json({ licenses: rows.map(licenseView) });
}

function stats(req, res) {
  const total = db.prepare('SELECT COUNT(*) AS count FROM licenses').get().count;
  const active = db.prepare("SELECT COUNT(*) AS count FROM licenses WHERE status = 'active' AND expires_at > datetime('now')").get().count;
  const revenue = db.prepare("SELECT COALESCE(SUM(price), 0) AS value FROM licenses WHERE status <> 'revoked'").get().value;
  return res.json({ totalLicenses: total, activeLicenses: active, expiredLicenses: total - active, estimatedRevenue: revenue });
}

function revoke(req, res) {
  const id = integer(req.params.id, 'id', { min: 1 });
  const result = db.prepare("UPDATE licenses SET status = 'revoked' WHERE id = ? AND status <> 'revoked'").run(id);
  if (!result.changes) throw new HttpError(404, 'Licencia no encontrada', 'license_not_found');
  return res.json({ success: true, id, status: 'revoked' });
}

function deleteLicense(req, res) {
  const id = integer(req.params.id, 'id', { min: 1 });
  const result = db.prepare('DELETE FROM licenses WHERE id = ?').run(id);
  if (!result.changes) throw new HttpError(404, 'Licencia no encontrada', 'license_not_found');
  return res.json({ success: true, id, deleted: true });
}

module.exports = { generateLicense, generateTestLicense, validateLicense, listLicenses, stats, revoke, deleteLicense, licenseView, addMonths };
