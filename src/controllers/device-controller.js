const db = require('../db');
const { HttpError } = require('../utils/http');
const { text, integer, coordinates, coordinate, limit, object } = require('../utils/validation');
const { generateDeviceToken, hashDeviceToken } = require('../utils/token');
const { userOwnsDevice } = require('../middleware/auth');

function bool(value) {
  return value === true || value === 1 || value === '1';
}

function safeParseJson(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch (_) { return null; }
}

function deviceView(device) {
  const lastSeen = device.last_seen || null;
  const isOnline = bool(device.online) && lastSeen
    ? Date.now() - db.toMs(lastSeen) < 5 * 60 * 1000
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

async function getDevices(req, res) {
  const rows = req.user.role === 'admin' || req.user.role === 'superadmin'
    ? await db.all('SELECT * FROM devices ORDER BY COALESCE(last_seen, registered_at) DESC')
    : await db.all(`SELECT d.* FROM devices d INNER JOIN device_owners o ON o.device_id = d.id WHERE o.user_id = $1 ORDER BY COALESCE(d.last_seen, d.registered_at) DESC`, [req.user.id]);
  return res.json(rows.map(deviceView));
}

async function registerDevice(req, res) {
  const deviceId = text(req.body.deviceId || req.body.deviceUid, 'deviceId', { max: 160 });
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

  const existing = await db.get('SELECT * FROM devices WHERE id = $1', [deviceId]);
  if (existing && req.user.role !== 'admin' && req.user.role !== 'superadmin' && !(await userOwnsDevice(req.user, deviceId))) {
    throw new HttpError(403, 'El dispositivo ya pertenece a otra cuenta', 'device_owned');
  }

  const deviceToken = generateDeviceToken();
  const tokenHash = hashDeviceToken(deviceToken);

  await db.tx(async (q) => {
    if (existing) {
      await q.run(`UPDATE devices SET device_uid = $1, name = $2, model = $3, android_version = $4, ip_address = $5,
        battery_level = COALESCE($6, battery_level), battery = COALESCE($7, battery),
        user_id = COALESCE(user_id, $8), device_token_hash = $9, status = 'online', online = 1,
        device_info_json = CASE WHEN $10 <> '' THEN $10 ELSE device_info_json END,
        last_seen = NOW() WHERE id = $11`,
        [deviceId, name, model, androidVersion, ipAddress, battery, battery, req.user.id, tokenHash, deviceInfoJson, deviceId]);
    } else {
      await q.run(`INSERT INTO devices (id, device_uid, user_id, name, model, android_version, ip_address, status,
        battery_level, battery, last_seen, online, device_token_hash, device_info_json)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'online', $8, $9, NOW(), 1, $10, $11)`,
        [deviceId, deviceId, req.user.id, name, model, androidVersion, ipAddress, battery, battery, tokenHash, deviceInfoJson]);
    }
    await q.run('INSERT INTO device_owners (device_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [deviceId, req.user.id]);
  });

  const device = await db.get('SELECT * FROM devices WHERE id = $1', [deviceId]);
  return res.status(existing ? 200 : 201).json({ success: true, device: deviceView(device), deviceId, deviceToken });
}

async function getDeviceOrThrow(deviceId) {
  const device = await db.get('SELECT * FROM devices WHERE id = $1', [deviceId]);
  if (!device) throw new HttpError(404, 'Dispositivo no encontrado', 'device_not_found');
  return device;
}

async function reportLocation(req, res) {
  const deviceId = req.params.id;
  await getDeviceOrThrow(deviceId);
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

  await db.tx(async (q) => {
    await q.run(`INSERT INTO locations (device_id, latitude, longitude, altitude, accuracy, speed, bearing, battery_level, battery, event)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [deviceId, latitude, longitude, altitude, accuracy, speed, bearing, battery, battery, event]);
    await q.run(`UPDATE devices SET last_seen = NOW(), last_lat = $1, last_lng = $2, battery_level = COALESCE($3, battery_level),
      battery = COALESCE($4, battery), online = 1, status = 'online' WHERE id = $5`,
      [latitude, longitude, battery, battery, deviceId]);
  });
  return res.status(201).json({ success: true, deviceId, receivedAt: new Date().toISOString() });
}

async function getLocations(req, res) {
  await getDeviceOrThrow(req.params.id);
  const rows = await db.all('SELECT * FROM locations WHERE device_id = $1 ORDER BY timestamp DESC LIMIT $2', [req.params.id, limit(req.query.limit, 200)]);
  rows.reverse();
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

async function reportEvent(req, res) {
  const deviceId = req.params.id;
  await getDeviceOrThrow(deviceId);
  const imageUrl = text(req.body.imageUrl || req.body.image_url, 'imageUrl', { required: false, max: 500 });
  const rawType = text(req.body.eventType || req.body.type, 'eventType', { max: 40 }).toUpperCase();
  const eventType = EVENT_ALIASES[rawType.toLowerCase()] || rawType;
  const allowed = ['ANTI_SIM', 'INTRUDER', 'MOTION', 'BATTERY_LOW', 'STATUS', 'TEST'];
  if (!allowed.includes(eventType)) throw new HttpError(400, 'Tipo de evento no permitido', 'validation_error');
  const description = text(req.body.description, 'description', { required: false, max: 500 });
  const latitude = coordinate(req.body.latitude, 'latitude', -90, 90);
  const longitude = coordinate(req.body.longitude, 'longitude', -180, 180);
  const metadata = object(req.body.metadata || req.body.metadataJson, 'metadata');
  const result = await db.run(`INSERT INTO events (device_id, event_type, type, metadata_json, description, latitude, longitude, image_url)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [deviceId, eventType, eventType, JSON.stringify(metadata), description, latitude, longitude, imageUrl || null]);
  return res.status(201).json({ success: true, eventId: Number(result.lastInsertRowid), eventType });
}

async function getEvents(req, res) {
  await getDeviceOrThrow(req.params.id);
  const rows = await db.all('SELECT * FROM events WHERE device_id = $1 ORDER BY timestamp DESC LIMIT $2', [req.params.id, limit(req.query.limit, 50)]);
  return res.json(rows.map((row) => ({
    ...row,
    eventType: row.event_type || row.type,
    type: row.event_type || row.type,
    metadata: safeParseJson(row.metadata_json),
    timestamp: row.timestamp || row.created_at,
  })));
}

module.exports = { getDevices, registerDevice, reportLocation, getLocations, reportEvent, getEvents, deviceView, getDeviceOrThrow };
