const { Router } = require('express');
const staffCallController = require('../controllers/staffCall.controller');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const { validateIdParam } = require('../middleware/validateParams');

const router = Router();

// Same actor scope as order handling — responding to a customer's call is
// kasir's job, not admin-only (MEMORY.md's actor descriptions).
router.use(requireAuth, requireRole('admin', 'kasir'));

router.get('/', staffCallController.list);
router.patch('/:id/resolve', validateIdParam, staffCallController.resolve);

module.exports = router;
