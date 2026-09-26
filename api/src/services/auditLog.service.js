const prisma = require('../lib/prisma');
const AppError = require('../utils/AppError');
const { jakartaDayBoundsUTC } = require('../utils/jakartaTime');

// Nama aksi yang terbaca manusia untuk setiap pola route yang dicatat
// middleware/auditLog.js. Pola yang tidak ada di sini tetap tampil apa
// adanya (METODE /path), jadi route baru tidak pernah "hilang" dari log.
const LABEL_AKSI = {
  'POST /api/auth/login': 'Login',
  'POST /api/auth/logout': 'Logout',
  'POST /api/auth/2fa/verifikasi': 'Login — kode 2FA',
  'POST /api/auth/2fa/aktifkan': 'Mengaktifkan 2FA',
  'POST /api/admin/categories': 'Tambah kategori',
  'PUT /api/admin/categories/:id': 'Ubah kategori',
  'DELETE /api/admin/categories/:id': 'Hapus kategori',
  'POST /api/admin/products': 'Tambah produk',
  'PUT /api/admin/products/:id': 'Ubah produk',
  'DELETE /api/admin/products/:id': 'Hapus produk',
  'POST /api/admin/tables': 'Tambah meja',
  'PUT /api/admin/tables/:id': 'Ubah meja',
  'DELETE /api/admin/tables/:id': 'Hapus meja',
  'POST /api/admin/tables/:id/reset-token': 'Reset QR meja',
  'PATCH /api/admin/tables/:id/bill-open': 'Buka/tutup bill meja',
  'POST /api/admin/tables/:id/clear-visit': 'Kosongkan bill meja',
  'PUT /api/admin/settings/qris': 'Ganti gambar QRIS',
  'PUT /api/admin/settings/toko': 'Ubah info toko & pajak',
  'PATCH /api/admin/settings/member': 'Nyalakan/matikan member',
  'PATCH /api/admin/settings/reservasi-dp': 'Ubah aturan DP reservasi',
  'PATCH /api/admin/settings/pin-verifikasi': 'Ubah batas PIN konfirmasi pembayaran',
  'POST /api/admin/orders/manual': 'Buat pesanan manual',
  'POST /api/admin/orders/:id/konfirmasi': 'Konfirmasi pembayaran',
  'PATCH /api/admin/orders/:id/status': 'Ubah status / void pesanan',
  'GET /api/admin/orders/:id/bukti-bayar': 'Lihat bukti bayar',
  'GET /api/admin/reports/export.xlsx': 'Unduh laporan (Excel)',
  'GET /api/admin/reports/jurnal.xlsx': 'Unduh jurnal (Excel)',
  'POST /api/admin/shifts/start': 'Mulai shift',
  'POST /api/admin/shifts/end': 'Akhiri shift',
  'GET /api/admin/shifts/:id/report.xlsx': 'Unduh laporan shift (Excel)',
  'GET /api/admin/shifts/:id/report.pdf': 'Unduh laporan shift (PDF)',
  'POST /api/admin/users': 'Tambah akun staff',
  'PUT /api/admin/users/:id': 'Ubah akun staff',
  'DELETE /api/admin/users/:id': 'Hapus akun staff',
  'POST /api/admin/users/:id/reset-2fa': 'Reset 2FA akun staff',
  'PATCH /api/admin/staff-calls/:id/resolve': 'Tangani panggilan meja',
  'POST /api/admin/reservations': 'Buat reservasi',
  'PUT /api/admin/reservations/:id': 'Ubah reservasi',
  'PATCH /api/admin/reservations/:id/status': 'Ubah status reservasi',
  'POST /api/admin/reservations/:id/pembayaran-dp': 'Catat pembayaran DP',
  'DELETE /api/admin/reservations/:id': 'Hapus reservasi',
  'POST /api/admin/loyalty-tiers': 'Tambah tier member',
  'PUT /api/admin/loyalty-tiers/:id': 'Ubah tier member',
  'DELETE /api/admin/loyalty-tiers/:id': 'Hapus tier member',
  'POST /api/admin/api-keys': 'Buat API key',
  'POST /api/admin/api-keys/:id/revoke': 'Cabut API key',
  'POST /api/admin/webhooks': 'Tambah webhook',
  'PUT /api/admin/webhooks/:id': 'Ubah webhook',
  'DELETE /api/admin/webhooks/:id': 'Hapus webhook',
};

const PER_HALAMAN = 50;

function toShaped(baris) {
  let detail = null;
  try {
    detail = baris.detail ? JSON.parse(baris.detail) : null;
  } catch {
    detail = baris.detail; // terpotong di batas panjang — tampilkan apa adanya
  }
  return {
    id: baris.id,
    waktu: baris.createdAt,
    username: baris.username,
    role: baris.role,
    aksi: baris.aksi,
    label: LABEL_AKSI[baris.aksi] ?? baris.aksi,
    status: baris.status,
    berhasil: baris.status < 400,
    detail,
    ip: baris.ip,
  };
}

async function list({ dari, sampai, userId, hasil, halaman = 1 }) {
  const where = {};
  if (dari || sampai) {
    const awal = dari ? jakartaDayBoundsUTC(dari) : null;
    const akhir = sampai ? jakartaDayBoundsUTC(sampai) : null;
    if ((dari && !awal) || (sampai && !akhir)) throw new AppError(400, 'Format tanggal harus YYYY-MM-DD');
    where.createdAt = { ...(awal ? { gte: awal.start } : {}), ...(akhir ? { lt: akhir.end } : {}) };
  }
  if (userId) where.userId = userId;
  if (hasil === 'berhasil') where.status = { lt: 400 };
  if (hasil === 'ditolak') where.status = { gte: 400 };

  const [total, baris] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      skip: (halaman - 1) * PER_HALAMAN,
      take: PER_HALAMAN,
    }),
  ]);
  return { items: baris.map(toShaped), total, halaman, perHalaman: PER_HALAMAN };
}

module.exports = { list, LABEL_AKSI };
