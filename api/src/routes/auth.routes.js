const { Router } = require('express');
const authController = require('../controllers/auth.controller');
const requireAuth = require('../middleware/requireAuth');
const validate = require('../middleware/validate');
const { loginSchema } = require('../validators/auth.validator');
const { loginLimiter } = require('../middleware/rateLimit');

const router = Router();

router.get('/csrf-token', authController.csrfToken);
router.post('/login', loginLimiter, validate(loginSchema), authController.login);
router.post('/logout', requireAuth, authController.logout);
router.get('/me', requireAuth, authController.me);

module.exports = router;
