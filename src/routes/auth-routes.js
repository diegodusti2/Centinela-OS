const express = require('express');
const controller = require('../controllers/auth-controller');
const { authenticateUser } = require('../middleware/auth');
const rateLimit = require('../middleware/rate-limit');
const { asyncHandler } = require('../utils/http');

const router = express.Router();
const loginLimiter = rateLimit({ windowMs: 60_000, max: 10, message: 'Demasiados intentos de inicio de sesion' });
const registrationLimiter = rateLimit({ windowMs: 60_000, max: 5, message: 'Demasiadas solicitudes de registro' });
const setupLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10, message: 'Demasiados intentos de configuracion' });
const resetLimiter = rateLimit({ windowMs: 15 * 60_000, max: 5, message: 'Demasiados intentos de restablecimiento' });

router.post('/register', registrationLimiter, asyncHandler(controller.registerRequest));
router.post('/login', loginLimiter, asyncHandler(controller.login));
router.post('/setup', setupLimiter, asyncHandler(controller.setupAccount));
router.post('/reset-request', resetLimiter, asyncHandler(controller.resetRequest));
router.post('/reset-password', resetLimiter, asyncHandler(controller.resetPassword));
router.get('/profile', authenticateUser, asyncHandler(controller.profile));
router.put('/profile', authenticateUser, asyncHandler(controller.updateProfile));
router.post('/logout', authenticateUser, asyncHandler(controller.logout));

module.exports = router;
