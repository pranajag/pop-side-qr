const { Router } = require('express');
const reservationController = require('../controllers/reservation.controller');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { validateIdParam } = require('../middleware/validateParams');
const {
  createReservationSchema,
  updateReservationSchema,
  updateReservationStatusSchema,
  catatPembayaranDpSchema,
} = require('../validators/reservation.validator');

const router = Router();

// Taking/managing a booking (often over the phone) is day-to-day
// front-of-house work, same as order handling — not admin-only.
router.use(requireAuth, requireRole('admin', 'kasir'));

router.get('/', reservationController.list);
// Didaftarkan SEBELUM '/:id' — kalau tidak, 'aturan-dp' ditangkap sebagai
// id dan ditolak validateIdParam.
router.get('/aturan-dp', reservationController.aturanDp);
router.get('/:id', validateIdParam, reservationController.get);
router.post('/', validate(createReservationSchema), reservationController.create);
router.put('/:id', validateIdParam, validate(updateReservationSchema), reservationController.update);
router.patch('/:id/status', validateIdParam, validate(updateReservationStatusSchema), reservationController.updateStatus);
router.post('/:id/pembayaran-dp', validateIdParam, validate(catatPembayaranDpSchema), reservationController.catatPembayaranDp);
router.delete('/:id', validateIdParam, reservationController.remove);

module.exports = router;
