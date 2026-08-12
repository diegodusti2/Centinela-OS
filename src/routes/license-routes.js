const express = require('express');
const controller = require('../controllers/license-controller');
const { authenticateUser, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../utils/http');

const router = express.Router();

router.post('/generate', authenticateUser, requireAdmin, asyncHandler(controller.generateLicense));
router.post('/generate-test', authenticateUser, requireAdmin, asyncHandler(controller.generateTestLicense));
router.post('/validate', asyncHandler(controller.validateLicense));
router.get('/', authenticateUser, asyncHandler(controller.listLicenses));
router.get('/stats', authenticateUser, requireAdmin, asyncHandler(controller.stats));
router.put('/:id/revoke', authenticateUser, requireAdmin, asyncHandler(controller.revoke));
router.delete('/:id', authenticateUser, requireAdmin, asyncHandler(controller.deleteLicense));

module.exports = router;
