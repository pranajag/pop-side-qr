-- AlterTable
ALTER TABLE `reservations` ADD COLUMN `deposit_amount` DECIMAL(65, 30) NULL DEFAULT 0,
    ADD COLUMN `deposit_metode` ENUM('qris', 'tunai', 'debit') NULL,
    ADD COLUMN `deposit_paid` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `deposit_paid_at` DATETIME(3) NULL;
