# AGENTS.md — Popside QR Ordering System

Instruksi teknis untuk AI coding agent (Claude Code, Cursor, Copilot, dll) yang bekerja di repo ini. Baca file ini di awal SETIAP sesi baru sebelum menulis kode apa pun. Untuk konteks bisnis (bukan teknis), baca `MEMORY.md` di folder yang sama.

## Ringkasan Project

Dua web yang terhubung ke satu backend API & satu database:

- **Public web** (`public-web/`) — customer scan QR meja, pesan makanan/minuman, bayar (QRIS/tunai/debit), tracking status. Tanpa login.
- **Admin web** (`admin-web/`) — kasir & admin konfirmasi pesanan, verifikasi pembayaran, lihat laporan pendapatan. Login wajib.

## Tech Stack (FIXED — jangan ganti tanpa persetujuan eksplisit dari user)

| Layer | Pilihan |
|---|---|
| Frontend (keduanya) | Vue 3, Composition API + `<script setup>` (bukan Options API, jangan dicampur) |
| Build tool | Vite |
| State management | Pinia |
| Routing | Vue Router |
| Styling | Tailwind CSS + shadcn-vue |
| Backend | Node.js + Express |
| ORM / DB access | Prisma |
| Database | MySQL |
| Auth | express-session (cookie-based), BUKAN JWT |
| Realtime (opsional, boleh nyusul) | Socket.IO |
| Validasi schema | zod |

Kalau AI agent merasa "framework/library lain lebih cocok" — JANGAN diganti sendiri di tengah jalan. Tanya dulu ke user.

## Struktur Folder

```
popside-qr-system/
├── AGENTS.md
├── MEMORY.md
├── docs/
│   ├── PRD.md
│   ├── PLANNING.md
│   ├── ERD_DFD.md
│   ├── UI_GUIDELINES.md
│   └── SECURITY_THREATS.md
├── api/                    # Node.js + Express backend
│   ├── prisma/
│   │   └── schema.prisma
│   ├── src/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── middleware/     # auth, rbac, rateLimit, csrf, upload
│   │   ├── services/       # business logic (order, payment, stock)
│   │   ├── utils/          # hmac token, order code generator
│   │   └── app.js
│   ├── uploads/            # bukti bayar — TIDAK diserve langsung via express.static
│   ├── .env.example
│   └── package.json
├── public-web/             # Vue 3 — customer
│   └── src/
│       ├── views/
│       ├── components/
│       ├── stores/         # Pinia
│       └── router/
└── admin-web/              # Vue 3 — kasir/admin
    └── src/ (struktur sama seperti public-web)
```

## Cara Jalanin Lokal

0. Nyalakan MySQL dulu (lihat "Database Lokal" di bawah — **bukan** XAMPP di mesin ini).
1. `cd api && npm install && npx prisma migrate dev && npm run dev`
2. `cd public-web && npm install && npm run dev`
3. `cd admin-web && npm install && npm run dev`

Env variables ada contohnya di `api/.env.example` — copy jadi `.env`, isi `DATABASE_URL`, `SESSION_SECRET`, `QR_HMAC_SECRET`, `TZ=Asia/Jakarta`.

## Database Lokal (khusus mesin dev ini)

XAMPP MySQL di mesin ini punya corruption di storage engine Aria (`mysql.plugin`/`mysql.db` gagal dibaca, server tidak mau nyala) — **bukan disebabkan project ini**, dan diputuskan untuk tidak diotak-atik lagi karena dipakai bareng project lain di luar Popside. Jangan diperbaiki ulang tanpa izin eksplisit.

Sebagai gantinya, project ini pakai instalasi MySQL 8.4 resmi yang terpisah, khusus untuk Popside, jalan di **port 3307** (bukan 3306, supaya tidak bentrok kalau XAMPP dinyalakan lagi untuk keperluan lain). `DATABASE_URL` di `api/.env` sudah mengarah ke `localhost:3307`.

Seluruh folder `.mysql-data/` (data dir + config) di-gitignore karena isinya file database + path absolut yang spesifik ke mesin ini. Kalau belum ada / hilang, bikin ulang dari root project:

```
mkdir .mysql-data\data
```

`.mysql-data\my.ini`:
```ini
[mysqld]
port=3307
datadir=D:/popside - qr - system/.mysql-data/data
default-storage-engine=INNODB
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
default-time-zone='+07:00'
```

Lalu:
```
"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe" --defaults-file=".mysql-data\my.ini" --initialize-insecure
"C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqld.exe" --defaults-file=".mysql-data\my.ini"
```

Start manual tiap sesi dev (belum didaftarkan sebagai Windows Service) — jalankan baris `mysqld.exe` kedua di atas (tanpa `--initialize-insecure`, cukup sekali di awal).

Akun: `root` tanpa password (dev only) + `popside_app` (password ada di `api/.env`), privilege cuma di database `popside_qr`:
```sql
CREATE DATABASE popside_qr CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'popside_app'@'localhost' IDENTIFIED BY '<sama dengan DATABASE_URL di api/.env>';
GRANT ALL PRIVILEGES ON popside_qr.* TO 'popside_app'@'localhost';
```

## BOLEH

- Prisma query API, atau `mysql2` dengan placeholder `?` kalau butuh raw query — dua-duanya otomatis parameterized.
- Tailwind + shadcn-vue untuk semua UI, komponen reusable ditaruh di `components/ui/`.
- Transaksi Prisma (`$transaction`) untuk semua operasi yang nyentuh stok atau lebih dari satu tabel (order + order_items + update stok = 1 transaksi).
- Composition API + `<script setup>` konsisten di semua komponen Vue.
- Validasi input di client (untuk UX) SELAMA tetap ada validasi yang sama di server (server yang jadi sumber kebenaran).

## TIDAK BOLEH

- Raw SQL string interpolation dalam bentuk apa pun (contoh yang DILARANG: menyisipkan variabel langsung ke dalam teks query) — HARAM, walau cuma buat query internal/admin.
- Menghitung atau memercayai harga, total, atau diskon dari data yang dikirim frontend. Frontend cuma boleh kirim `product_id` + `qty`; harga & total WAJIB dihitung ulang dari database di backend.
- Menyimpan harga atau data sensitif apa pun di `localStorage` — cuma boleh cart sementara (product_id + qty + catatan), bukan harga.
- Mengambil id meja/order langsung dari `req.query`/`req.params` tanpa validasi & tanpa cek kepemilikan (meja A tidak boleh bisa baca/ubah order meja B).
- UI gradient ungu/biru generik ala-AI, card dengan shadow tebal. Lihat `docs/UI_GUIDELINES.md`.
- `md5()`/`sha1()`/plaintext untuk password — HARUS `bcrypt` atau `argon2`.
- Menampilkan stack trace atau detail error teknis ke response publik. Semua error di-log (`winston`/`pino`), response ke client generic.
- Bikin satu file/komponen raksasa yang mengerjakan semuanya. Pisah route/controller/service sesuai struktur folder di atas.

## Security Rules (implementasi konkret)

1. **Prepared statement** — Prisma atau `mysql2` dengan placeholder, tanpa kecuali.
2. **Password** — `bcrypt.hash()` (cost factor ≥ 10) saat set password admin/kasir, `bcrypt.compare()` saat login.
3. **CSRF** — pakai `csrf-csrf` di semua route POST/PUT/DELETE yang memakai session cookie. (`csurf` sudah deprecated & punya CVE, jangan dipakai.)
4. **Session** — `express-session`, cookie `httpOnly: true, secure: true, sameSite: 'strict'`. Regenerate session id (`req.session.regenerate()`) setiap kali login sukses.
5. **RBAC** — middleware `requireRole('admin' | 'kasir')` di setiap route admin. Kasir tidak boleh akses endpoint khusus admin (kelola akun, laporan penuh — detail role matrix di `MEMORY.md`).
6. **Upload** — `multer`, `fileFilter` whitelist MIME asli (`image/jpeg`, `image/png`, `image/webp`) + cek magic bytes (bukan cuma ekstensi), `limits.fileSize` maks 2MB, nama file `crypto.randomUUID()` + ekstensi asli, simpan di `api/uploads/`, TIDAK diserve via `express.static` — serve lewat route ber-auth yang stream file-nya.
7. **Path traversal** — semua path file di-resolve pakai `path.resolve()` dan divalidasi masih di dalam folder `uploads/` sebelum dibaca/ditulis.
8. **Rate limiting** (`express-rate-limit`) — maks 10 request/menit/IP untuk endpoint create order, maks 5 request/menit/IP untuk endpoint cek status order, maks 5x gagal login/15 menit/kombinasi IP+username (lockout sementara).
9. **QR token meja** — HMAC-SHA256 (`crypto.createHmac`), SETIAP meja punya secret/salt unik di kolom `tables.token_secret` (bukan 1 secret global) — supaya QR satu meja bisa di-reset tanpa mengganggu meja lain.
10. **Order code** — format `ORD-YYYYMMDD-XXXX`, 4 karakter random dari alfabet TANPA `0 O 1 I l` (hindari ambigu karena dibacakan verbal oleh customer ke kasir).
11. **Race condition / lock stok** — update stok pakai kondisi `WHERE stok >= qty` di dalam `$transaction`, cek jumlah baris terupdate — kalau 0, rollback & kembalikan pesan "stok habis".
12. **Optimistic lock status order** — update status pakai kondisi `WHERE status = '<status_yang_diharapkan>'`, cek baris terupdate, supaya dua staff tidak bisa double-confirm order yang sama.
13. **XSS** — Vue auto-escape `{{ }}`, JANGAN PERNAH pakai `v-html` untuk data dari user/database.
14. **Header keamanan** — pasang `helmet` di Express (CSP, HSTS, X-Frame-Options, dll langsung sekali jalan).
15. **Timezone** — set `TZ=Asia/Jakarta` di `.env` backend, pastikan koneksi MySQL juga pakai timezone yang sama (bukan UTC) — krusial untuk query "pendapatan hari ini".
16. **Error handling** — `NODE_ENV=production` → response generic ke client, detail error masuk log file (`winston`/`pino`). Jangan pernah mengembalikan `err.message` mentah ke client di production.
17. **.gitignore wajib berisi**: `.env`, `node_modules/`, `api/uploads/*` (kecuali `.gitkeep`), `dist/`, `logs/`.
18. **Validasi input** — semua endpoint pakai schema validation (`zod`) untuk tipe, range, dan whitelist (contoh: `qty` harus integer > 0, `metode_bayar` harus salah satu dari `qris`/`tunai`/`debit`). Validasi di client cuma bonus UX, server yang menentukan.

## Coding Conventions

- Commit kecil per unit kerja, message jelas (contoh: `feat: tambah endpoint create order`, bukan `update`).
- Satu sesi vibe coding = satu scope kecil (1 fitur/endpoint/komponen). Jangan minta AI generate banyak modul sekaligus dalam satu prompt panjang.
- Sebelum lanjut ke sprint berikutnya, jalankan manual test checklist di `docs/PLANNING.md` untuk sprint yang baru selesai.
- Setiap prompt vibe coding baru, sebutkan ulang bagian relevan dari `AGENTS.md`/`MEMORY.md` — jangan asumsikan AI "ingat" dari sesi sebelumnya.
