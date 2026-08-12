const db = require('../db');
const config = require('../config/env');
const { HttpError } = require('../utils/http');
const { verifyPassword, needsRehash, hashPassword } = require('../utils/password');
const { verifyUserToken, hashDeviceToken } = require('../utils/token');

function bearerToken(req) {
  const header = req.get('authorization') || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

function userByToken(token) {
  const payload = verifyUserToken(token);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(payload.sub));
  if (!user) throw new HttpError(401, 'Sesion no valida', 'invalid_session');
  if (needsRehash(user.password_hash)) {
    // Legacy hashes are upgraded after the token has been verified elsewhere.
    // This branch only runs for old records and does not expose the password.
  }
  return user;
}

function authenticateUser(req, res, next) {
  try {
    const token = bearerToken(req);
    if (token) {
      req.user = userByToken(token);
      req.authType = 'user';
      return next();
    }

    if (config.allowLegacyBasic && (req.get('authorization') || '').startsWith('Basic ')) {
      const raw = Buffer.from(req.get('authorization').slice(6), 'base64').toString('utf8');
      const separator = raw.indexOf(':');
      const username = separator >= 0 ? raw.slice(0, separator) : '';
      const password = separator >= 0 ? raw.slice(separator + 1) : '';
      const user = db.prepare('SELECT * FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)').get(username, username);
      if (user && verifyPassword(password, user.password_hash)) {
        if (needsRehash(user.password_hash)) db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?').run(hashPassword(password), user.id);
        req.user = user;
        req.authType = 'user';
        return next();
      }
    }
    return res.status(401).json({ error: 'Autenticacion requerida', code: 'unauthorized' });
  } catch (error) {
    return res.status(401).json({ error: 'Sesion no valida o expirada', code: 'invalid_session' });
  }
}

function authenticateDeviceOrUser(req, res, next) {
  const token = bearerToken(req);
  if (token) {
    try {
      req.user = userByToken(token);
      req.authType = 'user';
      return next();
    } catch (_) {
      // Token JWT inválido o expirado: no devolver 401 aún,
      // permitir que intente con X-Device-Token
    }
  }

  const deviceToken = (req.get('x-device-token') || '').trim() ||
    ((req.get('authorization') || '').startsWith('Device ') ? req.get('authorization').slice(7).trim() : '');
  if (!deviceToken) return res.status(401).json({ error: 'Autenticacion de usuario o dispositivo requerida', code: 'unauthorized' });
  const device = db.prepare('SELECT * FROM devices WHERE device_token_hash = ?').get(hashDeviceToken(deviceToken));
  if (!device) return res.status(401).json({ error: 'Token de dispositivo no valido', code: 'invalid_device_token' });
  req.device = device;
  req.authType = 'device';
  return next();
}

function authenticateDevice(req, res, next) {
  try {
    const deviceToken = (req.get('x-device-token') || '').trim() ||
      ((req.get('authorization') || '').startsWith('Device ') ? req.get('authorization').slice(7).trim() : '');
    if (!deviceToken) return res.status(401).json({ error: 'Token de dispositivo requerido', code: 'unauthorized' });
    const device = db.prepare('SELECT * FROM devices WHERE device_token_hash = ?').get(hashDeviceToken(deviceToken));
    if (!device) return res.status(401).json({ error: 'Token de dispositivo no valido', code: 'invalid_device_token' });
    req.device = device;
    req.authType = 'device';
    return next();
  } catch (e) {
    return res.status(500).json({ error: 'Error de autenticacion', code: 'server_error' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Solo administrador', code: 'forbidden' });
  }
  return next();
}

function userOwnsDevice(user, deviceId) {
  if (user.role === 'admin' || user.role === 'superadmin') return true;
  return Boolean(db.prepare('SELECT 1 FROM device_owners WHERE device_id = ? AND user_id = ?').get(deviceId, user.id));
}

function requireDeviceAccess(req, res, next) {
  const deviceId = req.params.id || req.params.deviceId || req.body.deviceId;
  if (!deviceId) return res.status(400).json({ error: 'deviceId requerido', code: 'validation_error' });
  if (req.authType === 'device') {
    if (req.device.id !== deviceId) return res.status(403).json({ error: 'Dispositivo no autorizado', code: 'forbidden' });
    return next();
  }
  if (req.user && userOwnsDevice(req.user, deviceId)) return next();
  return res.status(403).json({ error: 'No tienes acceso a este dispositivo', code: 'forbidden' });
}

module.exports = { authenticateUser, authenticateDeviceOrUser, authenticateDevice, requireAdmin, requireDeviceAccess, userOwnsDevice };
