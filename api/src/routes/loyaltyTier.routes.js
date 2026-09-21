const { Router } = require('express');
const loyaltyTierController = require('../controllers/loyaltyTier.controller');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { validateIdParam } = require('../middleware/validateParams');
const { createLoyaltyTierSchema, updateLoyaltyTierSchema } = require('../validators/loyaltyTier.validator');

const router = Router();

router.use(requireAuth);

// Reading the tier list is day-to-day counter work — a kasir needs to know
// the thresholds to tell a member "beli lagi 20 poin buat naik ke 10%",
// same reasoning customer.routes.js already draws. Changing the tiers
// themselves is a business-policy call, admin-only (same boundary as
// pajak/service charge in settings.routes.js).
router.get('/', requireRole('admin', 'kasir'), loyaltyTierController.list);
router.post('/', requireRole('admin'), validate(createLoyaltyTierSchema), loyaltyTierController.create);
router.put('/:id', requireRole('admin'), validateIdParam, validate(updateLoyaltyTierSchema), loyaltyTierController.update);
router.delete('/:id', requireRole('admin'), validateIdParam, loyaltyTierController.remove);

module.exports = router;
