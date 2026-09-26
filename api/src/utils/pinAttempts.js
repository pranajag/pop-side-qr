// Tiny in-memory failed-PIN-attempt tracker, scoped per userId — same spirit
// as the login lockout (rateLimit.js's loginLimiter) but purpose-built here
// since PIN verification happens inside orderManagement.service.js's
// updateStatus, not behind its own route, so a route-level rate limiter
// can't gate just this one case without also throttling every ordinary
// status change on the same endpoint.
//
// 3x salah dalam 15 menit -> terkunci 15 menit penuh terhitung dari salah
// yang ketiga (bukan dari salah pertama). PIN cuma 4-6 digit, jadi batas
// ketat inilah yang sebenarnya melindunginya: 3 tebakan per 15 menit
// membuat mencoba semua kombinasi 4 digit butuh berbulan-bulan.
const { buatPenghitung } = require('./penghitungGagal');

const MAX_ATTEMPTS = 3;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

const { isLocked, recordFailure, recordSuccess } = buatPenghitung({ maks: MAX_ATTEMPTS, jendelaMs: WINDOW_MS, kunciMs: LOCK_MS });

module.exports = { isLocked, recordFailure, recordSuccess, MAX_ATTEMPTS, LOCK_MS };
