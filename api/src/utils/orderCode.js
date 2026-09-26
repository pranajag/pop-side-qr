const crypto = require('crypto');
const { jakartaDateStamp } = require('./jakartaTime');

// No 0/O, 1/I/l — this code gets read out loud by the customer to the
// kasir (MEMORY.md), so visually/verbally ambiguous characters are out.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Penanda untuk pesanan yang tidak menempel ke meja mana pun — penjualan
// langsung di kasir / bawa pulang.
const PENANDA_TANPA_MEJA = 'TA';

// Batas aman kalau suatu hari nomor meja diisi teks panjang; kode order
// tetap pendek supaya masih enak dibacakan dan muat di struk.
const MAKS_PANJANG_MEJA = 4;

function randomSuffix(length) {
  // 256 % 32 === 0, so byte % ALPHABET.length has zero modulo bias.
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

// Dipisah dengan tanda hubung dan selalu diawali "M" supaya tidak pernah
// tertukar dengan blok acak di depannya — blok acak tidak pernah memuat
// angka 0/1 maupun huruf M di posisi ini. Nomor meja sendiri boleh
// mengandung 0/1 karena staff membacanya dari layar, bukan mengejanya.
function penandaMeja(nomorMeja) {
  if (nomorMeja === null || nomorMeja === undefined) return PENANDA_TANPA_MEJA;
  const bersih = String(nomorMeja).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return bersih ? `M${bersih.slice(0, MAKS_PANJANG_MEJA)}` : PENANDA_TANPA_MEJA;
}

// Bentuk: ORD-YYYYMMDD-XXXX-M1 (atau -TA untuk pesanan tanpa meja).
// Nomor meja sengaja ditempel di belakang supaya staff yang memegang tiket
// dapur, struk, atau daftar pesanan langsung tahu ini punya meja berapa
// tanpa harus membuka detail ordernya dulu.
function generateOrderCode(nomorMeja = null, date = new Date()) {
  return `ORD-${jakartaDateStamp(date)}-${randomSuffix(4)}-${penandaMeja(nomorMeja)}`;
}

module.exports = { generateOrderCode, penandaMeja, PENANDA_TANPA_MEJA };
