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

// Nama cookie sesi — satu sumber untuk app.js (express-session) dan logout
// (clearCookie). Di produksi berawalan __Host-, dan browser hanya menghapus
// cookie kalau nama, path, dan atribut Secure-nya cocok: logout yang
// menghapus nama lain meninggalkan cookie sesi lama di browser.
const isProd = process.env.NODE_ENV === 'production';
const SESSION_COOKIE_NAME = isProd ? '__Host-popside.sid' : 'popside.sid';
const SESSION_COOKIE_CLEAR_OPTIONS = { path: '/', httpOnly: true, secure: isProd, sameSite: 'strict' };

module.exports = { regenerateSession, destroySession, SESSION_COOKIE_NAME, SESSION_COOKIE_CLEAR_OPTIONS };
