const express = require('express');
const authRoutes = require('./auth-routes');
const deviceRoutes = require('./device-routes');
const commandRoutes = require('./command-routes');
const licenseRoutes = require('./license-routes');
const adminRoutes = require('./admin-routes');
const auth = require('../controllers/auth-controller');
const registration = require('../controllers/registration-controller');
const receipt = require('../controllers/receipt-controller');
const report = require('../controllers/report-controller');
const storeRoutes = require('./store-routes');
const rateLimit = require('../middleware/rate-limit');
const { authenticateDeviceOrUser } = require('../middleware/auth');
const { asyncHandler } = require('../utils/http');

const router = express.Router();
router.use('/auth', authRoutes);
router.post('/register', rateLimit({ windowMs: 60_000, max: 5, message: 'Demasiadas solicitudes de registro' }), asyncHandler(auth.registerRequest));
router.post('/register/upload-receipt/:id', rateLimit({ windowMs: 60_000, max: 10, message: 'Demasiados intentos de subida' }), receipt.upload.single('receipt_image'), (req, res) => receipt.uploadReceipt(req, res));
router.get('/register/:id/status', asyncHandler(registration.checkStatus));
router.post('/pay/confirm', asyncHandler(registration.confirmDemoPayment));
router.get('/report/:deviceId', (req, res, next) => {
  // Permite abrir el informe desde el navegador del dispositivo (la app
  // firma la URL con su token de sesion: ?token=<jwt>).
  if (!req.get('authorization') && req.query.token) {
    req.headers.authorization = `Bearer ${String(req.query.token)}`;
  }
  authenticateDeviceOrUser(req, res, next);
}, (req, res, next) => {
  if (req.user && req.user.role === 'store') return res.status(403).json({ error: 'Tiendas sin acceso a informes sensibles', code: 'forbidden_store' });
  next();
}, asyncHandler(report.generateReport));
router.use('/devices', deviceRoutes);
router.use('/commands', commandRoutes);
router.use('/licenses', licenseRoutes);
router.use('/admin', adminRoutes);
router.use('/store', storeRoutes);

module.exports = router;
