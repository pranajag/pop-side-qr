const { Router } = require('express');
const shiftController = require('../controllers/shift.controller');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');

const router = Router();

// Clocking in/out is core staff work, not admin-only — same reasoning as
// order handling (MEMORY.md). Every staff member sees the full shift list
// too: this is a personal timesheet + handoff log, not a staff-oversight
// audit (that's Riwayat Aktivitas, which stays admin-only).
router.use(requireAuth, requireRole('admin', 'kasir'));

router.get('/', shiftController.list);
router.get('/active', shiftController.active);
router.post('/start', shiftController.start);
router.post('/end', shiftController.end);

module.exports = router;
