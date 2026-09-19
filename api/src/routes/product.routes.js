const { Router } = require('express');
const productController = require('../controllers/product.controller');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { validateIdParam } = require('../middleware/validateParams');
const { upload } = require('../middleware/upload');
const { createProductSchema, updateProductSchema } = require('../validators/product.validator');

const router = Router();

// Managing products (create/edit/delete) is admin-only. Listing them isn't
// — a kasir can't reach the Produk management page itself (frontend route
// guard), but OrdersView's low-stock banner reads this same list, and a
// kasir taking orders needs to know what's running low just as much as
// admin does. Public menu browsing (Sprint 3) reads products through a
// separate, unauthenticated route — this one stays behind login either way.
router.use(requireAuth);

router.get('/', productController.list);
router.post('/', requireRole('admin'), upload.single('foto'), validate(createProductSchema), productController.create);
router.put(
  '/:id',
  requireRole('admin'),
  validateIdParam,
  upload.single('foto'),
  validate(updateProductSchema),
  productController.update
);
router.delete('/:id', requireRole('admin'), validateIdParam, productController.remove);

module.exports = router;
