const bcrypt = require('bcrypt');
const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const { generateCsrfToken } = require('../middleware/csrf');

// Precomputed once at startup so a login attempt for a username that
// doesn't exist still pays the same bcrypt cost as a real one — otherwise
// response timing would leak which usernames exist.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-constant-time-compare', 12);

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });
}

async function login(req, res, username, password) {
  const user = await prisma.user.findUnique({ where: { username } });

  if (!user || !user.isActive) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw new AppError(401, 'Invalid username or password');
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    throw new AppError(401, 'Invalid username or password');
  }

  // Regenerating changes req.session.id, which invalidates any CSRF token
  // minted for the pre-login session — a fresh token is issued below so the
  // client's very next protected request (e.g. logout) doesn't 403.
  await regenerateSession(req);
  req.session.user = { id: user.id, username: user.username, role: user.role };
  const csrfToken = generateCsrfToken(req, res, { overwrite: true });

  return {
    user: req.session.user,
    csrfToken,
  };
}

async function logout(req) {
  await destroySession(req);
}

module.exports = { login, logout };
