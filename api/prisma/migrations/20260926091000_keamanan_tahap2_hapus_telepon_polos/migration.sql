-- Keamanan tahap 2 — langkah ke-3: hapus kolom nomor HP POLOS. Setelah ini
-- nomor HP hanya ada dalam bentuk terenkripsi (telepon_enc) + sidik
-- pencarian (telepon_hash, telepon_akhir).
--
-- WAJIB sudah menjalankan `npm run db:enkripsi-telepon` sebelumnya (lihat
-- 20260926090000_keamanan_tahap2_tambah).
--
-- PENJAGA: dua CHECK constraint di bawah memvalidasi SEMUA baris yang ada.
-- Kalau masih ada satu nomor saja yang belum dienkripsi, penambahan
-- constraint gagal dan migrasi berhenti di sini — sebelum ada kolom yang
-- dihapus, jadi nomor polosnya tidak hilang. Jalankan skrip enkripsinya,
-- lalu `npx prisma migrate resolve --rolled-back 20260926091000_keamanan_tahap2_hapus_telepon_polos`
-- dan deploy ulang.

ALTER TABLE `customers` ADD CONSTRAINT `cek_customers_telepon_terenkripsi`
  CHECK (`telepon` IS NULL OR (`telepon_enc` IS NOT NULL AND `telepon_hash` IS NOT NULL AND `telepon_akhir` IS NOT NULL));

ALTER TABLE `reservations` ADD CONSTRAINT `cek_reservations_telepon_terenkripsi`
  CHECK (`telepon` IS NULL OR `telepon_enc` IS NOT NULL);

-- Lolos penjaga: aman menghapus kolom polos.
ALTER TABLE `customers` DROP CHECK `cek_customers_telepon_terenkripsi`;
ALTER TABLE `reservations` DROP CHECK `cek_reservations_telepon_terenkripsi`;

DROP INDEX `customers_telepon_key` ON `customers`;

ALTER TABLE `customers` DROP COLUMN `telepon`,
    MODIFY `telepon_akhir` VARCHAR(4) NOT NULL,
    MODIFY `telepon_enc` VARCHAR(255) NOT NULL,
    MODIFY `telepon_hash` CHAR(64) NOT NULL;

ALTER TABLE `reservations` DROP COLUMN `telepon`;
