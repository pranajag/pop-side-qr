const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// IP alone over-shares a bucket across every table on the cafe's WiFi (one
// public IP behind NAT for the whole venue) — a busy shift with several
// tables ordering/polling concurrently can exhaust a purely-per-IP limit
// from completely unrelated customers' traffic. Scoping the key to IP +
// the request's own table-token/order-code keeps each real customer's
// budget independent of everyone else's, while a single customer/table
// still can't exceed the same limit AGENTS.md specifies — this narrows
// the bucket, it doesn't loosen it.
function scopedKey(req, scope) {
  return `${ipKeyGenerator(req.ip)}:${scope || ''}`;
}

// 5 failed logins / 1 minute / (IP + username) combination. Shortened from
// 15 minutes at the store owner's explicit request (faster recovery for a
// staff member who just mistyped their password) — worth being clear about
// the tradeoff this accepts: at 5 attempts/min instead of 5/15min, a
// sustained guessing attempt can try ~15x more passwords per hour than
// before. Real-world exposure stays bounded by passwordSchema's own
// 8-72 char minimum (validators/common.js) and by this still being an
// (IP+username)-scoped lock, not a global one — but a weak, guessable
// password is meaningfully easier to eventually brute-force under this
// window than under the old one.
// keyGenerator must route req.ip through ipKeyGenerator (not use it raw) —
// express-rate-limit >=8.2 statically inspects the function source and
// refuses to start (ERR_ERL_KEY_GEN_IPV6) if it sees a bare req.ip, since a
// raw IPv6 address lets an attacker dodge the limit by rotating within their
// assigned /64 prefix.
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${(req.body?.username || '').toLowerCase()}`,
  handler: (req, res) => {
    res.status(429).json({ error: 'Terlalu banyak percobaan gagal. Coba lagi nanti.' });
  },
});

// AGENTS.md rate limit rule: 10/menit/(IP+token meja) untuk create order —
// scoped per table, not just per IP (see scopedKey above).
const createOrderLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => scopedKey(req, req.body?.token),
  handler: (req, res) => {
    res.status(429).json({ error: 'Terlalu banyak percobaan order. Coba lagi sebentar.' });
  },
});

// AGENTS.md rate limit rule: 5/menit/(IP+kode order) untuk cek status order
// — scoped per order, not just per IP (see scopedKey above).
//
// SECURITY: this alone does NOT bound guessing. kodeOrder is the attacker's
// own input, and it's part of the key — so every distinct guess lands in a
// brand-new bucket and this limiter never fires no matter how fast someone
// enumerates codes (confirmed live: 30 distinct-code requests from one IP,
// zero 429s). orderStatusIpLimiter below is the actual anti-enumeration
// control; this one only stops hammering of one already-known code.
const orderStatusLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => scopedKey(req, req.params?.kodeOrder),
  handler: (req, res) => {
    res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi sebentar.' });
  },
});

// Plain per-IP, deliberately NOT scoped by kodeOrder — this is what actually
// caps enumeration speed, since the key here doesn't depend on the guess
// itself. kodeOrder's random suffix is only 4 chars over a 32-char alphabet
// (~1.05M combinations/day, see utils/orderCode.js) — small enough that an
// unthrottled GET could walk the whole day's keyspace in minutes and read
// back every order's customer name, items, and total. 30/min still gives a
// busy cafe's shared WiFi IP headroom for ~10 tables each polling their own
// order every 20s (OrderView.vue), while capping a single-IP attacker to
// ~43k guesses/day — full enumeration now needs many source IPs, not one.
const orderStatusIpLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
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
// Same enumeration gap as orderStatusLimiter above, closed the same way by
// confirmPaymentIpLimiter below — see that comment for why keying by
// kodeOrder alone never throttles a guessing attacker.
const confirmPaymentLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => scopedKey(req, req.params?.kodeOrder),
  handler: (req, res) => {
    res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi sebentar.' });
  },
});

// Plain per-IP anti-enumeration backstop, same reasoning as
// orderStatusIpLimiter — tighter (10/min) since a real customer only ever
// submits "sudah bayar" for their own order once or twice, never on a
// polling interval. Bounds how fast a stranger can spray fake payment
// proofs across other customers' orders (each hit flips a real order to
// "waiting_verif" and drops junk into the kasir's verification queue).
const confirmPaymentIpLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler: (req, res) => {
    res.status(429).json({ error: 'Terlalu banyak percobaan. Coba lagi sebentar.' });
  },
});

// Not an order, so no anti-guessing rationale like the ones above — this
// is purely spam-prevention against a customer mashing the button. Scoped
// per table so one table hammering it doesn't burn the whole cafe WiFi's
// shared budget for every other table.
const staffCallLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => scopedKey(req, req.body?.token),
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

// Keyed by the verified API key (requireApiKey.js runs first in the same
// route chain, so req.apiKey is already set), not IP — an external
// integration server can share an IP with unrelated traffic or run behind
// a rotating cloud IP, so IP is the wrong unit of "one integration" here.
// 60/min is generous for a periodic sync job, tight enough to bound a
// misconfigured client hammering it in a loop.
const externalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `apikey:${req.apiKey?.id ?? ipKeyGenerator(req.ip)}`,
  handler: (req, res) => {
    res.status(429).json({ error: 'Terlalu banyak permintaan.' });
  },
});

// Mounted ahead of requireApiKey (external.routes.js), unlike
// externalApiLimiter above — a request with a missing/invalid/revoked key
// never reaches requireApiKey's req.apiKey assignment, so a limiter keyed
// off req.apiKey.id would never even apply to exactly the requests (key
// guessing, a revoked key retried in a loop) it most needs to bound. Plain
// per-IP here means every hit counts against the same budget regardless of
// which (or whether any) key was tried. 256-bit key entropy already makes
// guessing computationally infeasible — this is defense in depth against
// that plus cheap request-flooding/DB-load from garbage Bearer tokens, not
// the primary control.
const externalAuthLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  handler: (req, res) => {
    res.status(429).json({ error: 'Terlalu banyak permintaan.' });
  },
});

module.exports = {
  loginLimiter,
  createOrderLimiter,
  orderStatusLimiter,
  orderStatusIpLimiter,
  confirmPaymentLimiter,
  confirmPaymentIpLimiter,
  staffCallLimiter,
  tableVerifyLimiter,
  publicReadLimiter,
  publicImageLimiter,
  csrfTokenLimiter,
  externalApiLimiter,
  externalAuthLimiter,
};
