-- AlterTable
ALTER TABLE `store_settings` ADD COLUMN `reservasi_dp_nominal` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    ADD COLUMN `reservasi_dp_per_tamu` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `reservation_deposit_payments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `reservation_id` INTEGER NOT NULL,
    `amount` DECIMAL(65, 30) NOT NULL,
    `metode` ENUM('qris', 'tunai', 'debit') NOT NULL,
    `paid_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `recorded_by` INTEGER NULL,

    INDEX `reservation_deposit_payments_reservation_id_idx`(`reservation_id`),
    INDEX `reservation_deposit_payments_paid_at_idx`(`paid_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `reservation_deposit_payments` ADD CONSTRAINT `reservation_deposit_payments_reservation_id_fkey` FOREIGN KEY (`reservation_id`) REFERENCES `reservations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reservation_deposit_payments` ADD CONSTRAINT `reservation_deposit_payments_recorded_by_fkey` FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: DP yang dulu ditandai lunas sekaligus (satu tombol "lunas")
-- dijadikan satu baris pembayaran, supaya rekap shift lama yang sudah
-- menghitungnya lewat deposit_paid_at tetap menghasilkan angka yang sama
-- setelah perhitungan pindah ke tabel pembayaran.
INSERT INTO `reservation_deposit_payments` (`reservation_id`, `amount`, `metode`, `paid_at`)
SELECT `id`, `deposit_amount`, COALESCE(`deposit_metode`, 'tunai'), COALESCE(`deposit_paid_at`, `updated_at`)
FROM `reservations`
WHERE `deposit_paid` = true AND `deposit_amount` > 0;
