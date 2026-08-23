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

async function uploadPhoto(req, res) {
  const deviceId = req.params.id;
  await getDeviceOrThrow(deviceId);

  const imageBase64 = text(req.body.imageBase64 || req.body.imageData || '', 'imageBase64', { max: 5_000_000 });
  if (!imageBase64) throw new HttpError(400, 'imageBase64 requerido', 'validation_error');

  const clean = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(clean, 'base64');
  if (buffer.length > 3_000_000) throw new HttpError(400, 'Imagen demasiado grande', 'validation_error');
  const isJpeg = buffer.length > 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  const isPng = buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
  if (!isJpeg && !isPng) throw new HttpError(400, 'Formato de imagen no permitido', 'validation_error');

  const name = `${deviceId.slice(0, 12)}_${Date.now()}_${crypto.randomBytes(16).toString('hex')}.jpg`;
  const filePath = path.join(UPLOAD_DIR, name);
  fs.writeFileSync(filePath, buffer);

  const latitude = coordinate(req.body.latitude, 'latitude', -90, 90);
  const longitude = coordinate(req.body.longitude, 'longitude', -180, 180);
  const metadata = object(req.body.metadata || {}, 'metadata');

  const imageUrl = `/uploads/${name}`;
  const result = await db.run(`INSERT INTO events (device_id, event_type, type, metadata_json, description, latitude, longitude, image_url)
    VALUES ($1, 'INTRUDER', 'INTRUDER', $2, $3, $4, $5, $6) RETURNING id`,
    [deviceId, JSON.stringify(metadata), 'Foto capturada por intruso', latitude, longitude, imageUrl]);

  return res.status(201).json({
    success: true,
    eventId: Number(result.lastInsertRowid),
    eventType: 'INTRUDER',
    imageUrl,
  });
}

async function listPhotos(req, res) {
  const deviceId = req.params.id;
  await getDeviceOrThrow(deviceId);
  const rows = await db.all("SELECT id, image_url, latitude, longitude, timestamp FROM events WHERE device_id = $1 AND event_type = 'INTRUDER' AND image_url IS NOT NULL ORDER BY timestamp DESC LIMIT 30", [deviceId]);
  return res.json(rows);
}

module.exports = { uploadPhoto, listPhotos };
