const { Router } = require('express');
const reportController = require('../controllers/report.controller');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');

const router = Router();

// Revenue reports are admin-only — kasir's job is confirming/progressing
// orders, not seeing store-wide takings (MEMORY.md's actor descriptions).
router.use(requireAuth, requireRole('admin'));

router.get('/', reportController.get);
router.get('/daily', reportController.dailyBreakdown);
router.get('/export.xlsx', reportController.exportExcel);
router.get('/jurnal.xlsx', reportController.exportJournalExcel);

module.exports = router;
