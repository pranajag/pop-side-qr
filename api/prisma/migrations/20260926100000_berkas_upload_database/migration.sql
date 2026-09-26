-- Penyimpanan upload di database (UPLOAD_DRIVER=database) untuk hosting
-- tanpa disk permanen. Tambah tabel saja — tidak mengubah data apa pun.

-- CreateTable
CREATE TABLE `berkas_upload` (
    `nama` VARCHAR(64) NOT NULL,
    `kategori` VARCHAR(20) NOT NULL,
    `jenis` VARCHAR(30) NOT NULL,
    `isi` MEDIUMBLOB NOT NULL,
    `ukuran` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `berkas_upload_kategori_idx`(`kategori`),
    PRIMARY KEY (`nama`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

