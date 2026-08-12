const crypto = require('crypto');

function compactDate(date) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
}

function generate(deviceId, expiryDate) {
  const date = compactDate(expiryDate);
  const devicePart = crypto.createHash('sha256').update(String(deviceId)).digest('hex').slice(0, 8).toUpperCase();
  const nonce = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `CENT-${date}-${devicePart}-${nonce}`;
}

function generateTest(hours = 3) {
  const expiry = new Date(Date.now() + hours * 60 * 60 * 1000);
  const nonce = crypto.randomBytes(10).toString('hex').toUpperCase();
  return { code: `CENT-TEST-${nonce}`, expiry };
}

function isCodeFormat(code) {
  return /^CENT-(?:\d{8}-[0-9A-F]{8}-[0-9A-F]{8}|TEST-[0-9A-F]{20})$/i.test(String(code || '').trim());
}

module.exports = { generate, generateTest, isCodeFormat };
