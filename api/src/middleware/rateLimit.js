const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// 5 failed logins / 15 minutes / (IP + username) combination.
// keyGenerator must route req.ip through ipKeyGenerator (not use it raw) —
// express-rate-limit >=8.2 statically inspects the function source and
// refuses to start (ERR_ERL_KEY_GEN_IPV6) if it sees a bare req.ip, since a
// raw IPv6 address lets an attacker dodge the limit by rotating within their
// assigned /64 prefix.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${(req.body?.username || '').toLowerCase()}`,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many login attempts. Try again later.' });
  },
});

module.exports = { loginLimiter };
