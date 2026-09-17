const crypto = require('crypto');

// No 0/O, 1/I/l — this code gets read out loud by the customer to the
// kasir (MEMORY.md), so visually/verbally ambiguous characters are out.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomSuffix(length) {
  // 256 % 32 === 0, so byte % ALPHABET.length has zero modulo bias.
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

function jakartaDateStamp(date) {
  // Hardcoded IANA zone rather than relying on process.env.TZ — this must
  // stay Asia/Jakarta regardless of how the process itself is configured
  // (AGENTS.md rule #15: never let this silently become UTC).
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date).replace(/-/g, '');
}

function generateOrderCode(date = new Date()) {
  return `ORD-${jakartaDateStamp(date)}-${randomSuffix(4)}`;
}

module.exports = { generateOrderCode };
