-- Log status order (halaman Riwayat Aktivitas) bersifat APPEND-ONLY: baris
-- log hanya boleh DITAMBAH. Tidak ada kode aplikasi yang mengubah atau
-- menghapusnya, dan trigger ini memastikan hal itu juga di tingkat database —
-- kalau suatu hari ada celah di aplikasi, jejak siapa mengubah status apa
-- tetap tidak bisa dihapus atau dipalsukan lewat akun aplikasi.
--
-- Mengubah baris log: selalu ditolak.
-- Menghapus baris log: ditolak untuk semua akun KECUALI popside_migrate —
-- akun perawatan (DIRECT_URL) yang dipakai scripts/pentest.js untuk
-- membersihkan order uji buatannya sendiri. Akun aplikasi (popside_app)
-- tidak pernah bisa menghapus log. Hapus lewat foreign key (mis. SET NULL
-- saat akun staff dihapus) tetap jalan: InnoDB tidak menjalankan trigger
-- untuk aksi berantai foreign key.
--
-- CARA MENERAPKAN: binary log MySQL 8 aktif secara bawaan, dan dalam kondisi
-- itu hanya akun ber-hak SUPER yang boleh membuat trigger — popside_migrate
-- tidak punya hak itu. Jalankan migrasi ini sekali sebagai root:
--   DIRECT_URL="mysql://root@127.0.0.1:3306/popside_qr" npx prisma migrate deploy

DROP TRIGGER IF EXISTS `order_status_log_tolak_ubah`;

DROP TRIGGER IF EXISTS `order_status_log_tolak_hapus`;

CREATE TRIGGER `order_status_log_tolak_ubah` BEFORE UPDATE ON `order_status_log`
FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'order_status_log bersifat append-only: baris log tidak boleh diubah';

CREATE TRIGGER `order_status_log_tolak_hapus` BEFORE DELETE ON `order_status_log`
FOR EACH ROW
BEGIN
  IF SUBSTRING_INDEX(USER(), '@', 1) <> 'popside_migrate' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'order_status_log bersifat append-only: baris log tidak boleh dihapus';
  END IF;
END;
