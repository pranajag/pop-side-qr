const { Router } = require('express');
const externalController = require('../controllers/external.controller');
const requireApiKey = require('../middleware/requireApiKey');
const { externalApiLimiter, externalAuthLimiter } = require('../middleware/rateLimit');

const router = Router();

// v1: read-only, no per-key scoping (see ApiKey's own schema comment) —
// every valid key gets the same two endpoints. Never mounted behind
// requireAuth/session — external callers authenticate with a Bearer API
// key instead (requireApiKey.js), not a browser session.
//
// externalAuthLimiter runs BEFORE requireApiKey so a missing/invalid/
// revoked key still counts against a budget — externalApiLimiter alone
// (keyed by req.apiKey.id) never applies to a rejected request, since
// requireApiKey responds 401 before req.apiKey is ever set.
router.use(externalAuthLimiter, requireApiKey, externalApiLimiter);

router.get('/orders', externalController.orders);
router.get('/products', externalController.products);

module.exports = router;
