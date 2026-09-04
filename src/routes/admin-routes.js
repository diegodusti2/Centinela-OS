const express = require('express');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const config = require('../config/env');
const admin = require('../controllers/admin-controller');
const registration = require('../controllers/registration-controller');
const { authenticateUser, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../utils/http');

const storePhotoStorage = multer.diskStorage({
  destination: path.join(config.projectRoot, 'public', 'uploads'),
  filename(req, file, cb) {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `store_${req.params.id}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}${ext}`);
  }
});
const storePhotoUpload = multer({ storage: storePhotoStorage, limits: { fileSize: 3 * 1024 * 1024 }, fileFilter(req,file,cb){ const ok=/jpe?g|png|webp/i.test(path.extname(file.originalname)); cb(null, ok); } });

const router = express.Router();
router.use(authenticateUser, requireAdmin);
router.get('/stats', asyncHandler(admin.stats));
router.get('/users', asyncHandler(admin.users));
router.get('/registrations', asyncHandler(registration.listRegistrations));
router.post('/registrations/:id/approve', asyncHandler(registration.approve));
router.post('/registrations/:id/reject', asyncHandler(registration.reject));
router.delete('/users/:id', asyncHandler(admin.deleteUser));
router.post('/reset-password/:id', asyncHandler(admin.resetPassword));
router.post('/stores', asyncHandler(admin.createStore));
router.get('/stores', asyncHandler(admin.listStores));
router.delete('/stores/:id', asyncHandler(admin.deleteStore));
router.put('/stores/:id', asyncHandler(admin.updateStore));
router.post('/stores/:id/photo', storePhotoUpload.single('photo'), asyncHandler(admin.uploadStorePhoto));

module.exports = router;
