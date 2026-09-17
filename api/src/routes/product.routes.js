const { Router } = require('express');
const productController = require('../controllers/product.controller');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { validateIdParam } = require('../middleware/validateParams');
const { upload } = require('../middleware/upload');
const { createProductSchema, updateProductSchema } = require('../validators/product.validator');

const router = Router();

// Every product management route is admin-only. Public menu browsing
// (Sprint 3) reads products through a separate, unauthenticated route.
router.use(requireAuth, requireRole('admin'));

router.get('/', productController.list);
router.post('/', upload.single('foto'), validate(createProductSchema), productController.create);
router.put('/:id', validateIdParam, upload.single('foto'), validate(updateProductSchema), productController.update);
router.delete('/:id', validateIdParam, productController.remove);

module.exports = router;
