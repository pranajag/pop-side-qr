const { Router } = require('express');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const realtime = require('../realtime');

const router = Router();

// Token menyambung ke notifikasi realtime staff (realtime.js). Diterbitkan
// di sini supaya aturan aksesnya persis sama dengan API: sesi login yang
// sah, akun aktif, admin wajib sudah lulus 2FA (requireAuth).
router.use(requireAuth, requireRole('admin', 'kasir'));

router.get('/token', (req, res) => {
  res.json({ token: realtime.tokenStaff(req.session.user) });
});

module.exports = router;
