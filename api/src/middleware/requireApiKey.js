const apiKeyService = require('../services/apiKey.service');

// Separate auth path from requireAuth.js's session-cookie check — external
// tools (a bookkeeping app, an inventory sync, etc) can't hold a browser
// session or CSRF token, so /api/external/v1 routes use a Bearer API key
// instead of the cookie-session scheme every other authenticated route
// uses. Never mounted on the same route as requireAuth.
async function requireApiKey(req, res, next) {
  const header = req.get('authorization') || '';
  const rawKey = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!rawKey) {
    return res.status(401).json({ error: 'Butuh header Authorization: Bearer <api key>' });
  }

  const key = await apiKeyService.verify(rawKey);
  if (!key) {
    return res.status(401).json({ error: 'API key tidak valid atau sudah dicabut' });
  }

  req.apiKey = key;
  next();
}

module.exports = requireApiKey;
