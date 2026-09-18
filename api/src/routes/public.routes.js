const { Router } = require('express');
const menuController = require('../controllers/menu.controller');
const cartController = require('../controllers/cart.controller');
const tableController = require('../controllers/table.controller');
const orderController = require('../controllers/order.controller');
const validate = require('../middleware/validate');
const { cartTotalSchema } = require('../validators/cart.validator');
const { createOrderSchema } = require('../validators/order.validator');
const { createOrderLimiter, orderStatusLimiter, confirmPaymentLimiter, staffCallLimiter } = require('../middleware/rateLimit');
const productPhoto = require('../services/productPhoto.service');
const settingsImage = require('../services/settingsImage.service');
const settingsController = require('../controllers/settings.controller');
const staffCallController = require('../controllers/staffCall.controller');
const { createStaffCallSchema } = require('../validators/staffCall.validator');

const router = Router();

// Intentionally unauthenticated: product photos and the store's QRIS image
// are shown on the public, no-login menu/checkout — this is the one
// upload category AGENTS.md's "serve via an auth-gated route" rule
// doesn't apply to, since there's nothing sensitive in either. Payment
// proof uploads (bukti bayar) are a different, private category and must
// NOT be exposed this way.
router.get('/products/photo/:filename', productPhoto.serve);
router.get('/settings/qris-photo/:filename', settingsImage.serve);

router.get('/menu', menuController.getMenu);
router.get('/settings', settingsController.get);
router.get('/tables/:token', tableController.verifyToken);
router.post('/cart/total', validate(cartTotalSchema), cartController.total);

router.post('/orders', createOrderLimiter, validate(createOrderSchema), orderController.create);
router.post('/orders/:kodeOrder/bayar', confirmPaymentLimiter, orderController.confirmPayment);
router.get('/orders/:kodeOrder', orderStatusLimiter, orderController.track);
router.post('/call-staff', staffCallLimiter, validate(createStaffCallSchema), staffCallController.create);

module.exports = router;
