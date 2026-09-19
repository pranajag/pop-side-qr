-- AlterTable
ALTER TABLE `tables` ADD COLUMN `kapasitas` INTEGER NOT NULL DEFAULT 4;

-- CreateTable
CREATE TABLE `reservations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nama_customer` VARCHAR(191) NOT NULL,
    `nama_acara` VARCHAR(191) NULL,
    `telepon` VARCHAR(191) NULL,
    `jumlah_tamu` INTEGER NOT NULL,
    `tanggal_reservasi` DATETIME(3) NOT NULL,
    `table_id` INTEGER NULL,
    `status` ENUM('pending', 'confirmed', 'cancelled', 'completed') NOT NULL DEFAULT 'pending',
    `catatan` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `reservations_status_idx`(`status`),
    INDEX `reservations_tanggal_reservasi_idx`(`tanggal_reservasi`),
    INDEX `reservations_table_id_idx`(`table_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_table_id_fkey` FOREIGN KEY (`table_id`) REFERENCES `tables`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

