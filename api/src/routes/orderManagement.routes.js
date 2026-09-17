const { Router } = require('express');
const orderManagementController = require('../controllers/orderManagement.controller');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { validateIdParam } = require('../middleware/validateParams');
const { updateStatusSchema } = require('../validators/orderManagement.validator');

const router = Router();

// Order handling (confirm payment, progress through the kitchen) is core
// kasir work, not admin-only — see MEMORY.md's actor descriptions.
router.use(requireAuth, requireRole('admin', 'kasir'));

router.get('/', orderManagementController.list);
router.post('/:id/konfirmasi', validateIdParam, orderManagementController.confirmPayment);
router.patch('/:id/status', validateIdParam, validate(updateStatusSchema), orderManagementController.updateStatus);

module.exports = router;
