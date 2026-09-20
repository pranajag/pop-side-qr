// Tiny in-memory failed-PIN-attempt tracker, scoped per userId — same spirit
// as the login lockout (rateLimit.js's loginLimiter) but purpose-built here
// since PIN verification happens inside orderManagement.service.js's
// updateStatus, not behind its own route, so a route-level rate limiter
// can't gate just this one case without also throttling every ordinary
// status change on the same endpoint.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000;

const attempts = new Map(); // userId -> { count, windowStart }

function isLocked(userId) {
  const entry = attempts.get(userId);
  if (!entry) return false;
  if (Date.now() - entry.windowStart > WINDOW_MS) {
    attempts.delete(userId);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(userId) {
  const entry = attempts.get(userId);
  if (!entry || Date.now() - entry.windowStart > WINDOW_MS) {
    attempts.set(userId, { count: 1, windowStart: Date.now() });
    return;
  }
  entry.count += 1;
}

function recordSuccess(userId) {
  attempts.delete(userId);
}

module.exports = { isLocked, recordFailure, recordSuccess, MAX_ATTEMPTS };
