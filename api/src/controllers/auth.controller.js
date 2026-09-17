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

async function me(req, res) {
  res.json({ user: req.session.user });
}

module.exports = { csrfToken, login, logout, me };
