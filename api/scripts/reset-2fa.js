require('dotenv').config({ quiet: true });

// Jalan terakhir kalau admin kehilangan HP authenticator DAN kode
// cadangannya, sehingga tidak bisa login sama sekali (dan tidak ada admin
// lain yang bisa me-reset 2FA-nya dari halaman Akun Staff):
//
//   npm run reset-2fa -- <username>
//
// Hanya bisa dijalankan oleh orang yang punya akses ke server dan api/.env —
// itulah yang menggantikan kode 2FA sebagai bukti. Mencabut 2FA akun itu,
// menghapus kode cadangannya, dan menghapus semua sesi login-nya. Login
// berikutnya meminta memasang 2FA lagi.
const prisma = require('../src/lib/prisma');
const twoFactor = require('../src/services/twoFactor.service');
const { hapusSemuaSesi } = require('../src/services/user.service');

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error('Pakai: npm run reset-2fa -- <username>');
    process.exitCode = 1;
    return;
  }
  const user = await prisma.user.findUnique({ where: { username }, select: { id: true, role: true, totpAktifSejak: true } });
  if (!user) {
    console.error(`Akun "${username}" tidak ditemukan.`);
    process.exitCode = 1;
    return;
  }
  await twoFactor.reset(user.id);
  await hapusSemuaSesi(user.id);
  console.log(
    `2FA akun "${username}" (${user.role}) dicabut${user.totpAktifSejak ? '' : ' (sebelumnya memang belum aktif)'}; semua sesinya dihapus.\n` +
      (user.role === 'admin' ? 'Login berikutnya akan meminta memasang 2FA lagi (scan QR).' : '')
  );
}

main()
  .catch((err) => {
    console.error(`Gagal: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
