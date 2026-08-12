const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const databasePath = path.join(os.tmpdir(), `centinela-api-${process.pid}.db`);
process.env.NODE_ENV = 'development';
process.env.DB_PATH = databasePath;
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASSWORD = 'test-password-123';
process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters';
process.env.CORS_ORIGINS = 'http://localhost:8080';

const app = require('../src/index');
const db = require('../src/db');

let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${databasePath}${suffix}`); } catch (_) { /* already removed */ }
  }
});

async function request(route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const body = await response.json();
  return { response, body };
}

test('health and login issue a signed token without exposing password hash', async () => {
  const health = await request('/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.body.status, 'ok');

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'test-password-123' }),
  });
  assert.equal(login.response.status, 200);
  assert.match(login.body.token, /^ey/);
  assert.equal(login.body.user.role, 'admin');
  assert.equal(login.body.user.password_hash, undefined);
});

test('registration stays pending and cannot create a public account', async () => {
  const registration = await request('/api/register', {
    method: 'POST',
    body: JSON.stringify({ name: 'Test Client', email: 'test@example.com', deviceId: 'TEST-DEVICE', plan: 1 }),
  });
  assert.equal(registration.response.status, 202);
  assert.equal(registration.body.status, 'pending');
  assert.equal(registration.body.account, undefined);
});

test('device token protects telemetry and allows authorized screen capture commands', async () => {
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'test-password-123' }),
  });
  const userHeaders = { authorization: `Bearer ${login.body.token}` };
  const device = await request('/api/devices', {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify({ deviceId: 'TEST-DEVICE', deviceName: 'Test phone', model: 'Test Android', androidVersion: '14', batteryLevel: 77 }),
  });
  assert.equal(device.response.status, 201);
  assert.ok(device.body.deviceToken);
  assert.equal(device.body.device.model, 'Test Android');
  assert.equal(device.body.device.androidVersion, '14');
  assert.equal(device.body.device.batteryLevel, 77);

  const location = await request('/api/devices/TEST-DEVICE/locations', {
    method: 'POST',
    headers: { 'x-device-token': device.body.deviceToken },
    body: JSON.stringify({ latitude: 1, longitude: 2, battery: 90 }),
  });
  assert.equal(location.response.status, 201);

  const command = await request('/api/commands', {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify({ deviceId: 'TEST-DEVICE', command: 'loc' }),
  });
  assert.equal(command.response.status, 201);

  const capture = await request('/api/commands', {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify({ deviceId: 'TEST-DEVICE', command: 'foto' }),
  });
  assert.equal(capture.response.status, 201);

  const pending = await request('/api/commands/TEST-DEVICE', {
    headers: { 'x-device-token': device.body.deviceToken },
  });
  assert.equal(pending.response.status, 200);
  assert.equal(pending.body.length, 2);
});

test('profile changes update the server account and issue a new token', async () => {
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'test-password-123' }),
  });
  const update = await request('/api/auth/profile', {
    method: 'PUT',
    headers: { authorization: `Bearer ${login.body.token}` },
    body: JSON.stringify({
      username: 'admin-renamed',
      currentPassword: 'test-password-123',
      newPassword: 'test-password-456',
    }),
  });
  assert.equal(update.response.status, 200);
  assert.equal(update.body.user.username, 'admin-renamed');
  assert.ok(update.body.token);

  const relogin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin-renamed', password: 'test-password-456' }),
  });
  assert.equal(relogin.response.status, 200);
});
