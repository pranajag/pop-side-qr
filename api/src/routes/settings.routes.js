const { Router } = require('express');
const settingsController = require('../controllers/settings.controller');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { updateStoreInfoSchema } = require('../validators/settings.validator');
const { upload } = require('../middleware/upload');

const router = Router();

router.use(requireAuth, requireRole('admin'));

router.get('/', settingsController.get);
router.put('/qris', upload.single('foto'), settingsController.updateQris);
router.put('/toko', validate(updateStoreInfoSchema), settingsController.updateStoreInfo);

module.exports = router;
