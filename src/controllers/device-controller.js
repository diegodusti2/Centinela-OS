const db = require('../db');
const { HttpError } = require('../utils/http');
const { text, integer, coordinates, coordinate, limit, object } = require('../utils/validation');
const { generateDeviceToken, hashDeviceToken } = require('../utils/token');
const { userOwnsDevice } = require('../middleware/auth');

function bool(value) {
  return value === true || value === 1 || value === '1';
}

function deviceView(device) {
  const lastSeen = device.last_seen || null;
  const isOnline = bool(device.online) && lastSeen
    ? Date.now() - Date.parse(lastSeen) < 5 * 60 * 1000
    : bool(device.online);
  return {
    id: device.id,
    deviceId: device.id,
    deviceUid: device.device_uid || device.id,
    deviceName: device.name || device.id,
    name: device.name || device.id,
    model: device.model || '',
    androidVersion: device.android_version || '',
    ipAddress: device.ip_address || '',
    status: isOnline ? 'online' : (device.status || 'offline'),
    batteryLevel: device.battery_level ?? device.battery ?? null,
    battery: device.battery_level ?? device.battery ?? null,
    lastSeen,
    isOnline,
    online: isOnline,
    lastLatitude: device.last_lat ?? null,
    lastLongitude: device.last_lng ?? null,
    shieldArmed: bool(device.shield_armed),
    registeredAt: device.registered_at || null,
    deviceInfo: safeParseJson(device.device_info_json),
  };
}

function safeParseJson(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch (_) { return null; }
}

function getDevices(req, res) {
  const rows = req.user.role === 'admin' || req.user.role === 'superadmin'
    ? db.prepare('SELECT * FROM devices ORDER BY COALESCE(last_seen, registered_at) DESC').all()
    : db.prepare(`SELECT DISTINCT d.* FROM devices d INNER JOIN device_owners o ON o.device_id = d.id WHERE o.user_id = ? ORDER BY COALESCE(d.last_seen, d.registered_at) DESC`).all(req.user.id);
  return res.json(rows.map(deviceView));
}

function registerDevice(req, res) {
  const deviceId = text(req.body.deviceId || req.body.deviceUid, 'deviceId', { max: 160 });
  // Identificadores de dispositivo: solo caracteres seguros (hex/base64url
  // o guiones) para evitar IDs con comillas que rompan atributos HTML.
  if (!/^[A-Za-z0-9._-]{8,160}$/.test(deviceId)) {
    throw new HttpError(400, 'deviceId contiene caracteres no permitidos', 'validation_error');
  }
  const name = text(req.body.deviceName || req.body.name, 'deviceName', { required: false, max: 120 }) || 'Centinela OS';
  const model = text(req.body.model, 'model', { required: false, max: 120 });
  const androidVersion = text(req.body.androidVersion, 'androidVersion', { required: false, max: 40 });
  const submittedIp = text(req.body.ipAddress, 'ipAddress', { required: false, max: 64 });
  const ipAddress = submittedIp || String(req.ip || '').replace(/^::ffff:/, '').slice(0, 64);
  const batteryValue = req.body.batteryLevel;
  const battery = batteryValue === undefined || batteryValue === null || batteryValue === ''
    ? null
    : integer(batteryValue, 'batteryLevel', { min: 0, max: 100 });
  const deviceInfoJson = text(req.body.deviceInfoJson, 'deviceInfoJson', { required: false, max: 4000 });
  const existing = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
  if (existing && req.user.role !== 'admin' && req.user.role !== 'superadmin' && !userOwnsDevice(req.user, deviceId)) {
    throw new HttpError(403, 'El dispositivo ya pertenece a otra cuenta', 'device_owned');
  }

  const deviceToken = generateDeviceToken();
  const tokenHash = hashDeviceToken(deviceToken);
  const transaction = db.transaction(() => {
    if (existing) {
      db.prepare(`UPDATE devices SET device_uid = ?, name = ?, model = ?, android_version = ?, ip_address = ?,
        battery_level = COALESCE(?, battery_level), battery = COALESCE(?, battery),
        user_id = COALESCE(user_id, ?), device_token_hash = ?, status = 'online', online = 1,
        device_info_json = CASE WHEN ? != '' THEN ? ELSE device_info_json END,
        last_seen = datetime('now') WHERE id = ?`).run(deviceId, name, model, androidVersion, ipAddress, battery, battery, req.user.id, tokenHash, deviceInfoJson, deviceInfoJson, deviceId);
    } else {
      db.prepare(`INSERT INTO devices (id, device_uid, user_id, name, model, android_version, ip_address, status,
        battery_level, battery, last_seen, online, device_token_hash, device_info_json) VALUES (?, ?, ?, ?, ?, ?, ?, 'online', ?, ?, datetime('now'), 1, ?, ?)`).run(
        deviceId, deviceId, req.user.id, name, model, androidVersion, ipAddress, battery, battery, tokenHash, deviceInfoJson);
    }
    db.prepare('INSERT OR IGNORE INTO device_owners (device_id, user_id) VALUES (?, ?)').run(deviceId, req.user.id);
  });
  transaction();

  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
  return res.status(existing ? 200 : 201).json({ success: true, device: deviceView(device), deviceId, deviceToken });
}

function getDeviceOrThrow(deviceId) {
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
  if (!device) throw new HttpError(404, 'Dispositivo no encontrado', 'device_not_found');
  return device;
}

function reportLocation(req, res) {
  const deviceId = req.params.id;
  const device = getDeviceOrThrow(deviceId);
  const { latitude, longitude } = coordinates(req.body.latitude, req.body.longitude);
  const altitude = coordinate(req.body.altitude, 'altitude', -1000, 100000);
  const accuracy = coordinate(req.body.accuracy, 'accuracy', 0, 100000);
  const speed = coordinate(req.body.speed, 'speed', 0, 10000);
  const bearing = coordinate(req.body.bearing, 'bearing', 0, 360);
  const batteryLevel = req.body.batteryLevel ?? req.body.battery;
  const battery = batteryLevel === undefined || batteryLevel === null ? null : integer(batteryLevel, 'battery', { min: 0, max: 100 });
  const event = text(req.body.event, 'event', { required: false, max: 40 }) || 'tracking';
  if (!/^[a-zA-Z0-9_ .:()-]+$/.test(event)) {
    throw new HttpError(400, 'event contiene caracteres no permitidos', 'validation_error');
  }

  const transaction = db.transaction(() => {
    db.prepare(`INSERT INTO locations (device_id, latitude, longitude, altitude, accuracy, speed, bearing, battery_level, battery, event)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(deviceId, latitude, longitude, altitude, accuracy, speed, bearing, battery, battery, event);
    db.prepare(`UPDATE devices SET last_seen = datetime('now'), last_lat = ?, last_lng = ?, battery_level = COALESCE(?, battery_level),
      battery = COALESCE(?, battery), online = 1, status = 'online' WHERE id = ?`).run(latitude, longitude, battery, battery, deviceId);
  });
  transaction();
  return res.status(201).json({ success: true, deviceId, receivedAt: new Date().toISOString() });
}

function getLocations(req, res) {
  getDeviceOrThrow(req.params.id);
  const rows = db.prepare('SELECT * FROM locations WHERE device_id = ? ORDER BY timestamp DESC LIMIT ?').all(req.params.id, limit(req.query.limit, 200)).reverse();
  return res.json(rows.map((row) => ({
    ...row,
    batteryLevel: row.battery_level ?? row.battery ?? null,
    timestamp: row.timestamp,
  })));
}

const EVENT_ALIASES = Object.freeze({
  sim_extraction: 'ANTI_SIM',
  snatch: 'MOTION',
  intruder: 'INTRUDER',
  last_gasp: 'BATTERY_LOW',
  status_report: 'STATUS',
  test: 'TEST',
});

function reportEvent(req, res) {
  const deviceId = req.params.id;
  getDeviceOrThrow(deviceId);
  const imageUrl = text(req.body.imageUrl || req.body.image_url, 'imageUrl', { required: false, max: 500 });
  const rawType = text(req.body.eventType || req.body.type, 'eventType', { max: 40 }).toUpperCase();
  const eventType = EVENT_ALIASES[rawType.toLowerCase()] || rawType;
  const allowed = ['ANTI_SIM', 'INTRUDER', 'MOTION', 'BATTERY_LOW', 'STATUS', 'TEST'];
  if (!allowed.includes(eventType)) throw new HttpError(400, 'Tipo de evento no permitido', 'validation_error');
  const description = text(req.body.description, 'description', { required: false, max: 500 });
  const latitude = coordinate(req.body.latitude, 'latitude', -90, 90);
  const longitude = coordinate(req.body.longitude, 'longitude', -180, 180);
  const metadata = object(req.body.metadata || req.body.metadataJson, 'metadata');
  const result = db.prepare(`INSERT INTO events (device_id, event_type, type, metadata_json, description, latitude, longitude, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(deviceId, eventType, eventType, JSON.stringify(metadata), description, latitude, longitude, imageUrl || null);
  return res.status(201).json({ success: true, eventId: Number(result.lastInsertRowid), eventType });
}

function getEvents(req, res) {
  getDeviceOrThrow(req.params.id);
  const rows = db.prepare('SELECT * FROM events WHERE device_id = ? ORDER BY timestamp DESC LIMIT ?').all(req.params.id, limit(req.query.limit, 50));
  return res.json(rows.map((row) => ({
    ...row,
    eventType: row.event_type || row.type,
    type: row.event_type || row.type,
    metadata: JSON.parse(row.metadata_json || '{}'),
    timestamp: row.timestamp || row.created_at,
  })));
}

module.exports = { getDevices, registerDevice, reportLocation, getLocations, reportEvent, getEvents, deviceView, getDeviceOrThrow };
