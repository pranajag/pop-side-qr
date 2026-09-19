const { Router } = require('express');
const categoryController = require('../controllers/category.controller');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { validateIdParam } = require('../middleware/validateParams');
const { createCategorySchema, updateCategorySchema } = require('../validators/category.validator');

const router = Router();

// Managing categories (create/edit/delete) is admin-only. Listing them
// isn't — a kasir can't reach the Kategori management page itself (frontend
// route guard), but ManualOrderView's product picker labels each product
// with its category name for every staff role, and needs this same list to
// do it. Same pattern as product.routes.js for the identical reason.
router.use(requireAuth);

router.get('/', categoryController.list);
router.post('/', requireRole('admin'), validate(createCategorySchema), categoryController.create);
router.put('/:id', requireRole('admin'), validateIdParam, validate(updateCategorySchema), categoryController.update);
router.delete('/:id', requireRole('admin'), validateIdParam, categoryController.remove);

module.exports = router;
