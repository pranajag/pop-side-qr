const pino = require('pino');

const isProd = process.env.NODE_ENV === 'production';

// Nomor HP ikut tertulis di URL pencarian member (?search=0812...) dan di
// parameter lain — log bukan tempat data pribadi. Deretan 8 digit atau
// lebih (bentuk nomor HP) ditampilkan sebagian saja: 0812******88.
function samarkanNomor(teks) {
  return typeof teks === 'string'
    ? teks.replace(/\+?\d{8,}/g, (n) => `${n.slice(0, 4)}${'*'.repeat(Math.max(0, n.length - 6))}${n.slice(-2)}`)
    : teks;
}

function samarkanObjek(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, samarkanNomor(v)]));
}

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // Without this, pino-http's default req/res serializers write every
  // session cookie and every external API key into the log in plaintext on
  // every single request (confirmed by direct test) — whoever can read
  // logs (a log aggregator, a support engineer, a misconfigured bucket)
  // could hijack any active admin session or external integration without
  // ever touching the database. set-cookie is included for the same reason
  // in reverse: the login response's own Set-Cookie header carries the
  // freshly issued session id.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-csrf-token"]',
      'req.headers["x-api-key"]',
      'res.headers["set-cookie"]',
    ],
    censor: '[REDACTED]',
  },
  transport: isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard' },
      },
});

module.exports = logger;
module.exports.samarkanNomor = samarkanNomor;
module.exports.samarkanObjek = samarkanObjek;
