-- Keamanan tahap 2 — TAMBAH saja (tidak ada data yang hilang):
--   * customers/reservations: kolom nomor HP terenkripsi (telepon_enc) +
--     sidik pencarian member (telepon_hash, telepon_akhir).
--   * orders.device_hash: pelacakan order terikat ke perangkat pemesan.
--   * store_settings.pin_verifikasi_minimal: PIN saat konfirmasi pembayaran.
--   * users.totp_*: 2FA admin; kode_pemulihan_2fa: kode cadangannya.
--   * audit_log: jejak aksi staff; member_otp: kode OTP member.
--
-- URUTAN WAJIB untuk database yang sudah berisi data:
--   1. migrasi ini
--   2. npm run db:enkripsi-telepon   (mengisi kolom terenkripsi dari nomor polos)
--   3. migrasi 20260926091000_keamanan_tahap2_hapus_telepon_polos
-- Migrasi ke-3 sengaja gagal (sebelum menghapus apa pun) kalau langkah 2
-- belum dijalankan — lihat keterangan di file itu.

-- AlterTable
ALTER TABLE `customers` ADD COLUMN `telepon_akhir` VARCHAR(4) NULL,
    ADD COLUMN `telepon_enc` VARCHAR(255) NULL,
    ADD COLUMN `telepon_hash` CHAR(64) NULL,
    MODIFY `telepon` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `orders` ADD COLUMN `device_hash` CHAR(64) NULL;

-- AlterTable
ALTER TABLE `reservations` ADD COLUMN `alasan_dp` VARCHAR(200) NULL,
    ADD COLUMN `telepon_enc` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `store_settings` ADD COLUMN `pin_verifikasi_minimal` INTEGER NULL DEFAULT 200000;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `totp_aktif_sejak` DATETIME(3) NULL,
    ADD COLUMN `totp_langkah_terakhir` BIGINT NULL,
    ADD COLUMN `totp_secret_enc` VARCHAR(255) NULL;

-- CreateTable
CREATE TABLE `kode_pemulihan_2fa` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `kode_hash` CHAR(64) NOT NULL,
    `dipakai_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `kode_pemulihan_2fa_user_id_kode_hash_key`(`user_id`, `kode_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_log` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `user_id` INTEGER NULL,
    `username` VARCHAR(50) NULL,
    `role` VARCHAR(10) NULL,
    `aksi` VARCHAR(120) NOT NULL,
    `status` INTEGER NOT NULL,
    `detail` TEXT NULL,
    `ip` VARCHAR(45) NULL,

    INDEX `audit_log_created_at_idx`(`created_at`),
    INDEX `audit_log_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `member_otp` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `telepon_hash` CHAR(64) NOT NULL,
    `kode_hash` CHAR(64) NOT NULL,
    `percobaan` INTEGER NOT NULL DEFAULT 0,
    `expires_at` DATETIME(3) NOT NULL,
    `dipakai_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `member_otp_telepon_hash_created_at_idx`(`telepon_hash`, `created_at`),
    INDEX `member_otp_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `customers_telepon_hash_key` ON `customers`(`telepon_hash`);

-- AddForeignKey
ALTER TABLE `kode_pemulihan_2fa` ADD CONSTRAINT `kode_pemulihan_2fa_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

