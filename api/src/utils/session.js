// Promise wrappers around express-session's callback-style API — shared by
// auth.service.js (login/logout) and requireAuth.js (mid-session
// deactivation), so there's exactly one place either gets touched.
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

module.exports = { regenerateSession, destroySession };
