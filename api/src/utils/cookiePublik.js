const crypto = require('node:crypto');
const { sidik } = require('./kripto');

// Cookie web publik (customer, tanpa login):
//   perangkat — id acak perangkat pemesan. Order menyimpan SIDIK-nya
//               (orders.device_hash); melacak status & mengirim bukti bayar
//               hanya bisa dari perangkat yang sama. Inilah "token pelacakan
//               tersembunyi": kode order saja tidak cukup untuk melacak.
//   member    — tanda "nomor HP ini sudah diverifikasi OTP" (memberOtp.service.js).
//
// httpOnly: tidak bisa dibaca JavaScript, jadi XSS sekalipun tidak bisa
// mencurinya. sameSite=strict: tidak ikut terkirim dari situs lain (CSRF).
// Di produksi berawalan __Host- (wajib HTTPS, tanpa Domain, Path=/).
//
// SYARAT DEPLOY: web publik dan API harus satu "site" (domain induk yang
// sama, mis. popside.id + api.popside.id, atau API di-proxy di /api).
// Kalau domainnya berbeda sama sekali, browser menganggapnya cookie pihak
// ketiga dan memblokirnya — pelacakan order dan OTP akan gagal.
const isProd = process.env.NODE_ENV === 'production';
const NAMA_PERANGKAT = isProd ? '__Host-popside_perangkat' : 'popside_perangkat';
const NAMA_MEMBER = isProd ? '__Host-popside_member' : 'popside_member';
const DASAR = { httpOnly: true, secure: isProd, sameSite: 'strict', path: '/' };
// Bergeser: diperbarui setiap kali order dibuat, jadi order hari ini tetap
// bisa dilacak sampai 24 jam setelah order terakhir.
const UMUR_PERANGKAT_MS = 24 * 60 * 60 * 1000;
const POLA_ID = /^[A-Za-z0-9_-]{43}$/; // 32 byte base64url

function idPerangkat(req) {
  const id = req.cookies?.[NAMA_PERANGKAT];
  return typeof id === 'string' && POLA_ID.test(id) ? id : null;
}

// Sidik perangkat pengirim request, atau null kalau tidak ada cookie yang sah.
function sidikPerangkat(req) {
  const id = idPerangkat(req);
  return id ? sidik('perangkat', id) : null;
}

// Untuk membuat order: pakai cookie yang ada, atau terbitkan yang baru.
function pastikanPerangkat(req, res) {
  const id = idPerangkat(req) ?? crypto.randomBytes(32).toString('base64url');
  res.cookie(NAMA_PERANGKAT, id, { ...DASAR, maxAge: UMUR_PERANGKAT_MS });
  return sidik('perangkat', id);
}

function tokenMember(req) {
  const t = req.cookies?.[NAMA_MEMBER];
  return typeof t === 'string' ? t : null;
}

function setTokenMember(res, token, maxAge) {
  res.cookie(NAMA_MEMBER, token, { ...DASAR, maxAge });
}

module.exports = { sidikPerangkat, pastikanPerangkat, tokenMember, setTokenMember, NAMA_PERANGKAT, NAMA_MEMBER };
