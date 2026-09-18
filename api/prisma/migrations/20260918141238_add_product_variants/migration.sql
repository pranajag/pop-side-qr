-- CreateTable
CREATE TABLE `variant_groups` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `product_id` INTEGER NOT NULL,
    `nama` VARCHAR(191) NOT NULL,
    `required` BOOLEAN NOT NULL DEFAULT false,
    `multiple` BOOLEAN NOT NULL DEFAULT false,
    `urutan` INTEGER NOT NULL DEFAULT 0,

    INDEX `variant_groups_product_id_idx`(`product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `variant_options` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `group_id` INTEGER NOT NULL,
    `nama` VARCHAR(191) NOT NULL,
    `harga_tambahan` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `urutan` INTEGER NOT NULL DEFAULT 0,

    INDEX `variant_options_group_id_idx`(`group_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_item_variants` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_item_id` INTEGER NOT NULL,
    `nama_group` VARCHAR(191) NOT NULL,
    `nama_option` VARCHAR(191) NOT NULL,
    `harga_tambahan` DECIMAL(65, 30) NOT NULL,

    INDEX `order_item_variants_order_item_id_idx`(`order_item_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `variant_groups` ADD CONSTRAINT `variant_groups_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `variant_options` ADD CONSTRAINT `variant_options_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `variant_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_item_variants` ADD CONSTRAINT `order_item_variants_order_item_id_fkey` FOREIGN KEY (`order_item_id`) REFERENCES `order_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
