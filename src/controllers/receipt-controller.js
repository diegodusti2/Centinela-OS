const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config/env');

const RECEIPTS_DIR = path.join(config.projectRoot, 'public', 'receipts');
fs.mkdirSync(RECEIPTS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: RECEIPTS_DIR,
  filename(req, file, cb) {
    const id = req.params.id || 'unknown';
    const ext = path.extname(file.originalname) || '.jpg';
    const name = `receipt_${id}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const allowed = /jpe?g|png|gif|webp/i;
    cb(null, allowed.test(path.extname(file.originalname)));
  },
});

function uploadReceipt(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!id || id < 1) return res.status(400).json({ error: 'ID invalido' });

  const registration = db.prepare('SELECT * FROM registrations WHERE id = ?').get(id);
  if (!registration) return res.status(404).json({ error: 'Solicitud no encontrada' });

  if (!req.file) return res.status(400).json({ error: 'No se recibio ninguna imagen' });

  const imageUrl = `/receipts/${req.file.filename}`;
  db.prepare('UPDATE registrations SET receipt_image = ? WHERE id = ?').run(imageUrl, id);

  return res.status(201).json({ success: true, imageUrl });
}

module.exports = { uploadReceipt, upload };
