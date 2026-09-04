const express = require('express');
const admin = require('../controllers/admin-controller');
const registration = require('../controllers/registration-controller');
const license = require('../controllers/license-controller');
const { authenticateUser, requireAdminOrStore } = require('../middleware/auth');
const { asyncHandler } = require('../utils/http');

const router = express.Router();
router.use(authenticateUser, requireAdminOrStore);

// Stats limitados para tienda
router.get('/stats', asyncHandler(admin.storeStats));

// Cuentas de clientes (solo lectura/creación via registro)
router.get('/users', asyncHandler(admin.users));
router.get('/registrations', asyncHandler(registration.listRegistrations));
router.post('/registrations/:id/approve', asyncHandler(registration.approve));
router.post('/registrations/:id/reject', asyncHandler(registration.reject));

// Licencias: generar, listar, revocar (pero no borrar si es store? permitimos)
router.post('/licenses/generate', asyncHandler(license.generateLicense));
router.get('/licenses', asyncHandler(license.listLicenses));
router.post('/licenses/:id/revoke', asyncHandler(license.revoke));

module.exports = router;
