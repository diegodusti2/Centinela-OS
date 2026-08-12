const express = require('express');
const controller = require('../controllers/device-controller');
const photoController = require('../controllers/photo-controller');
const { authenticateUser, authenticateDeviceOrUser, requireDeviceAccess } = require('../middleware/auth');
const { asyncHandler } = require('../utils/http');

const router = express.Router();

router.get('/', authenticateUser, asyncHandler(controller.getDevices));
router.post('/', authenticateUser, asyncHandler(controller.registerDevice));
router.get('/:id/locations', authenticateUser, requireDeviceAccess, asyncHandler(controller.getLocations));
router.post('/:id/locations', authenticateDeviceOrUser, requireDeviceAccess, asyncHandler(controller.reportLocation));
router.get('/:id/events', authenticateUser, requireDeviceAccess, asyncHandler(controller.getEvents));
router.post('/:id/events', authenticateDeviceOrUser, requireDeviceAccess, asyncHandler(controller.reportEvent));
router.post('/:id/photos', authenticateDeviceOrUser, requireDeviceAccess, asyncHandler(photoController.uploadPhoto));
router.get('/:id/photos', authenticateUser, requireDeviceAccess, asyncHandler(photoController.listPhotos));

module.exports = router;
