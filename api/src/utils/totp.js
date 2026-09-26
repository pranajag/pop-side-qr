const crypto = require('node:crypto');

// TOTP (RFC 6238) — kode 6 digit yang berganti tiap 30 detik, sama seperti
// Google Authenticator / Authy / Microsoft Authenticator. Ditulis langsung
// dengan node:crypto (tanpa library tambahan) dan diuji dengan test vector
// resmi RFC 6238 di tests/security.test.js.
const ALFABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; // base32 (RFC 4648)
const PERIODE_DETIK = 30;
const DIGIT = 6;

function base32Encode(buf) {
  let bit = 0;
  let nilai = 0;
  let hasil = '';
  for (const byte of buf) {
    nilai = (nilai << 8) | byte;
    bit += 8;
    while (bit >= 5) {
      hasil += ALFABET[(nilai >>> (bit - 5)) & 31];
      bit -= 5;
    }
  }
  if (bit > 0) hasil += ALFABET[(nilai << (5 - bit)) & 31];
  return hasil;
}

function base32Decode(teks) {
  const bersih = String(teks).toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bit = 0;
  let nilai = 0;
  const hasil = [];
  for (const huruf of bersih) {
    const i = ALFABET.indexOf(huruf);
    if (i === -1) throw new Error('Rahasia base32 tidak valid');
    nilai = (nilai << 5) | i;
    bit += 5;
    if (bit >= 8) {
      hasil.push((nilai >>> (bit - 8)) & 255);
      bit -= 8;
    }
  }
  return Buffer.from(hasil);
}

// 20 byte acak = 160 bit, panjang yang dianjurkan RFC 4226 untuk HMAC-SHA1.
function buatRahasia() {
  return base32Encode(crypto.randomBytes(20));
}

function kodePada(rahasiaBuf, langkah) {
  const pesan = Buffer.alloc(8);
  pesan.writeBigUInt64BE(BigInt(langkah));
  const hmac = crypto.createHmac('sha1', rahasiaBuf).update(pesan).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const biner =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(biner % 10 ** DIGIT).padStart(DIGIT, '0');
}

function langkahPada(ms = Date.now()) {
  return Math.floor(ms / 1000 / PERIODE_DETIK);
}

// Langkah waktu yang cocok dengan kode, atau null. Jendela ±1 langkah
// (±30 detik) untuk jam HP yang sedikit meleset. Yang mencegah kode
// dipakai dua kali adalah pemanggilnya (users.totp_langkah_terakhir).
function cocokkan(rahasiaBase32, kode, ms = Date.now(), jendela = 1) {
  if (typeof kode !== 'string' || !/^\d{6}$/.test(kode)) return null;
  const rahasia = base32Decode(rahasiaBase32);
  const sekarang = langkahPada(ms);
  let cocok = null;
  // Semua langkah di jendela selalu dihitung (tidak berhenti di yang
  // pertama cocok), supaya lamanya tidak membocorkan langkah mana yang kena.
  for (let d = -jendela; d <= jendela; d++) {
    const calon = kodePada(rahasia, sekarang + d);
    if (crypto.timingSafeEqual(Buffer.from(calon), Buffer.from(kode)) && cocok === null) cocok = sekarang + d;
  }
  return cocok;
}

function otpauthUrl({ rahasia, akun, penerbit }) {
  const label = `${encodeURIComponent(penerbit)}:${encodeURIComponent(akun)}`;
  const q = new URLSearchParams({ secret: rahasia, issuer: penerbit, algorithm: 'SHA1', digits: String(DIGIT), period: String(PERIODE_DETIK) });
  return `otpauth://totp/${label}?${q.toString()}`;
}

module.exports = { buatRahasia, kodePada, langkahPada, cocokkan, otpauthUrl, base32Encode, base32Decode };
