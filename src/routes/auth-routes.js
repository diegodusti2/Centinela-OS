const express = require('express');
const controller = require('../controllers/auth-controller');
const { authenticateUser } = require('../middleware/auth');
const rateLimit = require('../middleware/rate-limit');
const { asyncHandler } = require('../utils/http');

const router = express.Router();
const loginLimiter = rateLimit({ windowMs: 60_000, max: 10, message: 'Demasiados intentos de inicio de sesion' });
const registrationLimiter = rateLimit({ windowMs: 60_000, max: 5, message: 'Demasiadas solicitudes de registro' });

router.post('/register', registrationLimiter, asyncHandler(controller.registerRequest));
router.post('/login', loginLimiter, asyncHandler(controller.login));
router.get('/profile', authenticateUser, asyncHandler(controller.profile));
router.put('/profile', authenticateUser, asyncHandler(controller.updateProfile));
router.post('/logout', authenticateUser, asyncHandler(controller.logout));

module.exports = router;
