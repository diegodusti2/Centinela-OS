const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { HttpError } = require('../utils/http');
const { text, coordinate, object } = require('../utils/validation');
const { getDeviceOrThrow } = require('./device-controller');
const config = require('../config/env');

const UPLOAD_DIR = path.join(config.projectRoot, 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function uploadPhoto(req, res) {
  const deviceId = req.params.id;
  getDeviceOrThrow(deviceId);

  const imageBase64 = text(req.body.imageBase64 || req.body.imageData || '', 'imageBase64', { max: 5_000_000 });
  if (!imageBase64) throw new HttpError(400, 'imageBase64 requerido', 'validation_error');

  const clean = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(clean, 'base64');
  if (buffer.length > 3_000_000) throw new HttpError(400, 'Imagen demasiado grande', 'validation_error');

  const name = `${deviceId.slice(0, 12)}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}.jpg`;
  const filePath = path.join(UPLOAD_DIR, name);
  fs.writeFileSync(filePath, buffer);

  const latitude = coordinate(req.body.latitude, 'latitude', -90, 90);
  const longitude = coordinate(req.body.longitude, 'longitude', -180, 180);
  const metadata = object(req.body.metadata || {}, 'metadata');

  const imageUrl = `/uploads/${name}`;
  const result = db.prepare(`INSERT INTO events (device_id, event_type, type, metadata_json, description, latitude, longitude, image_url)
    VALUES (?, 'INTRUDER', 'INTRUDER', ?, ?, ?, ?, ?)`).run(
    deviceId, JSON.stringify(metadata), 'Foto capturada por intruso', latitude, longitude, imageUrl);

  return res.status(201).json({
    success: true,
    eventId: Number(result.lastInsertRowid),
    eventType: 'INTRUDER',
    imageUrl,
  });
}

function listPhotos(req, res) {
  const deviceId = req.params.id;
  getDeviceOrThrow(deviceId);
  const rows = db.prepare("SELECT id, image_url, latitude, longitude, timestamp FROM events WHERE device_id = ? AND event_type = 'INTRUDER' AND image_url IS NOT NULL ORDER BY timestamp DESC LIMIT 30").all(deviceId);
  return res.json(rows);
}

module.exports = { uploadPhoto, listPhotos };
