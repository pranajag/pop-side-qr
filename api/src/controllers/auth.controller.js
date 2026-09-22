const authService = require('../services/auth.service');
const { generateCsrfToken } = require('../middleware/csrf');

async function csrfToken(req, res) {
  res.json({ csrfToken: generateCsrfToken(req, res) });
}

async function login(req, res) {
  const { username, password } = req.body;
  const result = await authService.login(req, res, username, password);
  res.json(result);
}

async function logout(req, res) {
  await authService.logout(req);
  res.clearCookie('popside.sid');
  res.json({ message: 'Logged out' });
}

// Session probe, not a protected resource: "who am I?" has a legitimate
// answer when nobody is logged in, and that answer is null — not 401.
// Gating this behind requireAuth made every logged-out page load emit a
// red 401 in the browser console (nothing was wrong) and, on a deep link,
// trip the session-expired redirect for a session that never existed.
// Returns only the caller's own session user, so there is nothing to leak.
async function me(req, res) {
  res.json({ user: req.session.user ?? null });
}

module.exports = { csrfToken, login, logout, me };
