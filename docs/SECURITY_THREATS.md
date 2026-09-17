# Security Threat Model — Login Admin/Kasir

Konteks: satu-satunya sistem login di seluruh aplikasi ini adalah login admin/kasir (customer tidak punya akun — lihat `MEMORY.md`). Karena dashboard ini diakses lewat internet publik (bukan cuma jaringan lokal cafe), threat model di bawah wajib diimplementasikan sebelum sistem live, bukan sekadar nice-to-have.

| Ancaman | Mitigasi Konkret |
|---|---|
| **Phishing / Browser-in-the-Middle** | Staff hanya akses admin dashboard lewat bookmark HTTPS yang sudah disimpan, tidak lewat link yang dikirim orang lain. Tampilkan info "login terakhir: [waktu]" di dashboard setelah login supaya anomali terlihat. |
| **Session Hijacking (pencurian cookie sesi)** | Cookie `HttpOnly` + `Secure` + `SameSite=Strict` (wajib, sudah ada di `AGENTS.md`). Session diregenerasi saat login. Session lifetime pendek + idle timeout (misal 30 menit tanpa aktivitas → logout otomatis). Logout menghapus session di server, bukan cuma di client. |
| **Malware Infostealer & Keylogger** | Ini serangan di level device staff, di luar kendali aplikasi web. Mitigasi yang bisa dilakukan aplikasi: session lifetime pendek (kalau cookie kecuri, cepat kedaluwarsa), catat/notifikasi kalau ada login dari device atau IP baru. Selebihnya tanggung jawab kebersihan device staff sendiri (antivirus, hindari instal aplikasi sembarangan) — bukan sesuatu yang bisa "dikodekan" di aplikasi. |
| **Credential Stuffing & Password Spraying** | Rate limit login (maks 5x gagal / 15 menit / kombinasi IP+username → lockout sementara). Wajibkan password minimal 8 karakter + kombinasi huruf & angka. Log semua percobaan login gagal. |
| **MFA Fatigue / Prompt Bombing** | Kalau nanti mengimplementasikan MFA, pakai TOTP (Google Authenticator/Authy — masukkan kode 6 digit), JANGAN push-approval ("approve/deny" notification) — push-based MFA itu yang bisa di-spam attacker sampai staff lelah dan asal approve. TOTP tidak punya mekanisme "approve" untuk di-spam. MFA belum wajib di MVP, tapi kalau ditambah nanti, harus TOTP. |
| **Man-in-the-Middle via WiFi Palsu (evil twin)** | HTTPS wajib di seluruh domain (bukan cuma halaman login), plus header HSTS (`Strict-Transport-Security`, via `helmet`) supaya browser menolak fallback ke HTTP. Sarankan staff hindari akses dashboard admin lewat WiFi publik/tidak dikenal — pakai data seluler kalau ragu. |

## Ringkasan Checklist Security (implementasi detail ada di `AGENTS.md`)

Semua rule di bawah wajib berjalan sebelum fitur terkait dianggap "selesai" — bukan cuma tertulis di dokumen:

- Prepared statement / parameterized query di semua akses database, tanpa kecuali.
- Password memakai `bcrypt`, tidak pernah `md5`/`sha1`/plaintext.
- Proteksi CSRF di semua request POST/PUT/DELETE yang memakai cookie session.
- Validasi input di server untuk semua endpoint (tipe, range, whitelist) — validasi di client cuma bonus UX.
- Upload file: whitelist MIME asli (bukan cuma ekstensi), ukuran dibatasi, nama file random, tidak diserve langsung sebagai static file yang bisa dieksekusi.
- Semua harga/total dihitung ulang di server, tidak pernah memercayai input dari client.
- Rate limiting di endpoint create order, cek status order, dan login.
- Detail error tidak pernah sampai ke response client di production — semua masuk log file.
- Transaksi database untuk semua operasi yang menyentuh lebih dari satu tabel terkait order (order + order_items + stok).
