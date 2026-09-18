const { Router } = require('express');
const shiftController = require('../controllers/shift.controller');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { validateIdParam } = require('../middleware/validateParams');
const { endShiftSchema } = require('../validators/shift.validator');

const router = Router();

// Clocking in/out is core staff work, not admin-only — same reasoning as
// order handling (MEMORY.md). Every staff member sees the full shift list
// too: this is a personal timesheet + handoff log, not a staff-oversight
// audit (that's Riwayat Aktivitas, which stays admin-only).
router.use(requireAuth, requireRole('admin', 'kasir'));

// /active must stay ahead of /:id — otherwise "active" would be parsed as
// an :id and rejected by validateIdParam before ever reaching that route.
router.get('/', shiftController.list);
router.get('/active', shiftController.active);
router.post('/start', shiftController.start);
router.post('/end', validate(endShiftSchema), shiftController.end);
router.get('/:id', validateIdParam, shiftController.detail);

module.exports = router;
