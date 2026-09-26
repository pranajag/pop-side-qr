require('dotenv').config({ quiet: true });

// Mengenkripsi nomor HP polos yang sudah ada di database (customers,
// reservations) ke kolom telepon_enc (+ telepon_hash/telepon_akhir untuk
// member). Langkah ke-2 dari 3 — lihat keterangan di migrasi
// 20260926090000_keamanan_tahap2_tambah. `npm run db:enkripsi-telepon`.
//
// Aman dijalankan berulang: hanya baris yang belum terenkripsi yang diisi,
// dan setiap hasil langsung dicek ulang (didekripsi lagi dan dibandingkan)
// sebelum dianggap berhasil. Kolom polosnya TIDAK dihapus di sini — itu
// tugas migrasi ke-3, setelah skrip ini selesai tanpa error.
//
// Memakai SQL berparameter (tagged template Prisma, bukan menyambung
// string) langsung ke kolom `telepon` lama, karena kolom itu sengaja tidak
// ada lagi di skema Prisma setelah migrasi ke-3.
const { PrismaClient } = require('@prisma/client');
const { periksaKunci, kolomTelepon, dekripsi, sidikTelepon } = require('../src/utils/kripto');

const prisma = new PrismaClient();

async function kolomPolosMasihAda() {
  const baris = await prisma.$queryRaw`
    SELECT COUNT(*) AS n FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'telepon'`;
  return Number(baris[0].n) > 0;
}

async function main() {
  periksaKunci();
  if (!(await kolomPolosMasihAda())) {
    console.log('Kolom nomor HP polos sudah tidak ada — database ini sudah selesai dimigrasi.');
    return;
  }

  const member = await prisma.$queryRaw`SELECT id, telepon FROM customers WHERE telepon IS NOT NULL AND telepon_enc IS NULL`;
  for (const { id, telepon } of member) {
    const kolom = kolomTelepon(telepon);
    if (dekripsi(kolom.teleponEnc) !== telepon || kolom.teleponHash !== sidikTelepon(telepon)) {
      throw new Error(`Member #${id}: hasil enkripsi tidak cocok saat dicek ulang — dihentikan.`);
    }
    await prisma.$executeRaw`
      UPDATE customers SET telepon_enc = ${kolom.teleponEnc}, telepon_hash = ${kolom.teleponHash}, telepon_akhir = ${kolom.teleponAkhir}
      WHERE id = ${id} AND telepon_enc IS NULL`;
  }

  const reservasi = await prisma.$queryRaw`SELECT id, telepon FROM reservations WHERE telepon IS NOT NULL AND telepon_enc IS NULL`;
  for (const { id, telepon } of reservasi) {
    const enc = kolomTelepon(telepon).teleponEnc;
    if (dekripsi(enc) !== telepon) {
      throw new Error(`Reservasi #${id}: hasil enkripsi tidak cocok saat dicek ulang — dihentikan.`);
    }
    await prisma.$executeRaw`UPDATE reservations SET telepon_enc = ${enc} WHERE id = ${id} AND telepon_enc IS NULL`;
  }

  // Pemeriksaan akhir atas SEMUA baris, bukan hanya yang baru diisi.
  const semuaMember = await prisma.$queryRaw`SELECT id, telepon, telepon_enc, telepon_hash FROM customers WHERE telepon IS NOT NULL`;
  const semuaReservasi = await prisma.$queryRaw`SELECT id, telepon, telepon_enc FROM reservations WHERE telepon IS NOT NULL`;
  const rusak = [
    ...semuaMember.filter((m) => dekripsi(m.telepon_enc) !== m.telepon || m.telepon_hash !== sidikTelepon(m.telepon)),
    ...semuaReservasi.filter((r) => dekripsi(r.telepon_enc) !== r.telepon),
  ];
  if (rusak.length) {
    throw new Error(`${rusak.length} baris tidak cocok setelah enkripsi — JANGAN jalankan migrasi penghapusan kolom polos.`);
  }
  console.log(
    `Selesai: ${member.length} member dan ${reservasi.length} reservasi baru dienkripsi; ` +
      `${semuaMember.length} member dan ${semuaReservasi.length} reservasi terverifikasi cocok. ` +
      'Aman lanjut ke migrasi penghapusan kolom nomor polos.'
  );
}

main()
  .catch((err) => {
    console.error(`\nGagal: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
