-- AlterTable
ALTER TABLE `orders` ADD COLUMN `discount_amount` DECIMAL(65, 30) NULL DEFAULT 0,
    ADD COLUMN `discount_reason` VARCHAR(191) NULL;
