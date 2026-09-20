const { Router } = require('express');
const webhookController = require('../controllers/webhook.controller');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { validateIdParam } = require('../middleware/validateParams');
const { createWebhookSchema, updateWebhookSchema } = require('../validators/webhook.validator');

const router = Router();

router.use(requireAuth, requireRole('admin'));

router.get('/', webhookController.list);
router.post('/', validate(createWebhookSchema), webhookController.create);
router.put('/:id', validateIdParam, validate(updateWebhookSchema), webhookController.setActive);
router.delete('/:id', validateIdParam, webhookController.remove);

module.exports = router;
