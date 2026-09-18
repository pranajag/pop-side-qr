-- AlterTable
ALTER TABLE `orders` ADD COLUMN `customer_name` VARCHAR(191) NULL,
    MODIFY `table_id` INTEGER NULL;
