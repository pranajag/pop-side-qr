const { Router } = require('express');
const customerController = require('../controllers/customer.controller');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const { validateIdParam } = require('../middleware/validateParams');

const router = Router();

// Looking up a member's points is day-to-day counter work (kasir needs to
// tell a customer their balance, same reasoning as order handling) — not
// admin-only. Nothing here can change a balance directly; that only ever
// happens as a side effect of order.service.js's createManualOrder or
// orderManagement.service.js's void path.
router.use(requireAuth, requireRole('admin', 'kasir'));

router.get('/', customerController.list);
router.get('/:id', validateIdParam, customerController.get);

module.exports = router;
