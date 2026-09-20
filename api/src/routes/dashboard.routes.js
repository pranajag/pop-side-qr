const { Router } = require('express');
const dashboardController = require('../controllers/dashboard.controller');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');

const router = Router();

// Admin-only, same boundary as report.routes.js — this is the same
// store-wide revenue data, just summarized as a glance instead of a range
// report (MEMORY.md's actor descriptions: kasir confirms/progresses
// orders, doesn't see store-wide takings).
router.use(requireAuth, requireRole('admin'));

router.get('/', dashboardController.get);

module.exports = router;
