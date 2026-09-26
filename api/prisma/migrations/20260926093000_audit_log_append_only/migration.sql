-- Log audit (tabel audit_log, middleware/auditLog.js) bersifat APPEND-ONLY:
-- baris hanya boleh DITAMBAH. Tidak ada kode aplikasi yang mengubah atau
-- menghapusnya, dan trigger ini memastikan hal itu juga di tingkat database
-- — kalau suatu hari ada celah di aplikasi (atau akun aplikasi bocor),
-- jejak siapa melakukan apa tetap tidak bisa dihapus atau dipalsukan.
--
-- Mengubah baris: selalu ditolak.
-- Menghapus baris: ditolak untuk semua akun KECUALI popside_migrate — akun
-- perawatan (DIRECT_URL) yang dipakai tes & pentest untuk membersihkan
-- jejak akun uji buatannya sendiri. Akun aplikasi (popside_app) tidak
-- pernah bisa menghapus log. user_id menjadi NULL saat akun staff dihapus
-- (foreign key SET NULL) tetap jalan: InnoDB tidak menjalankan trigger untuk
-- aksi berantai foreign key, dan username/role sudah tersalin di barisnya.
--
-- CARA MENERAPKAN: sama seperti 20260925091000_log_status_append_only —
-- binary log MySQL 8 aktif, jadi hanya akun ber-hak SUPER yang boleh
-- membuat trigger. Jalankan migrasi ini sekali sebagai root:
--   DIRECT_URL="mysql://root@127.0.0.1:3306/popside_qr" npx prisma migrate deploy

DROP TRIGGER IF EXISTS `audit_log_tolak_ubah`;

DROP TRIGGER IF EXISTS `audit_log_tolak_hapus`;

CREATE TRIGGER `audit_log_tolak_ubah` BEFORE UPDATE ON `audit_log`
FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log bersifat append-only: baris log tidak boleh diubah';

CREATE TRIGGER `audit_log_tolak_hapus` BEFORE DELETE ON `audit_log`
FOR EACH ROW
BEGIN
  IF SUBSTRING_INDEX(USER(), '@', 1) <> 'popside_migrate' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log bersifat append-only: baris log tidak boleh dihapus';
  END IF;
END;
