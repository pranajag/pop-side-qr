-- AlterTable
ALTER TABLE `shifts` DROP COLUMN `online_sales_amount`,
    ADD COLUMN `cash_start` DECIMAL(65, 30) NULL,
    ADD COLUMN `gojek_amount` DECIMAL(65, 30) NULL,
    ADD COLUMN `grabfood_amount` DECIMAL(65, 30) NULL;
