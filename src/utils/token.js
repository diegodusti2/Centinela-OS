const crypto = require('crypto');
const config = require('../config/env');

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decode(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
}

function sign(input) {
  return crypto.createHmac('sha256', config.jwtSecret).update(input).digest('base64url');
}

function issueUserToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    sub: String(user.id),
    username: user.username,
    role: user.role === 'user' ? 'client' : user.role,
    iat: now,
    exp: now + config.jwtTtlSeconds,
  });
  return `${header}.${payload}.${sign(`${header}.${payload}`)}`;
}

function verifyUserToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Token invalido');
  const expected = sign(`${parts[0]}.${parts[1]}`);
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) throw new Error('Firma invalida');
  const payload = decode(parts[1]);
  if (!payload.sub || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) throw new Error('Token expirado');
  return payload;
}

function generateDeviceToken() {
  return `cen_dev_${crypto.randomBytes(32).toString('base64url')}`;
}

function hashDeviceToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = { issueUserToken, verifyUserToken, generateDeviceToken, hashDeviceToken };
