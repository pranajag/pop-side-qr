const { Router } = require('express');
const tableController = require('../controllers/table.controller');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { validateIdParam } = require('../middleware/validateParams');
const { createTableSchema, updateTableSchema, setBillOpenSchema } = require('../validators/table.validator');

const router = Router();

// Table setup (incl. printing QR codes) is an admin task, not day-to-day
// kasir work. Open-bill toggling lives here too, not just because it's a
// table-state mutation — DashboardView.vue (where it's surfaced,
// admin-web's router) is itself admin-only by explicit request, so there's
// no kasir-facing surface that would ever call this anyway.
router.use(requireAuth, requireRole('admin'));

router.get('/', tableController.list);
router.post('/', validate(createTableSchema), tableController.create);
router.put('/:id', validateIdParam, validate(updateTableSchema), tableController.update);
router.delete('/:id', validateIdParam, tableController.remove);
router.post('/:id/reset-token', validateIdParam, tableController.resetToken);
router.patch('/:id/bill-open', validateIdParam, validate(setBillOpenSchema), tableController.setBillOpen);
router.post('/:id/clear-visit', validateIdParam, tableController.clearVisit);
router.get('/:id/qr', validateIdParam, tableController.qrImage);

module.exports = router;
