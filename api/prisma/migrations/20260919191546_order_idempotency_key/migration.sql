-- AlterTable
ALTER TABLE `orders` ADD COLUMN `idempotency_key` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `orders_idempotency_key_key` ON `orders`(`idempotency_key`);
