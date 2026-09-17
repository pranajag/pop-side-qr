const { doubleCsrf } = require('csrf-csrf');

const isProd = process.env.NODE_ENV === 'production';

// The __Host- cookie-name prefix forces browsers to reject the cookie
// unless it's genuinely Secure, so the prefix (like `secure` itself below)
// can only be used once we're actually served over HTTPS.
const { doubleCsrfProtection, generateCsrfToken, invalidCsrfTokenError } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET,
  getSessionIdentifier: (req) => req.session.id,
  cookieName: isProd ? '__Host-popside.csrf-token' : 'popside.csrf-token',
  cookieOptions: {
    sameSite: 'strict',
    path: '/',
    secure: isProd,
    httpOnly: true,
  },
});

module.exports = { doubleCsrfProtection, generateCsrfToken, invalidCsrfTokenError };
