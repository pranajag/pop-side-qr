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

// AGENTS.md rate limit rule: 10/menit/IP untuk create order.
const createOrderLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler: (req, res) => {
    res.status(429).json({ error: 'Terlalu banyak percobaan order. Coba lagi sebentar.' });
  },
});

// AGENTS.md rate limit rule: 5/menit/IP untuk cek status order.
const orderStatusLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler: (req, res) => {
    res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi sebentar.' });
  },
});

// Not separately enumerated in AGENTS.md's rate-limit rule, but this is a
// mutating action gated by nothing but the same guessable kode_order space
// as the (5/min) status-check endpoint — arguably higher-stakes, since a
// hit here flips a real order to "waiting_verif" without any payment
// having happened. Matches orderStatusLimiter's bound for consistency.
const confirmPaymentLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler: (req, res) => {
    res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi sebentar.' });
  },
});

// Not an order, so no anti-guessing rationale like the ones above — this
// is purely spam-prevention against a customer mashing the button.
const staffCallLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler: (req, res) => {
    res.status(429).json({ error: 'Terlalu banyak permintaan. Coba lagi sebentar.' });
  },
});

// The table-scan endpoint (GET /tables/:token) had no limiter at all —
// the 64-hex HMAC token itself is what actually blocks guessing (256 bits
// of entropy makes brute force infeasible regardless of any rate limit),
// but an unbounded GET still lets anyone hammer this route for cheap
// resource-exhaustion / scraping. Generous limit since a real customer's
// own page can legitimately re-verify a few times (reload, back-forward).
const tableVerifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler: (req, res) => {
    res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi sebentar.' });
  },
});

// Menu/settings reads and the cart-total recompute had no limiter either —
// same resource-exhaustion/scraping concern as above, just for read-mostly
// routes instead. Generous enough that normal browsing (menu load, each
// cart edit debounced at 250ms) never gets close.
const publicReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler: (req, res) => {
    res.status(429).json({ error: 'Terlalu banyak permintaan. Coba lagi sebentar.' });
  },
});

// Photo/QRIS-image serving is requested many times per page load (one per
// product shown) by design, so this needs real headroom — sized to stay
// out of the way of legitimate browsing while still bounding gross abuse
// (e.g. someone scripting repeated full-menu-photo scrapes).
const publicImageLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler: (req, res) => {
    res.status(429).json({ error: 'Terlalu banyak permintaan.' });
  },
});

// GET /auth/csrf-token is mounted ahead of both the CSRF check AND (unlike
// every public.routes.js route) had no limiter of its own — every hit
// allocates a fresh express-session row (saveUninitialized: true, no cookie
// required) in the unbounded in-memory store. Unlimited + unauthenticated +
// session-creating is exactly the combination app.js's own comment warns
// public.routes.js must never be mounted after session() to avoid; this
// route slipped through that same hole. Generous limit since real usage
// (page load, pre-login, post-403 retry) never approaches it.
const csrfTokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler: (req, res) => {
    res.status(429).json({ error: 'Terlalu banyak permintaan. Coba lagi sebentar.' });
  },
});

module.exports = {
  loginLimiter,
  createOrderLimiter,
  orderStatusLimiter,
  confirmPaymentLimiter,
  staffCallLimiter,
  tableVerifyLimiter,
  publicReadLimiter,
  publicImageLimiter,
  csrfTokenLimiter,
};
