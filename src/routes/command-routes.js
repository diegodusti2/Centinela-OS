const express = require('express');
const controller = require('../controllers/command-controller');
const { authenticateUser, authenticateDevice, authenticateDeviceOrUser, blockStoreSensitive } = require('../middleware/auth');
const { asyncHandler } = require('../utils/http');

const router = express.Router();

router.post('/', authenticateUser, blockStoreSensitive, asyncHandler(controller.createCommand));
router.get('/:deviceId', authenticateDeviceOrUser, asyncHandler(controller.listCommands));
router.put('/:deviceId/:id', authenticateDevice, asyncHandler(controller.completeCommand));

module.exports = router;
