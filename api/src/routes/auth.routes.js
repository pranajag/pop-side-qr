const { Router } = require('express');
const authController = require('../controllers/auth.controller');
const requireAuth = require('../middleware/requireAuth');
const validate = require('../middleware/validate');
const { loginSchema, kode2faSchema } = require('../validators/auth.validator');
const { loginLimiter, loginUsernameLimiter, duaFaktorLimiter } = require('../middleware/rateLimit');

const router = Router();

// GET /csrf-token is intentionally NOT registered here — app.js mounts it
// directly on `app`, before doubleCsrfProtection and before this router,
// specifically so the token-issuing route itself isn't CSRF-gated. A copy
// here would never be reached (Express matches the first-registered route)
// and would silently rot if ever edited expecting it to apply.
router.post('/login', loginLimiter, loginUsernameLimiter, validate(loginSchema), authController.login);
// Langkah kedua login untuk akun ber-2FA (wajib untuk admin). Hanya jalan
// setelah password benar (auth.service.js pending2fa), bukan route terbuka.
router.post('/2fa/setup', duaFaktorLimiter, authController.setup2fa);
router.post('/2fa/aktifkan', duaFaktorLimiter, validate(kode2faSchema), authController.aktifkan2fa);
router.post('/2fa/verifikasi', duaFaktorLimiter, validate(kode2faSchema), authController.verifikasi2fa);
router.post('/logout', requireAuth, authController.logout);
// Deliberately not requireAuth — see the comment on authController.me.
router.get('/me', authController.me);

module.exports = router;
