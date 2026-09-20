const { Router } = require('express');
const apiKeyController = require('../controllers/apiKey.controller');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { validateIdParam } = require('../middleware/validateParams');
const { createApiKeySchema } = require('../validators/apiKey.validator');

const router = Router();

// Managing what can read this store's data from outside is admin-only —
// same tier as Akun Staff, not day-to-day counter work.
router.use(requireAuth, requireRole('admin'));

router.get('/', apiKeyController.list);
router.post('/', validate(createApiKeySchema), apiKeyController.create);
router.post('/:id/revoke', validateIdParam, apiKeyController.revoke);

module.exports = router;
