const crypto = require('crypto');

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 32 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyPassword(password, encoded) {
  if (!encoded) return false;
  if (encoded.startsWith('scrypt$')) {
    const [, n, r, p, saltHex, hashHex] = encoded.split('$');
    const derived = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), hashHex.length / 2, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 32 * 1024 * 1024,
    });
    return safeEqual(derived.toString('hex'), hashHex);
  }

  // One-time compatibility path for hashes written by the old prototype.
  const legacy = crypto.createHash('sha256').update(password).digest('hex');
  return /^[a-f0-9]{64}$/i.test(encoded) && safeEqual(legacy, encoded.toLowerCase());
}

function needsRehash(encoded) {
  return !encoded || !encoded.startsWith(`scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$`);
}

function randomPassword() {
  return crypto.randomBytes(18).toString('base64url');
}

module.exports = { hashPassword, verifyPassword, needsRehash, randomPassword };
