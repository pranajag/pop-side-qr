-- AlterTable
ALTER TABLE `orders` ADD COLUMN `service_charge_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    ADD COLUMN `tax_amount` DECIMAL(65, 30) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `store_settings` ADD COLUMN `alamat` VARCHAR(191) NULL,
    ADD COLUMN `nama_toko` VARCHAR(191) NULL,
    ADD COLUMN `pajak_persen` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    ADD COLUMN `service_charge_persen` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    ADD COLUMN `telepon` VARCHAR(191) NULL;
