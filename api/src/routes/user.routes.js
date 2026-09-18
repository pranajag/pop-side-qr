const { Router } = require('express');
const userController = require('../controllers/user.controller');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const validate = require('../middleware/validate');
const { validateIdParam } = require('../middleware/validateParams');
const { createUserSchema, updateUserSchema } = require('../validators/user.validator');

const router = Router();

// Staff account management is admin-only — a kasir must never be able to
// create accounts, change roles, or (de)activate anyone, including itself.
router.use(requireAuth, requireRole('admin'));

router.get('/', userController.list);
router.post('/', validate(createUserSchema), userController.create);
router.put('/:id', validateIdParam, validate(updateUserSchema), userController.update);
router.delete('/:id', validateIdParam, userController.remove);

module.exports = router;
