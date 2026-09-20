const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const pinoHttp = require('pino-http');

const logger = require('./utils/logger');
const { doubleCsrfProtection } = require('./middleware/csrf');
const { csrfTokenLimiter } = require('./middleware/rateLimit');
const errorHandler = require('./middleware/errorHandler');
const authController = require('./controllers/auth.controller');
const authRoutes = require('./routes/auth.routes');
const categoryRoutes = require('./routes/category.routes');
const productRoutes = require('./routes/product.routes');
const tableRoutes = require('./routes/table.routes');
const settingsRoutes = require('./routes/settings.routes');
const orderManagementRoutes = require('./routes/orderManagement.routes');
const reportRoutes = require('./routes/report.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const shiftRoutes = require('./routes/shift.routes');
const userRoutes = require('./routes/user.routes');
const staffCallRoutes = require('./routes/staffCall.routes');
const reservationRoutes = require('./routes/reservation.routes');
const customerRoutes = require('./routes/customer.routes');
const apiKeyRoutes = require('./routes/apiKey.routes');
const webhookRoutes = require('./routes/webhook.routes');
const publicRoutes = require('./routes/public.routes');
const externalRoutes = require('./routes/external.routes');

const isProd = process.env.NODE_ENV === 'production';

// Fail fast, not fail open — an empty or short SESSION_SECRET/CSRF_SECRET
// wouldn't stop the app from starting (express-session/csrf-csrf tolerate
// undefined), it would just quietly sign cookies with a guessable secret
// (or none), making session/CSRF-cookie tampering trivial. A misconfigured
// deploy should crash loudly at startup, not silently ship a broken lock.
for (const name of ['SESSION_SECRET', 'CSRF_SECRET']) {
  if (!process.env[name] || process.env[name].length < 32) {
    throw new Error(
      `${name} is missing or too short (need >=32 chars). Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    );
  }
}

const app = express();

// CORS_ORIGIN is comma-separated — admin-web and public-web run on
// different dev ports (and different real domains later), both need to
// call this API with credentials.
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Dev-only: match localhost/127.0.0.1/private-LAN on any port, instead of
// requiring an exact CORS_ORIGIN entry per port. This is what a real phone
// scanning a real QR code needs — PUBLIC_WEB_URL then points at the dev
// machine's LAN IP (e.g. http://192.168.1.23:5174) — and exact-match alone
// already caused two rounds of "forgot to add the origin" bugs in this
// project before any device testing even started. Never applies in
// production, where allowedOrigins' exact match is the only path.
const DEV_LAN_ORIGIN_PATTERN =
  /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      // `origin` is undefined for non-browser/same-origin requests (curl,
      // server-to-server) — those aren't subject to CORS, so allow them.
      if (!origin || allowedOrigins.includes(origin) || (!isProd && DEV_LAN_ORIGIN_PATTERN.test(origin))) {
        return callback(null, true);
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    // Browsers only expose a small safelisted set of response headers to
    // cross-origin JS by default — RateLimit-* (set by express-rate-limit's
    // standardHeaders) isn't in it, so without this the login page's
    // lockout countdown/remaining-attempts UI would silently never receive
    // real values despite the server sending them correctly on every
    // response.
    exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
  })
);
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(pinoHttp({ logger }));

// /api/public/* (customer-facing, no login — menu, table-token verify,
// cart total, and Sprint 4's order creation) is mounted before session and
// CSRF: no public controller ever touches req.session or req.cookies, and
// mounting it here means these routes never run the session middleware at
// all, so anonymous traffic (bots, uptime checks, every QR scan) can never
// allocate a session — with saveUninitialized: true below, a blanket
// app.use(session(...)) ahead of this line would let anyone grow the
// in-memory session store for free, with no rate limit on GET /menu or
// GET /tables/:token to slow them down.
app.use('/api/public', publicRoutes);

// Same reasoning as /api/public above — external.routes.js authenticates
// with a Bearer API key (requireApiKey.js), never a session cookie, so it
// has no use for session/CSRF either and is mounted in the same
// before-session zone to avoid allocating one per request.
app.use('/api/external/v1', externalRoutes);

app.use(
  session({
    name: 'popside.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    // GET /csrf-token (below) never writes to req.session — it only reads
    // req.session.id (csrf-csrf's getSessionIdentifier) — so without
    // saveUninitialized: true that session, and the id the CSRF token gets
    // bound to, wouldn't be persisted, and the following POST /login would
    // fail CSRF validation against a session that was never saved.
    saveUninitialized: true,
    rolling: true,
    cookie: {
      httpOnly: true,
      // Real requirement is HTTPS-in-production. Hardcoding `true` here
      // would also block every non-browser tool (curl/Postman) used to
      // test the login/session/RBAC flow locally, since only browsers get
      // a `localhost` carve-out for the Secure cookie attribute.
      secure: isProd,
      sameSite: 'strict',
      maxAge: 30 * 60 * 1000, // 30 min idle timeout; `rolling: true` slides this on every response.
    },
  })
);

// cookie-parser must run after express-session (csrf-csrf's documented
// requirement — the two middlewares can conflict over cookie parsing if
// reversed).
app.use(cookieParser());

// Token-issuing route mounted before the blanket CSRF check below. Rate
// limited because every hit allocates a fresh session in the in-memory
// store (saveUninitialized: true, no cookie needed) — unbounded here would
// be a trivial memory-exhaustion DoS against the one process serving both
// the public site and the admin dashboard.
app.get('/api/auth/csrf-token', csrfTokenLimiter, authController.csrfToken);

// Applied to everything below so every mutating admin/kasir route stays
// protected by default (GET/HEAD/OPTIONS are exempt via csrf-csrf's own
// defaults).
app.use(doubleCsrfProtection);

app.use('/api/auth', authRoutes);
app.use('/api/admin/categories', categoryRoutes);
app.use('/api/admin/products', productRoutes);
app.use('/api/admin/tables', tableRoutes);
app.use('/api/admin/settings', settingsRoutes);
app.use('/api/admin/orders', orderManagementRoutes);
app.use('/api/admin/reports', reportRoutes);
app.use('/api/admin/dashboard', dashboardRoutes);
app.use('/api/admin/shifts', shiftRoutes);
app.use('/api/admin/users', userRoutes);
app.use('/api/admin/staff-calls', staffCallRoutes);
app.use('/api/admin/reservations', reservationRoutes);
app.use('/api/admin/customers', customerRoutes);
app.use('/api/admin/api-keys', apiKeyRoutes);
app.use('/api/admin/webhooks', webhookRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(errorHandler);

module.exports = app;
