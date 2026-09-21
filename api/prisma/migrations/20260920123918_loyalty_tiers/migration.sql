-- CreateTable
CREATE TABLE `loyalty_tiers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `min_points` INTEGER NOT NULL,
    `discount_percent` DECIMAL(65, 30) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `loyalty_tiers_min_points_key`(`min_points`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
