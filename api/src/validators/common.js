const { z } = require('zod');

// Multipart/form-data always sends field values as strings, and zod's
// z.coerce.boolean() uses JS `Boolean(str)` — which makes the STRING
// "false" coerce to `true`. This accepts a real boolean (JSON body) or the
// literal string "true"/"false" (form body) only, and rejects anything else.
const zBooleanish = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((val) => (typeof val === 'boolean' ? val : val === 'true'));

const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(50)
  .regex(/^[a-zA-Z0-9_.-]+$/);

// 72 = bcrypt's silent input-truncation boundary, so validation never
// accepts a password whose tail bcrypt would just discard.
const passwordSchema = z.string().min(8).max(72);

// Numeric only, 4-6 digits — short enough to type quickly under pressure
// (voiding a paid order mid-rush), never meant to carry password-grade
// entropy on its own; pinAttempts.js's lockout is what actually protects it.
const pinSchema = z.string().regex(/^\d{4,6}$/, 'PIN harus 4-6 digit angka');

// Nomor HP member adalah KUNCI akun loyalitas — nomor yang sama harus selalu
// jadi string yang sama, apa pun cara customer mengetiknya. Tanpa ini,
// "0812 3456 789", "0812-3456-789", dan "+62812…" tercatat sebagai tiga
// member berbeda: poinnya terpecah, dan diskon di pesanan berikutnya tidak
// pernah muncul karena nomornya "tidak dikenal".
//
// Bentuk bakunya lokal 08xxxxxxxxxx. Spasi, strip, titik, dan kurung
// dibuang; awalan +62/62 diganti 0; awalan 8 tanpa 0 (kebiasaan umum)
// ditambah 0. Hasilnya wajib digit semua, diawali 0, 9-14 digit. Huruf,
// emoji, atau teks sembarang ditolak di sini, jadi tidak pernah ada
// "member" bernama `<script>` di database.
//
// public-web/src/lib/phone.js mencerminkan aturan yang sama supaya
// customer melihat kesalahannya langsung di bawah kolom, tapi yang ini
// yang menentukan.
function normalisasiTelepon(nilai) {
  if (typeof nilai !== 'string') return nilai;
  let t = nilai.trim().replace(/[\s\-.()]/g, '');
  if (t.startsWith('+62')) t = `0${t.slice(3)}`;
  else if (t.startsWith('62')) t = `0${t.slice(2)}`;
  else if (/^8\d/.test(t)) t = `0${t}`;
  // "+62 0812…" (awalan negara DAN angka 0) jadi "00812…" — satu nol saja.
  return t.replace(/^0+/, '0');
}

const POLA_TELEPON = /^0\d{8,13}$/;

// Opsional: kosong, null, atau cuma spasi berarti "tidak ikut member" —
// bukan error. Yang diisi tapi bukan nomor yang masuk akal, itu yang ditolak.
const memberPhoneSchema = z.preprocess(
  (nilai) => {
    if (nilai === undefined || nilai === null) return undefined;
    const t = normalisasiTelepon(nilai);
    return t === '' ? undefined : t;
  },
  z
    .string()
    .regex(POLA_TELEPON, 'Nomor HP tidak valid — gunakan angka saja, contoh 08123456789')
    .optional()
);

module.exports = {
  zBooleanish,
  usernameSchema,
  passwordSchema,
  pinSchema,
  memberPhoneSchema,
  normalisasiTelepon,
  POLA_TELEPON,
};
