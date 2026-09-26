const { Router } = require('express');
const cookieParser = require('cookie-parser');
const menuController = require('../controllers/menu.controller');
const cartController = require('../controllers/cart.controller');
const tableController = require('../controllers/table.controller');
const orderController = require('../controllers/order.controller');
const memberOtpController = require('../controllers/memberOtp.controller');
const validate = require('../middleware/validate');
const { cartTotalSchema } = require('../validators/cart.validator');
const { createOrderSchema } = require('../validators/order.validator');
const { mintaOtpSchema, verifikasiOtpSchema } = require('../validators/memberOtp.validator');
const {
  createOrderLimiter,
  createOrderMejaLimiter,
  staffCallMejaLimiter,
  orderStatusLimiter,
  orderStatusIpLimiter,
  confirmPaymentLimiter,
  confirmPaymentIpLimiter,
  staffCallLimiter,
  tableVerifyLimiter,
  publicReadLimiter,
  memberLookupLimiter,
  publicImageLimiter,
  otpMintaNomorLimiter,
  otpMintaHarianLimiter,
  otpMintaIpLimiter,
  otpVerifikasiLimiter,
} = require('../middleware/rateLimit');
const productPhoto = require('../services/productPhoto.service');
const settingsImage = require('../services/settingsImage.service');
const settingsController = require('../controllers/settings.controller');
const staffCallController = require('../controllers/staffCall.controller');
const { createStaffCallSchema } = require('../validators/staffCall.validator');
const { upload } = require('../middleware/upload');

const router = Router();

// Cookie web publik (utils/cookiePublik.js): perangkat pemesan (pelacakan
// order) dan tanda verifikasi OTP member. Tanpa secret — isinya sudah
// ditandatangani/di-hash sendiri oleh kripto.js.
router.use(cookieParser());

// Intentionally unauthenticated: product photos and the store's QRIS image
// are shown on the public, no-login menu/checkout — this is the one
// upload category AGENTS.md's "serve via an auth-gated route" rule
// doesn't apply to, since there's nothing sensitive in either. Payment
// proof uploads (bukti bayar) are a different, private category and must
// NOT be exposed this way.
router.get('/products/photo/:filename', publicImageLimiter, productPhoto.serve);
router.get('/settings/qris-photo/:filename', publicImageLimiter, settingsImage.serve);

router.get('/menu', publicReadLimiter, menuController.getMenu);
router.get('/settings', publicReadLimiter, settingsController.getPublic);
router.get('/tables/:token', tableVerifyLimiter, tableController.verifyToken);
router.get('/tables/:token/bill', tableVerifyLimiter, orderController.bill);
// memberLookupLimiter only bites when the body carries a phone number —
// see its comment in rateLimit.js. Both run: the generic public budget
// still applies to the cart arithmetic itself.
router.post(
  '/cart/total',
  publicReadLimiter,
  memberLookupLimiter,
  validate(cartTotalSchema),
  cartController.total
);

router.post('/orders', createOrderLimiter, createOrderMejaLimiter, validate(createOrderSchema), orderController.create);

// OTP member — diskon tier baru berlaku setelah nomor terverifikasi.
router.post(
  '/member/otp',
  otpMintaIpLimiter,
  otpMintaNomorLimiter,
  otpMintaHarianLimiter,
  validate(mintaOtpSchema),
  memberOtpController.minta
);
router.post('/member/otp/verifikasi', otpVerifikasiLimiter, validate(verifikasiOtpSchema), memberOtpController.verifikasi);
router.post(
  '/orders/:kodeOrder/bayar',
  confirmPaymentIpLimiter,
  confirmPaymentLimiter,
  upload.single('bukti'),
  orderController.confirmPayment
);
router.get('/orders/:kodeOrder', orderStatusIpLimiter, orderStatusLimiter, orderController.track);
// Token berlangganan status order realtime — hanya untuk perangkat pemesan.
router.get('/orders/:kodeOrder/realtime', orderStatusIpLimiter, orderStatusLimiter, orderController.realtimeToken);
router.post('/call-staff', staffCallLimiter, staffCallMejaLimiter, validate(createStaffCallSchema), staffCallController.create);

module.exports = router;
