const { Router } = require('express');
const categoryController = require('../controllers/category.controller');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { validateIdParam } = require('../middleware/validateParams');
const { createCategorySchema, updateCategorySchema } = require('../validators/category.validator');

const router = Router();

// Every category route is admin-only (kasir has no menu-management access).
router.use(requireAuth, requireRole('admin'));

router.get('/', categoryController.list);
router.post('/', validate(createCategorySchema), categoryController.create);
router.put('/:id', validateIdParam, validate(updateCategorySchema), categoryController.update);
router.delete('/:id', validateIdParam, categoryController.remove);

module.exports = router;
