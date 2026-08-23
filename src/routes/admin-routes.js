const express = require('express');
const admin = require('../controllers/admin-controller');
const registration = require('../controllers/registration-controller');
const { authenticateUser, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../utils/http');

const router = express.Router();
router.use(authenticateUser, requireAdmin);
router.get('/stats', asyncHandler(admin.stats));
router.get('/users', asyncHandler(admin.users));
router.get('/registrations', asyncHandler(registration.listRegistrations));
router.post('/registrations/:id/approve', asyncHandler(registration.approve));
router.post('/registrations/:id/reject', asyncHandler(registration.reject));
router.delete('/users/:id', asyncHandler(admin.deleteUser));
router.post('/reset-password/:id', asyncHandler(admin.resetPassword));

module.exports = router;
