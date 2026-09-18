const { Router } = require('express');
const authController = require('../controllers/auth.controller');
const requireAuth = require('../middleware/requireAuth');
const validate = require('../middleware/validate');
const { loginSchema } = require('../validators/auth.validator');
const { loginLimiter } = require('../middleware/rateLimit');

const router = Router();

// GET /csrf-token is intentionally NOT registered here — app.js mounts it
// directly on `app`, before doubleCsrfProtection and before this router,
// specifically so the token-issuing route itself isn't CSRF-gated. A copy
// here would never be reached (Express matches the first-registered route)
// and would silently rot if ever edited expecting it to apply.
router.post('/login', loginLimiter, validate(loginSchema), authController.login);
router.post('/logout', requireAuth, authController.logout);
router.get('/me', requireAuth, authController.me);

module.exports = router;
