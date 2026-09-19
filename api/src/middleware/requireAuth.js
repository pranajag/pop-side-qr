const prisma = require('../lib/prisma');
const { destroySession } = require('../utils/session');

// req.session.user is set once at login and otherwise never re-read from
// the DB — so an admin deactivating or demoting a staff account mid-shift
// (UsersView.vue's own copy tells admins this is the safe alternative to
// deleting an account with history) previously had zero effect on a
// session that was already open: the target kept full old-role access
// until their 30-minute idle timeout happened to expire on its own.
// Re-checking here, on every authenticated request, closes that gap:
// deactivation ends the session outright, a role change is picked up
// immediately by whatever requireRole check runs next in the same chain.
async function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const user = await prisma.user.findUnique({
    where: { id: req.session.user.id },
    select: { isActive: true, role: true },
  });

  if (!user || !user.isActive) {
    await destroySession(req);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.session.user.role = user.role;
  next();
}

module.exports = requireAuth;
