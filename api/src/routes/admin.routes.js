// Placeholder route. Its only purpose is to make RBAC concretely testable
// for Sprint 1 (admin-only endpoint must reject a kasir session with 403).
// Real admin functionality (menu/meja management, kasir accounts, reports)
// replaces this starting Sprint 2 — see docs/PLANNING.md.

const { Router } = require('express');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');

const router = Router();

router.get('/ping', requireAuth, requireRole('admin'), (req, res) => {
  res.json({ message: 'pong', user: req.session.user });
});

module.exports = router;
