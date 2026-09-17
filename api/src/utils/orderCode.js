const crypto = require('crypto');
const { jakartaDateStamp } = require('./jakartaTime');

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

function generateOrderCode(date = new Date()) {
  return `ORD-${jakartaDateStamp(date)}-${randomSuffix(4)}`;
}

module.exports = { generateOrderCode };
