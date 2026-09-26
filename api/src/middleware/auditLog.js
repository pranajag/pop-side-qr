const prisma = require('../lib/prisma');
const logger = require('../utils/logger');
const { samarkanNomor } = require('../utils/logger');

// Log audit: setiap request staff yang MENGUBAH data (POST/PUT/PATCH/DELETE
// di /api/admin dan /api/auth), plus beberapa GET yang mengeluarkan data
// dalam jumlah besar (ekspor laporan, bukti bayar). Dicatat ke tabel
// audit_log yang append-only (trigger database menolak UPDATE/DELETE).
//
// Satu middleware untuk semua route, bukan pencatatan manual di tiap
// controller: route baru otomatis ikut tercatat, tidak ada yang bisa
// "lupa dicatat".
//
// Ditulis SESUDAH respons terkirim (res 'finish'), jadi tidak menambah
// waktu tunggu staff sedikit pun. Hasil akhirnya ikut dicatat (kode
// status), termasuk yang ditolak — PIN salah, CSRF gagal, bentrok.
//
// Hanya request dari staff yang login (atau yang sedang di tengah login
// 2FA, lewat req.auditUser) — permintaan anonim tidak pernah menulis ke
// tabel ini, jadi orang luar tidak bisa membanjirinya.
const METODE_TULIS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const GET_SENSITIF = [/\/export\.xlsx$/, /\/jurnal\.xlsx$/, /\/report\.(xlsx|pdf)$/, /\/bukti-bayar$/];
const KUNCI_RAHASIA = /pass|pin|kode|secret|rahasia|token|otp|csrf/i;
const BATAS_DETAIL = 4000;

// Isi request tanpa rahasia: kunci yang namanya mirip password/PIN/kode
// diganti, teks panjang dipotong, nomor HP disamarkan (0812******88).
function bersihkan(nilai, kedalaman = 0) {
  if (kedalaman > 4) return '[…]';
  if (Array.isArray(nilai)) return nilai.slice(0, 50).map((v) => bersihkan(v, kedalaman + 1));
  if (nilai instanceof Date) return nilai.toISOString();
  if (nilai && typeof nilai === 'object') {
    return Object.fromEntries(
      Object.entries(nilai).map(([k, v]) => [k, KUNCI_RAHASIA.test(k) ? '[disamarkan]' : bersihkan(v, kedalaman + 1)])
    );
  }
  if (typeof nilai === 'string') return samarkanNomor(nilai.length > 300 ? `${nilai.slice(0, 300)}…` : nilai);
  return nilai;
}

function perluDicatat(req) {
  if (METODE_TULIS.has(req.method)) return true;
  return req.method === 'GET' && GET_SENSITIF.some((pola) => pola.test(req.path));
}

function auditLog(req, res, next) {
  if (!perluDicatat(req)) return next();
  // Diambil di awal juga: logout menghapus sesinya sebelum respons selesai.
  const userAwal = req.session?.user ?? null;
  res.on('finish', () => {
    const user = req.session?.user ?? userAwal ?? req.auditUser ?? null;
    if (!user) return;
    const pola = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.originalUrl.split('?')[0];
    const detail = {
      params: Object.keys(req.params ?? {}).length ? req.params : undefined,
      query: req.method === 'GET' && Object.keys(req.query ?? {}).length ? bersihkan(req.query) : undefined,
      body: req.body && Object.keys(req.body).length ? bersihkan(req.body) : undefined,
      file: req.file ? { jenis: req.file.mimetype, ukuran: req.file.size } : undefined,
    };
    let teks = JSON.stringify(detail);
    if (teks.length > BATAS_DETAIL) teks = `${teks.slice(0, BATAS_DETAIL)}…`;
    prisma.auditLog
      .create({
        data: {
          userId: user.id ?? null,
          username: user.username ?? null,
          role: user.role ?? null,
          aksi: `${req.method} ${pola}`.slice(0, 120),
          status: res.statusCode,
          detail: teks === '{}' ? null : teks,
          ip: req.ip ?? null,
        },
      })
      .catch((err) => logger.error({ err, aksi: `${req.method} ${pola}` }, 'gagal menulis log audit'));
  });
  next();
}

module.exports = { auditLog, bersihkan };
