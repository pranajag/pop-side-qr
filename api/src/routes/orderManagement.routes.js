const { Router } = require('express');
const orderManagementController = require('../controllers/orderManagement.controller');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { validateIdParam } = require('../middleware/validateParams');
const { updateStatusSchema } = require('../validators/orderManagement.validator');
const { createManualOrderSchema } = require('../validators/order.validator');

const router = Router();

// Order handling (confirm payment, progress through the kitchen) is core
// kasir work, not admin-only — see MEMORY.md's actor descriptions.
router.use(requireAuth, requireRole('admin', 'kasir'));

router.get('/', orderManagementController.list);
// Admin-only, unlike the rest of this router — this is oversight of staff
// actions (who confirmed/cancelled what), not day-to-day order handling.
router.get('/activity-log', requireRole('admin'), orderManagementController.activityLog);
router.post('/manual', validate(createManualOrderSchema), orderManagementController.createManual);
router.post('/:id/konfirmasi', validateIdParam, orderManagementController.confirmPayment);
router.patch('/:id/status', validateIdParam, validate(updateStatusSchema), orderManagementController.updateStatus);
router.get('/:id/bukti-bayar', validateIdParam, orderManagementController.buktiBayar);

module.exports = router;
