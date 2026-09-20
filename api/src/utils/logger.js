const pino = require('pino');

const isProd = process.env.NODE_ENV === 'production';

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
    paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
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
