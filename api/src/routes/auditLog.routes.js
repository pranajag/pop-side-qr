const { Router } = require('express');
const auditLogController = require('../controllers/auditLog.controller');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const { validateQuery } = require('../middleware/validate');
const { auditLogQuerySchema } = require('../validators/auditLog.validator');

const router = Router();

// Hanya baca, hanya admin. Tidak ada route untuk mengubah atau menghapus
// log audit — dan kalaupun ada, trigger database menolaknya.
router.use(requireAuth, requireRole('admin'));

router.get('/', validateQuery(auditLogQuerySchema), auditLogController.list);

module.exports = router;
