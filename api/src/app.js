const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const pinoHttp = require('pino-http');

const logger = require('./utils/logger');
const { doubleCsrfProtection } = require('./middleware/csrf');
const errorHandler = require('./middleware/errorHandler');
const authController = require('./controllers/auth.controller');
const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');

const isProd = process.env.NODE_ENV === 'production';

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(pinoHttp({ logger }));

app.use(
  session({
    name: 'popside.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    // No anonymous/customer traffic exists yet (that starts Sprint 3), so
    // there's no unauthenticated-session-row cost to worry about, and this
    // guarantees the session used to mint a CSRF token on GET /csrf-token
    // is still there for the following POST /login.
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

// Token-issuing route mounted before the blanket CSRF check below.
app.get('/api/auth/csrf-token', authController.csrfToken);

// Applied globally so every current and future mutating route is protected
// by default (GET/HEAD/OPTIONS are exempt via csrf-csrf's own defaults).
app.use(doubleCsrfProtection);

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(errorHandler);

module.exports = app;
