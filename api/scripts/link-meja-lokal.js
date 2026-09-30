require('dotenv').config({ quiet: true });

// Link menu customer untuk setiap meja aktif di database LOKAL — isi yang
// sama dengan QR yang ditempel di meja. Dipakai jalankan-lokal.bat supaya
// web menu bisa langsung dibuka di laptop tanpa memindai QR:
//
//   npm run link-meja              -> daftar semua meja aktif
//   node scripts/link-meja-lokal.js --pertama   -> link meja pertama saja
//
// Hanya untuk laptop pengembangan; di produksi, link QR diambil dari
// dashboard (Meja -> QR).
const prisma = require('../src/lib/prisma');

const PUBLIC_WEB_URL = process.env.PUBLIC_WEB_URL || 'http://localhost:5174';

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Skrip ini hanya untuk database lokal. Link QR produksi ada di dashboard: Meja -> QR.');
    process.exitCode = 1;
    return;
  }
  const meja = await prisma.table.findMany({
    where: { isActive: true },
    orderBy: { id: 'asc' },
    select: { nomorMeja: true, qrToken: true },
  });
  if (meja.length === 0) {
    console.error('Belum ada meja aktif. Tambahkan meja di dashboard: Meja -> Tambah Meja.');
    process.exitCode = 1;
    return;
  }
  const link = (m) => `${PUBLIC_WEB_URL}/t/${m.qrToken}`;
  if (process.argv.includes('--pertama')) {
    console.log(link(meja[0]));
    return;
  }
  for (const m of meja) console.log(`   Meja ${m.nomorMeja}: ${link(m)}`);
}

main()
  .catch((err) => {
    console.error(`Gagal membaca meja: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
