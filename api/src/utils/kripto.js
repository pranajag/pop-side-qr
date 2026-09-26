const crypto = require('node:crypto');

// Dua kunci terpisah dari .env, masing-masing 32 byte (base64):
//   DATA_ENC_KEY  — enkripsi AES-256-GCM untuk data yang harus bisa dibaca
//                   lagi (nomor HP, rahasia 2FA).
//   DATA_HASH_KEY — HMAC-SHA256 untuk "sidik": nilai yang bisa dicari persis
//                   tanpa menyimpan nilai aslinya (nomor HP member, cookie
//                   perangkat, kode OTP, kode pemulihan 2FA).
// Dipisah supaya bocornya satu kunci tidak membuka yang lain. Kunci HILANG =
// data terenkripsi tidak bisa dibaca lagi selamanya: simpan salinannya di
// tempat aman, terpisah dari backup database.
const NAMA_KUNCI = ['DATA_ENC_KEY', 'DATA_HASH_KEY'];
const CARA_MEMBUAT = `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`;

function ambilKunci(nama) {
  const nilai = process.env[nama];
  const kunci = nilai ? Buffer.from(nilai, 'base64') : null;
  if (!kunci || kunci.length !== 32) {
    throw new Error(`${nama} belum diisi atau bukan 32 byte (base64). Buat dengan: ${CARA_MEMBUAT}`);
  }
  return kunci;
}

// Dipanggil sekali saat API start (app.js): kunci yang kosong/salah harus
// membuat server gagal start dengan pesan jelas, bukan gagal diam-diam di
// tengah transaksi pertama yang menyimpan nomor HP.
function periksaKunci() {
  for (const nama of NAMA_KUNCI) ambilKunci(nama);
  if (process.env.DATA_ENC_KEY === process.env.DATA_HASH_KEY) {
    throw new Error('DATA_ENC_KEY dan DATA_HASH_KEY harus berbeda.');
  }
}

// Format: "v1." + base64url(iv 12 byte | tag 16 byte | ciphertext). Awalan
// versi menyisakan jalan untuk rotasi kunci kelak tanpa menebak format.
const VERSI = 'v1';

function enkripsi(teks) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ambilKunci('DATA_ENC_KEY'), iv);
  const isi = Buffer.concat([cipher.update(String(teks), 'utf8'), cipher.final()]);
  return `${VERSI}.${Buffer.concat([iv, cipher.getAuthTag(), isi]).toString('base64url')}`;
}

// Tag GCM memastikan data tidak diubah: ciphertext yang diutak-atik (atau
// dienkripsi dengan kunci lain) melempar error, tidak menghasilkan teks
// sampah.
function dekripsi(nilai) {
  if (nilai === null || nilai === undefined) return null;
  const [versi, data] = String(nilai).split('.');
  if (versi !== VERSI || !data) {
    throw new Error('Format data terenkripsi tidak dikenal');
  }
  const buf = Buffer.from(data, 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ambilKunci('DATA_ENC_KEY'), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

// `ranah` memisahkan kegunaan: sidik nomor HP tidak pernah sama dengan sidik
// cookie perangkat walau isinya kebetulan sama.
function sidik(ranah, nilai) {
  return crypto.createHmac('sha256', ambilKunci('DATA_HASH_KEY')).update(`${ranah}:${nilai}`).digest('hex');
}

function samaAman(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Token kecil bertanda tangan untuk cookie: base64url(JSON) + "." + HMAC.
// Isinya bisa dibaca siapa pun yang memegang token (jangan taruh rahasia),
// tapi tidak bisa diubah atau dipalsukan tanpa DATA_HASH_KEY.
function tandaTangan(ranah, objek) {
  const isi = Buffer.from(JSON.stringify(objek)).toString('base64url');
  return `${isi}.${sidik(`token:${ranah}`, isi)}`;
}

function bacaTandaTangan(ranah, token) {
  if (typeof token !== 'string' || token.length > 1024) return null;
  const [isi, tanda] = token.split('.');
  if (!isi || !tanda || !samaAman(tanda, sidik(`token:${ranah}`, isi))) return null;
  try {
    return JSON.parse(Buffer.from(isi, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// Nomor HP member: selalu dalam bentuk baku (validators/common.js
// normalisasiTelepon) sebelum masuk sini, supaya "0812 …" dan "+62812…"
// menghasilkan sidik yang sama.
function sidikTelepon(telepon) {
  return sidik('telepon', telepon);
}

function kolomTelepon(telepon) {
  return { teleponEnc: enkripsi(telepon), teleponHash: sidikTelepon(telepon), teleponAkhir: telepon.slice(-4) };
}

module.exports = {
  periksaKunci,
  enkripsi,
  dekripsi,
  sidik,
  samaAman,
  tandaTangan,
  bacaTandaTangan,
  sidikTelepon,
  kolomTelepon,
  CARA_MEMBUAT,
};
