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
| Realtime | Socket.IO — notifikasi staff & status order customer (`api/src/realtime.js`); polling di frontend tetap ada sebagai cadangan |
| Validasi schema | zod |

Kalau AI agent merasa "framework/library lain lebih cocok" — JANGAN diganti sendiri di tengah jalan. Tanya dulu ke user.

## Struktur Folder

```
popside-qr-system/
├── AGENTS.md
├── MEMORY.md
├── render.yaml             # Render Blueprint — alternatif hosting API (butuh kartu kredit)
├── docs/
│   ├── PRD.md
│   ├── PLANNING.md
│   ├── ERD_DFD.md
│   ├── UI_GUIDELINES.md
│   ├── SECURITY_THREATS.md
│   ├── SECURITY_FIXES.md   # hardening yang sudah dikerjakan + keputusan pemilik
│   └── LOGIC_BUGS_FIX.md   # bug logika bisnis
├── api/                    # Node.js + Express backend
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── data-demo.json  # menu/meja/tier/info toko untuk database hosting — TANPA data pribadi (repo publik)
│   │   └── aiven-ca.pem    # sertifikat CA database cadangan Aiven (bukan rahasia)
│   ├── scripts/            # pentest, audit-db, siapkan-produksi, reset-2fa, dll
│   ├── src/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── middleware/     # auth, rbac, rateLimit, csrf, upload, auditLog
│   │   ├── services/       # business logic (order, payment, stock)
│   │   ├── utils/          # hmac token, order code generator, kripto (enkripsi)
│   │   ├── realtime.js     # Socket.IO
│   │   └── app.js
│   ├── uploads/            # bukti bayar — TIDAK diserve langsung via express.static
│   ├── .env.example
│   └── package.json
├── public-web/             # Vue 3 — customer (vercel.json = konfigurasi hosting)
│   └── src/
│       ├── views/
│       ├── components/
│       ├── stores/         # Pinia
│       └── router/
└── admin-web/              # Vue 3 — kasir/admin (vercel.json = konfigurasi hosting)
    └── src/ (struktur sama seperti public-web)
```

## Cara Jalanin Lokal

0. Nyalakan MySQL dulu (lihat "Database Lokal" di bawah — **bukan** XAMPP di mesin ini).
   - Laragon: buka Laragon, klik "Start All" (atau start MySQL saja) — GUI-nya yang jaga proses, tidak perlu command manual tiap sesi.
1. `cd api && npm install && npx prisma migrate dev && npm run dev`
2. `cd public-web && npm install && npm run dev`
3. `cd admin-web && npm install && npm run dev`

Env variables ada contohnya di `api/.env.example` — copy jadi `.env`, isi `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET`, `CSRF_SECRET`, `QR_HMAC_SECRET`, `DATA_ENC_KEY` + `DATA_HASH_KEY` (wajib — API menolak start tanpa keduanya; kunci hilang = nomor HP member tidak bisa dibaca lagi), `TZ=Asia/Jakarta`.

## Database Lokal (khusus mesin dev ini)

**Update 2026-09-21: pindah ke Laragon.** MySQL project ini sekarang jalan lewat **Laragon** (`C:\laragon`), MySQL 8.0.30 bawaannya, port **3306** (default) — dikelola lewat GUI Laragon ("Start All"/"Stop All"), tidak perlu lagi jalanin `mysqld.exe` manual tiap sesi. `DATABASE_URL` di `api/.env` mengarah ke `localhost:3306`.

Riwayat sebelumnya (untuk konteks, sudah tidak dipakai):
- XAMPP MySQL di mesin ini sempat punya corruption di storage engine Aria (`mysql.plugin`/`mysql.db` gagal dibaca) — bukan disebabkan project ini. Belum tentu masih bermasalah sekarang kalau sudah pindah ke Laragon, tapi tetap jangan pakai XAMPP untuk Popside tanpa mengecek ulang.
- Sempat pakai instalasi MySQL 8.4 resmi terpisah di port 3307 (folder `.mysql-data/` di root project, di-gitignore) sebagai jalan tengah sebelum Laragon terpasang. Data lama di situ **sengaja tidak dihapus** (jaga-jaga/backup), tapi project sudah tidak connect ke situ lagi — jangan bingung kalau nemu folder ini masih ada.

**Update 2026-09-23: diperketat.** Tiga akun, masing-masing dengan hak seperlunya:

| Akun | Dipakai oleh | Hak |
|---|---|---|
| `popside_app` | API yang sedang berjalan (`DATABASE_URL`) | **Hanya** `SELECT, INSERT, UPDATE, DELETE` di `popside_qr` — tidak bisa `DROP`/`ALTER`/`CREATE`/`TRUNCATE`, jadi celah injeksi sekalipun tidak bisa merusak struktur tabel |
| `popside_migrate` | `prisma migrate` (`DIRECT_URL`, lewat `directUrl` di `schema.prisma`) | `ALL PRIVILEGES` di `popside_qr` — perintah migrate otomatis memakai akun ini, tidak perlu flag tambahan |
| `root` | Laragon sendiri (Start/Stop, HeidiSQL) | Tanpa password (default Laragon, dev only) — sengaja tidak diubah dari luar karena tombol Start/Stop Laragon memakainya |

JANGAN kembalikan `popside_app` ke `ALL PRIVILEGES`, dan jangan tambahkan kode aplikasi yang menjalankan DDL (`ALTER`/`CREATE`/`DROP`) lewat Prisma Client — itu memang akan ditolak (error 1142), dan itu disengaja. Perubahan struktur selalu lewat file migrasi.

`my.ini` Laragon (`C:\laragon\bin\mysql\mysql-8.0.30-winx64\my.ini`, backup aslinya `my.ini.bak-sebelum-pengetatan-20260923`) juga diubah:
- `bind-address=127.0.0.1` + `mysqlx-bind-address=127.0.0.1` — MySQL (3306) dan X Protocol (33060) tidak lagi terlihat dari jaringan/WiFi, cuma dari laptop ini. Karena itu `DATABASE_URL`/`DIRECT_URL` pakai `127.0.0.1`, bukan `localhost` (di Windows `localhost` bisa jatuh ke IPv6 `::1` yang tidak didengarkan).
- `secure-file-priv=NULL` — SQL tidak bisa membaca/menulis file sembarang di disk (`LOAD DATA INFILE`, `SELECT ... INTO OUTFILE`).

Kalau perlu setup ulang dari nol:
```sql
CREATE DATABASE popside_qr CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'popside_app'@'localhost' IDENTIFIED BY '<sama dengan DATABASE_URL di api/.env>';
CREATE USER 'popside_app'@'127.0.0.1' IDENTIFIED BY '<sama dengan DATABASE_URL di api/.env>';
GRANT SELECT, INSERT, UPDATE, DELETE ON popside_qr.* TO 'popside_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON popside_qr.* TO 'popside_app'@'127.0.0.1';
CREATE USER 'popside_migrate'@'localhost' IDENTIFIED BY '<sama dengan DIRECT_URL di api/.env>';
CREATE USER 'popside_migrate'@'127.0.0.1' IDENTIFIED BY '<sama dengan DIRECT_URL di api/.env>';
GRANT ALL PRIVILEGES ON popside_qr.* TO 'popside_migrate'@'localhost';
GRANT ALL PRIVILEGES ON popside_qr.* TO 'popside_migrate'@'127.0.0.1';
```

Pemeriksaan rutin: `cd api && npm test` (aturan bisnis & keamanan; tes integrasinya butuh MySQL hidup + `DIRECT_URL`, dan membersihkan data ujinya sendiri), `npm run db:audit` (kesehatan data, baca-saja), dan `npm run pentest` (simulasi serangan; butuh `PENTEST_ADMIN_USERNAME`/`PENTEST_ADMIN_PASSWORD` + `PENTEST_ADMIN_TOTP_SECRET` karena admin wajib 2FA, opsional `PENTEST_KASIR_USERNAME`/`PENTEST_KASIR_PASSWORD`, dan satu shift aktif untuk akun admin itu supaya tes pembayaran tidak ditolak gerbang shift). Jangan pakai akun admin asli untuk pentest — buat akun uji sementara lalu hapus lagi. Apa saja yang sudah ditutup dan keputusan pemilik: `docs/SECURITY_FIXES.md` dan `docs/LOGIC_BUGS_FIX.md`.

## Hosting demo (Vercel + Railway) — berjalan sejak 27 September 2026

| Bagian | Layanan | Alamat / konfigurasi |
|---|---|---|
| `public-web` | Vercel, project `popside-menu` | https://popside-menu.vercel.app — `public-web/vercel.json`, `public-web/.env.production` |
| `admin-web` | Vercel, project `popside-admin` | https://popside-admin.vercel.app — `admin-web/vercel.json`, `admin-web/.env.production` |
| `api` | Railway project `popside`, service `popside-api` (Singapura, 1 replika) | https://popside-api-production.up.railway.app — variabel di Railway |
| MySQL | Railway service `MySQL` (MySQL 9.4, Singapura) | hanya jaringan privat `mysql.railway.internal`, tanpa akses publik |
| Cadangan | Aiven MySQL (Bengaluru) — salinan data 27 Sep dini hari, tidak dipakai lagi | `npm run siapkan-produksi` |

Kenapa begini: Render meminta kartu kredit (Blueprint) dan kartu pemilik ditolak bank; di Railway tidak perlu kartu (trial). Database Aiven di Bengaluru butuh ±240 ms per query dari server Railway Singapura (jalurnya buruk), sehingga aksi staff bisa 1–3 detik; database dipindah ke MySQL Railway di region yang sama (±1 ms per query). `render.yaml` disimpan sebagai alternatif kalau kelak ada kartu.

Aturan yang JANGAN diubah tanpa paham akibatnya:
- Frontend memanggil `/api` di domainnya sendiri; Vercel meneruskannya ke Railway (`rewrites` di `vercel.json`). Karena itu cookie sesi/CSRF/perangkat tetap first-party `__Host-` + `sameSite=strict`. Jangan arahkan frontend langsung ke `railway.app`, dan jangan longgarkan cookie ke `SameSite=None`.
- WebSocket langsung ke domain Railway (`VITE_REALTIME_URL`) dengan token 60 detik — bukan lewat Vercel (rewrite tidak meneruskan WebSocket).
- Kalau domain berubah, ubah bersamaan: `vercel.json` (rewrite + CSP `connect-src`), `.env.production` (`VITE_REALTIME_URL`), dan variabel `CORS_ORIGIN`/`PUBLIC_WEB_URL` di Railway.
- `popside-api` harus tetap **1 replika**: rate limit, kunci PIN, dan koneksi realtime disimpan di memori proses.
- `UPLOAD_DRIVER=database` (disk container tidak permanen) dan `TRUST_PROXY=2` (Vercel → Railway). Batas yang paling penting tidak bergantung IP, karena `X-Forwarded-For` bisa dipalsukan oleh yang menembak Railway langsung.
- Deploy ulang API dari `api/`: `npx @railway/cli up --service popside-api --ci` (mengunggah folder lokal; `.railwayignore` menyingkirkan `.env` dan `uploads/`). Start `node src/server.js` dan health check `/api/health` diatur di pengaturan service (lewat Railway API) — `railway.json` tidak terbaca untuk deploy dari CLI.
- Rahasia hanya ada di variabel Railway, TIDAK pernah di repo; cadangannya di folder Documents pemilik (`popside-kunci-produksi-*.txt`). `DATA_ENC_KEY`/`DATA_HASH_KEY` tidak boleh dibuat ulang — nomor HP & rahasia 2FA yang sudah terenkripsi tidak bisa dibaca dengan kunci baru. Karena itu `siapkan-produksi --railway` menolak berjalan kalau service sudah punya kunci.
- MySQL Railway tidak bisa dijangkau dari internet. Migrasi baru di produksi: buka TCP proxy sementara untuk service `MySQL` (Settings → Networking, lalu redeploy), jalankan `prisma migrate deploy` dengan `DIRECT_URL` akun `popside_migrate` lewat proxy itu, beri `popside_app` hak di tabel baru (SELECT/INSERT/UPDATE/DELETE; tabel log hanya SELECT/INSERT), lalu hapus lagi proxy-nya.
- Tanpa trigger, tabel log tetap append-only lewat hak akses: `popside_app` hanya `SELECT` + `INSERT` di `audit_log` dan `order_status_log`.
- Railway trial: $5 / 30 hari untuk API + MySQL (volume maks 500 MB). Sesudahnya: upgrade paket Railway, atau kembali ke Aiven — salin datanya dulu dari MySQL Railway, lalu isi `DATABASE_URL` dengan `ROLLBACK_DATABASE_URL_AIVEN` di file cadangan.
- OTP member di produksi butuh gateway WhatsApp/SMS (`OTP_PENGIRIM=http` + `OTP_HTTP_*`). Tanpa itu verifikasi mati dan diskon member lewat kasir.

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
8. **Rate limiting** (`express-rate-limit`) — maks 10 request/menit/(IP+token meja) untuk endpoint create order, maks 5 request/menit/(IP+kode order) untuk endpoint cek status order, maks 5x gagal login/15 menit/kombinasi IP+username (lockout sementara). Key digabung dengan token meja/kode order (bukan IP polos) supaya satu WiFi kafe yang dipakai banyak meja sekaligus tidak berbagi satu jatah limit yang sama — tiap meja/order tetap dapat jatahnya sendiri, limit per-pelanggan tidak berubah. Di balik proxy (`TRUST_PROXY`), IP bisa dipalsukan — batas yang penting juga dipasang per username/meja/nomor HP (`api/src/middleware/rateLimit.js`).
9. **QR token meja** — HMAC-SHA256 (`crypto.createHmac`), SETIAP meja punya secret/salt unik di kolom `tables.token_secret` (bukan 1 secret global) — supaya QR satu meja bisa di-reset tanpa mengganggu meja lain.
10. **Order code** — format `ORD-YYYYMMDD-XXXX-M<nomor meja>`, contoh `ORD-20260923-AB7K-M1`. 4 karakter random dari alfabet TANPA `0 O 1 I l` (hindari ambigu karena dibacakan verbal oleh customer ke kasir). Akhiran meja ditambahkan supaya staff langsung tahu pesanan ini milik meja berapa hanya dari kodenya (tiket dapur, struk, daftar pesanan) — pesanan tanpa meja (penjualan kasir/bawa pulang) berakhiran `-TA`. Akhiran ini BOLEH memuat angka `0`/`1` karena dibaca dari layar, bukan dieja; pembatasan alfabet tetap berlaku untuk blok acaknya. Kode lama tanpa akhiran tetap valid — jangan pernah mem-parsing kode order untuk mengambil tanggal/meja, ambil dari kolomnya sendiri.
11. **Race condition / lock stok** — update stok pakai kondisi `WHERE stok >= qty` di dalam `$transaction`, cek jumlah baris terupdate — kalau 0, rollback & kembalikan pesan "stok habis".
12. **Optimistic lock status order** — update status pakai kondisi `WHERE status = '<status_yang_diharapkan>'`, cek baris terupdate, supaya dua staff tidak bisa double-confirm order yang sama.
13. **XSS** — Vue auto-escape `{{ }}`, JANGAN PERNAH pakai `v-html` untuk data dari user/database.
14. **Header keamanan** — pasang `helmet` di Express (CSP, HSTS, X-Frame-Options, dll langsung sekali jalan).
15. **Timezone** — set `TZ=Asia/Jakarta` di backend. Prisma menyimpan semua waktu dalam UTC; batas hari laporan dihitung dalam WIB lalu diubah ke UTC (`jakartaDayBoundsUTC`) — krusial untuk "pendapatan hari ini". Jangan pakai fungsi tanggal SQL yang bergantung zona waktu sesi database (`NOW()`, `CURDATE()`, `DATE()`): MySQL lokal ber-zona WIB, database hosting UTC. Kalau butuh waktu sekarang di SQL, pakai `UTC_TIMESTAMP()`.
16. **Error handling** — `NODE_ENV=production` → response generic ke client, detail error masuk log file (`winston`/`pino`). Jangan pernah mengembalikan `err.message` mentah ke client di production.
17. **.gitignore wajib berisi**: `.env`, `node_modules/`, `api/uploads/*` (kecuali `.gitkeep`), `dist/`, `logs/`.
18. **Validasi input** — semua endpoint pakai schema validation (`zod`) untuk tipe, range, dan whitelist (contoh: `qty` harus integer > 0, `metode_bayar` harus salah satu dari `qris`/`tunai`/`debit`). Validasi di client cuma bonus UX, server yang menentukan. Semua schema request pakai `z.strictObject` (field tak dikenal ditolak 400) — dijaga tes "validasi strict".
19. **2FA admin wajib** — TOTP (`twoFactor.service.js`); sesi admin tanpa 2FA ditolak di semua endpoint (`PERLU_2FA`). Jangan buat jalur login admin yang melewatinya. Admin yang kehilangan HP: reset dari halaman Akun Staff, atau `npm run reset-2fa -- <username>`.
20. **Data pribadi terenkripsi** — nomor HP (member & reservasi) dan rahasia 2FA disimpan terenkripsi AES-256-GCM lewat `utils/kripto.js`; pencarian lewat sidik HMAC (`telepon_hash`) dan 4 digit terakhir. Jangan simpan nomor polos di kolom/log mana pun.
21. **Pelacakan order terikat perangkat** — status order, kirim bukti bayar, dan langganan realtime hanya untuk perangkat pemesan (cookie `popside_perangkat`); perangkat lain mendapat 404 walau kodenya benar.
22. **Realtime** — kanal staff hanya dengan token dari route ber-login; langganan status order hanya dengan token dari route pelacakan. Isi event minimal (id, kode order, status) — tanpa nama/nomor/total; layar memuat detailnya lewat API biasa.
23. **Log audit** — setiap aksi tulis staff tercatat otomatis di `audit_log` (`middleware/auditLog.js`, rahasia disensor). `audit_log` dan `order_status_log` append-only — jangan tambahkan kode yang mengubah/menghapus isinya.

## Coding Conventions

- Commit kecil per unit kerja, message jelas (contoh: `feat: tambah endpoint create order`, bukan `update`).
- Satu sesi vibe coding = satu scope kecil (1 fitur/endpoint/komponen). Jangan minta AI generate banyak modul sekaligus dalam satu prompt panjang.
- Sebelum lanjut ke sprint berikutnya, jalankan manual test checklist di `docs/PLANNING.md` untuk sprint yang baru selesai.
- Setiap prompt vibe coding baru, sebutkan ulang bagian relevan dari `AGENTS.md`/`MEMORY.md` — jangan asumsikan AI "ingat" dari sesi sebelumnya.
