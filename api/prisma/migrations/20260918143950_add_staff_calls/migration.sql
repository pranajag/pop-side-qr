-- CreateTable
CREATE TABLE `staff_calls` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `table_id` INTEGER NOT NULL,
    `catatan` VARCHAR(191) NULL,
    `status` ENUM('pending', 'resolved') NOT NULL DEFAULT 'pending',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolved_at` DATETIME(3) NULL,
    `resolved_by` INTEGER NULL,

    INDEX `staff_calls_status_idx`(`status`),
    INDEX `staff_calls_table_id_idx`(`table_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `staff_calls` ADD CONSTRAINT `staff_calls_table_id_fkey` FOREIGN KEY (`table_id`) REFERENCES `tables`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `staff_calls` ADD CONSTRAINT `staff_calls_resolved_by_fkey` FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
