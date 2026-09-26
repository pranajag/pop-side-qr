const logger = require('./logger');
const { samarkanNomor } = require('./logger');

// Pengirim kode OTP member ke WhatsApp/SMS customer. Dipilih lewat .env:
//
//   OTP_PENGIRIM=console  (bawaan di pengembangan) — kode hanya ditulis ke
//                         log API. DIMATIKAN otomatis kalau NODE_ENV=production:
//                         di produksi kode tidak boleh berakhir di log.
//   OTP_PENGIRIM=http     — kirim lewat gateway WhatsApp/SMS mana pun yang
//                         punya API HTTP (Fonnte, Wablas, SMS gateway Android,
//                         dll). Diatur dengan:
//     OTP_HTTP_URL           alamat API kirim pesan gateway (https://…)
//     OTP_HTTP_HEADER        nama header autentikasi (bawaan: Authorization)
//     OTP_HTTP_TOKEN         token/API key dari gateway
//     OTP_HTTP_FORMAT        json | form (bawaan: form)
//     OTP_HTTP_FIELD_NOMOR   nama field nomor tujuan (bawaan: target)
//     OTP_HTTP_FIELD_PESAN   nama field isi pesan (bawaan: message)
//     OTP_NOMOR_AWALAN       62 | 0 — format nomor tujuan (bawaan: 62)
//
// Tanpa pengirim yang sah (mis. produksi tanpa gateway), fitur OTP mati:
// checkout publik tidak menawarkan verifikasi, dan diskon member hanya bisa
// diberikan staff lewat Pesanan Manual.
const BATAS_WAKTU_MS = 5000;

function jenisPengirim() {
  const jenis = (process.env.OTP_PENGIRIM || 'console').trim().toLowerCase();
  if (jenis === 'console') return process.env.NODE_ENV === 'production' ? null : 'console';
  if (jenis === 'http') return process.env.OTP_HTTP_URL && process.env.OTP_HTTP_TOKEN ? 'http' : null;
  return null;
}

function otpTersedia() {
  return jenisPengirim() !== null;
}

function formatNomor(telepon) {
  const awalan = (process.env.OTP_NOMOR_AWALAN || '62').trim();
  return awalan === '62' && telepon.startsWith('0') ? `62${telepon.slice(1)}` : telepon;
}

function pesanOtp(kode, namaToko) {
  return (
    `Kode verifikasi member ${namaToko || 'Popside'}: ${kode}\n` +
    'Berlaku 5 menit. Jangan berikan kode ini ke siapa pun, termasuk staff kafe.'
  );
}

async function kirimLewatHttp(telepon, pesan) {
  const url = new URL(process.env.OTP_HTTP_URL);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !/^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(url.hostname)) {
    // Token gateway tidak boleh lewat HTTP polos di internet. HTTP hanya
    // untuk gateway di jaringan lokal (mis. HP Android dengan aplikasi SMS
    // gateway di WiFi kafe).
    throw new Error('OTP_HTTP_URL harus https:// (http hanya untuk gateway di jaringan lokal)');
  }
  const fieldNomor = process.env.OTP_HTTP_FIELD_NOMOR || 'target';
  const fieldPesan = process.env.OTP_HTTP_FIELD_PESAN || 'message';
  const isi = { [fieldNomor]: formatNomor(telepon), [fieldPesan]: pesan };
  const json = (process.env.OTP_HTTP_FORMAT || 'form').trim().toLowerCase() === 'json';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      [process.env.OTP_HTTP_HEADER || 'Authorization']: process.env.OTP_HTTP_TOKEN,
      'Content-Type': json ? 'application/json' : 'application/x-www-form-urlencoded',
    },
    body: json ? JSON.stringify(isi) : new URLSearchParams(isi).toString(),
    signal: AbortSignal.timeout(BATAS_WAKTU_MS),
    redirect: 'error',
  });
  if (!res.ok) {
    throw new Error(`gateway OTP menjawab ${res.status}`);
  }
}

// Bisa diganti tes (aturPengirimUji) supaya kodenya bisa ditangkap tanpa
// gateway sungguhan.
let pengirimUji = null;
function aturPengirimUji(fn) {
  pengirimUji = fn;
}

async function kirimOtp(telepon, kode, namaToko) {
  if (pengirimUji) return pengirimUji(telepon, kode);
  const jenis = jenisPengirim();
  if (!jenis) throw new Error('Pengirim OTP belum diatur (OTP_PENGIRIM)');
  const pesan = pesanOtp(kode, namaToko);
  if (jenis === 'console') {
    logger.warn({ nomor: samarkanNomor(telepon) }, `[MODE PENGEMBANGAN] Kode OTP member: ${kode}`);
    return;
  }
  await kirimLewatHttp(telepon, pesan);
}

module.exports = { kirimOtp, otpTersedia, aturPengirimUji, pesanOtp, formatNomor };
