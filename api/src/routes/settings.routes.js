const { Router } = require('express');
const settingsController = require('../controllers/settings.controller');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const {
  updateStoreInfoSchema,
  updateMemberEnabledSchema,
  updateAturanDpSchema,
  updatePinVerifikasiSchema,
} = require('../validators/settings.validator');
const { upload } = require('../middleware/upload');

const router = Router();

router.use(requireAuth, requireRole('admin'));

router.get('/', settingsController.get);
router.put('/qris', upload.single('foto'), settingsController.updateQris);
router.put('/toko', validate(updateStoreInfoSchema), settingsController.updateStoreInfo);
// Surfaced on the dashboard rather than buried in Pengaturan — this is a
// switch staff flip during a shift, not one-time store setup.
router.patch('/member', validate(updateMemberEnabledSchema), settingsController.updateMemberEnabled);
// Aturan harga toko, jadi admin saja — sama seperti pajak & service charge.
// Kasir tetap bisa MEMBACA-nya (GET /admin/reservations/aturan-dp) dan tetap
// bisa menyesuaikan DP wajib untuk satu reservasi tertentu.
router.patch('/reservasi-dp', validate(updateAturanDpSchema), settingsController.updateAturanDp);
router.patch('/pin-verifikasi', validate(updatePinVerifikasiSchema), settingsController.updatePinVerifikasi);

module.exports = router;
