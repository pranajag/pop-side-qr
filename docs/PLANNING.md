# PLANNING.md — Sprint Breakdown

Prinsip: 1 sprint = 1 scope kecil yang bisa diuji sendiri. Jangan mulai sprint berikutnya sebelum manual test checklist sprint sebelumnya lolos semua. Setiap sesi vibe coding baru, WAJIB prompt AI dengan referensi eksplisit ke `AGENTS.md` + `MEMORY.md` + bagian relevan `ERD_DFD.md`.

## Sprint 1 — Database & Auth Admin/Kasir

**Tugas:**
- Setup Prisma schema penuh (semua tabel di `ERD_DFD.md`) + migration awal.
- Setup project `api/` (Express, middleware dasar: helmet, express-session, error handler).
- Endpoint: login & logout admin/kasir (akun dibuat lewat seed, bukan endpoint register publik).
- Hash password dengan bcrypt, session cookie httpOnly/secure/sameSite=strict, regenerate session id saat login.
- Middleware RBAC (`requireRole`).
- Rate limit + lockout percobaan login.

**Definition of Done:**
- Bisa login sebagai admin dan kasir dengan akun berbeda, dapat session cookie yang benar.
- Endpoint admin-only ditolak (403) kalau diakses akun kasir.
- Password di database ter-hash, bukan plaintext.

**Test manual:**
1. Login dengan password salah 6x berturut-turut → harus lockout sementara.
2. Cek cookie session di browser dev tools → pastikan `HttpOnly` & `SameSite=Strict` aktif.
3. Coba akses endpoint admin-only pakai sesi kasir → harus 403.

## Sprint 2 — Menu & Meja Management

**Tugas:**
- CRUD kategori & produk (admin only), termasuk upload foto produk (multer + validasi MIME asli + random filename).
- CRUD data meja + generate QR token (HMAC per meja, secret unik per baris).
- Endpoint generate gambar/link QR per meja (untuk dicetak).
- Halaman admin sederhana untuk kelola menu & meja (Vue + Tailwind + shadcn-vue).

**Definition of Done:**
- Admin bisa menambah kategori, produk (dengan foto), atur `is_available` dan `track_stock`.
- Setiap meja punya QR token unik yang bisa digenerate ulang tanpa memengaruhi meja lain.

**Test manual:**
1. Upload file `.php` yang di-rename jadi `.jpg` → harus ditolak (cek MIME asli, bukan cuma ekstensi).
2. Generate ulang token meja nomor 3 → pastikan QR meja lain tetap valid.

## Sprint 3 — Public Order Flow + Keranjang

**Tugas:**
- Endpoint validasi token QR meja (HMAC verify).
- Halaman public: tampilan menu per kategori (mobile-first, Tailwind + shadcn-vue).
- Keranjang di Pinia (client-side, hanya `product_id` + `qty` + catatan — TANPA harga).
- Endpoint hitung total dari server (ambil harga dari DB, bukan dari request).

**Definition of Done:**
- Scan QR dengan token invalid/rusak → ditolak dengan pesan jelas, tidak lanjut ke menu.
- Total di keranjang selalu dihitung ulang dari server, sudah dites tidak bisa dimanipulasi lewat DevTools/network tab.

**Test manual:**
1. Ubah nilai harga di request checkout lewat DevTools → total tetap dihitung benar dari server.
2. Scan QR dengan parameter token diubah manual (ganti 1 karakter) → harus ditolak.

## Sprint 4 — Payment Logic + Kode Order

**Tugas:**
- Generate kode order format `ORD-YYYYMMDD-XXXX` (exclude karakter ambigu).
- Flow QRIS: tampilkan QRIS statis → tombol "saya sudah bayar" → status `waiting_verif`.
- Flow tunai/debit: order dibuat langsung dengan status `pending`, tampilkan kode order ke customer.
- Transaksi DB: insert order + order_items + kurangi stok (untuk produk `track_stock=true`) dalam satu `$transaction`.
- Endpoint tracking status by kode order (rate-limited, tidak membocorkan data order lain).

**Definition of Done:**
- Dua request checkout bersamaan untuk stok terakhir → hanya satu yang sukses, satu lainnya mendapat pesan "stok habis" (tes race condition).
- Kode order tidak bisa ditebak/diurutkan (benar-benar random per hari).

**Test manual:**
1. Buka 2 tab, checkout produk dengan stok=1 secara nyaris bersamaan → pastikan cuma 1 yang berhasil.
2. Coba akses endpoint tracking dengan kode order yang salah 1 karakter → harus "not found", bukan malah menampilkan order lain.

## Sprint 5 — Dashboard Admin/Kasir + Laporan Harian

**Tugas:**
- Dashboard list order (filter status, prioritaskan `waiting_verif`), realtime atau polling.
- Aksi konfirmasi pembayaran (optimistic lock — `WHERE status = 'waiting_verif'`).
- Update status order (cooking/ready/completed/cancelled).
- Laporan pendapatan harian (total + breakdown metode bayar), dihitung dengan timezone Asia/Jakarta.
- `order_status_log` tercatat di setiap perubahan status (audit trail).

**Definition of Done:**
- Dua kasir klik "Konfirmasi" di order yang sama secara bersamaan → hanya 1 yang berhasil, tidak double-process.
- Laporan pendapatan hari ini akurat, tidak bergeser akibat timezone server.
- Setiap perubahan status tercatat di `order_status_log` dengan siapa & kapan.

**Test manual:**
1. Buat order jam 23:55 dan jam 00:05 WIB → pastikan masuk ke hari yang benar di laporan.
2. Dua browser login kasir berbeda, konfirmasi order yang sama hampir bersamaan → cek di log cuma 1 yang tercatat sukses.

## Setelah Sprint 5

Belum ada sprint lanjutan yang direncanakan — cek `docs/PRD.md` bagian "Out of Scope" untuk fitur yang sengaja belum dikerjakan (payment gateway, akun customer, dst). Jangan mulai fitur baru tanpa update PRD dulu.
