const authService = require('../services/auth.service');
const { generateCsrfToken } = require('../middleware/csrf');
const { SESSION_COOKIE_NAME, SESSION_COOKIE_CLEAR_OPTIONS } = require('../utils/session');

async function csrfToken(req, res) {
  res.json({ csrfToken: generateCsrfToken(req, res) });
}

// Jawaban: { user, csrfToken } kalau login selesai, atau { langkah:
// 'kode-2fa' | 'setup-2fa' } kalau akun ini wajib 2FA (belum login).
async function login(req, res) {
  const { username, password } = req.body;
  const result = await authService.login(req, res, username, password);
  res.json(result);
}

async function setup2fa(req, res) {
  res.json(await authService.setup2fa(req));
}

async function aktifkan2fa(req, res) {
  res.json(await authService.aktifkan2fa(req, res, req.body.kode));
}

async function verifikasi2fa(req, res) {
  res.json(await authService.verifikasi2fa(req, res, req.body.kode));
}

async function logout(req, res) {
  await authService.logout(req);
  res.clearCookie(SESSION_COOKIE_NAME, SESSION_COOKIE_CLEAR_OPTIONS);
  res.json({ message: 'Logged out' });
}

// Session probe, not a protected resource: "who am I?" has a legitimate
// answer when nobody is logged in, and that answer is null — not 401.
// Gating this behind requireAuth made every logged-out page load emit a
// red 401 in the browser console (nothing was wrong) and, on a deep link,
// trip the session-expired redirect for a session that never existed.
// Returns only the caller's own session user, so there is nothing to leak.
// Sesi admin tanpa tanda 2FA (dari sebelum 2FA diwajibkan) dianggap belum
// login — requireAuth juga menolaknya.
async function me(req, res) {
  const user = req.session.user ?? null;
  if (user?.role === 'admin' && req.session.duaFaktor !== true) {
    return res.json({ user: null });
  }
  res.json({ user });
}

module.exports = { csrfToken, login, setup2fa, aktifkan2fa, verifikasi2fa, logout, me };
