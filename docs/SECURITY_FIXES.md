# Security Fixes — Hardening September 2026

Hardening keamanan dikerjakan dalam tiga tahap:

1. **Pass audit A–F** (21–25 September) — berdasarkan prompt audit "Senior Application Security Engineer", ditambah pengetatan database 23 September.
2. **Keputusan pemilik** (26 September) — 10 poin yang di pass pertama berstatus "butuh keputusan" sudah diputuskan pemilik dan dikerjakan. Ringkasannya di [Keputusan pemilik](#keputusan-pemilik-26-september).
3. **Realtime & hosting demo** (26–27 September) — notifikasi realtime (Socket.IO) dan deploy ke Vercel (dua website) + Railway (API dan MySQL). Lihat [bagian G](#g-realtime--hosting).

Perbaikan bug logika bisnis ada di [`LOGIC_BUGS_FIX.md`](LOGIC_BUGS_FIX.md).

Batasan yang dipegang: **tidak mengubah alur bisnis utama, tidak menambah payment gateway, tidak menghapus fitur** — kecuali yang diputuskan sendiri oleh pemilik di tahap 2.

Arti status:

- **Diperbaiki** — kode diubah.
- **Sudah ada** — sudah benar sebelumnya; dicek langsung di kode dan diuji.
- **Tidak perlu** — tujuan poin itu sudah tercapai dengan cara lain, atau tidak berlaku di codebase ini (alasan di kolom keterangan).
- **Diputuskan tetap** — pemilik memutuskan tidak diubah.

## Cara memeriksa ulang

| Perintah (dari `api/`) | Hasil terakhir (26 Sep 2026) |
|---|---|
| `npm test` | 57/57 lulus — 16 aturan bisnis, 17 keamanan, 24 integrasi database |
| `npm run pentest` | 49/49 aman |
| `npm run db:audit` | 0 temuan |
| `npx prisma validate` | valid |
| `npm run build` di `public-web/` dan `admin-web/` | sukses |
| `npm audit` (ketiga paket) | 0 critical — rincian di [npm audit](#npm-audit) |

Tes integrasi (`tests/integrasi.test.js`) butuh MySQL hidup dan `DIRECT_URL` di `api/.env`; kalau database tidak bisa dihubungi, tes itu dilewati, bukan gagal. Semua data uji dibuat sendiri (berawalan `ZZ`/`zz_`, nomor HP `0800…`, jadwal tahun 2099) dan dihapus lagi di akhir. Pentest butuh akun uji — admin wajib 2FA, jadi `PENTEST_ADMIN_TOTP_SECRET` (kunci base32 2FA akun itu) juga harus diisi; lihat bagian "Database Lokal" di `AGENTS.md`.

## Status per poin

### A. QR meja

| Poin | Status | Keterangan |
|---|---|---|
| Token QR pakai HMAC | Sudah ada | HMAC-SHA256 dengan secret unik per meja (`tables.token_secret`), dibandingkan dengan `crypto.timingSafeEqual`. Admin bisa me-reset QR satu meja kapan saja tanpa mengganggu meja lain. |
| Token kedaluwarsa (`expires_at` + nonce) dan rotasi harian | Diputuskan tetap | Keputusan #1: QR dicetak dan ditempel di meja; tetap statis per meja dengan reset per meja. |
| Middleware `qrGuard` + cek open bill atomik | Tidak perlu | Semua route publik bertoken meja (menu meja, bill, order, panggil staff, cek nomor member) lewat satu fungsi, `tableService.verifyToken` (format, meja aktif, HMAC). Bill disimpan di baris meja itu sendiri (`isBillOpen`, `currentVisitStartedAt`), jadi satu meja secara struktur tidak bisa punya dua bill aktif. |
| Info meja di web publik (cegah QR palsu) | Sudah ada | Halaman menu menampilkan nomor meja. Token tebakan dan token asli + karakter tambahan ditolak 404 (pentest #6). |

### B. Member & data pribadi

| Poin | Status | Keterangan |
|---|---|---|
| Cek nomor HP tidak mengembalikan nama | Sudah ada, **diperketat** | Tanpa verifikasi OTP, checkout hanya menyebut "poin masuk ke nomor ini" — tanpa nama, tier, maupun saldo poin. Lihat [rincian 11](#11-otp-member-keputusan-2). |
| Batas enumerasi nomor member | **Diperbaiki** | Batas 15 cek/menit bisa dilewati dengan dua cara. Lihat [rincian 1](#1-batas-enumerasi-nomor-member). |
| OTP + captcha sebelum diskon member | **Diperbaiki** | OTP 6 digit; captcha diganti batas per nomor, per perangkat, dan per hari. [Rincian 11](#11-otp-member-keputusan-2). |
| Index unik nomor HP | Sudah ada | Lewat sidik HMAC `customers.telepon_hash` `@unique`. Nomor dibakukan dulu (`0812…`), jadi "+62 812-…" dan "0812 …" tetap satu member. |
| Enkripsi nomor HP di database | **Diperbaiki** | AES-256-GCM + blind index. [Rincian 12](#12-enkripsi-nomor-hp-keputusan-3). |

### C. Order & pembayaran

| Poin | Status | Keterangan |
|---|---|---|
| ID publik `nanoid(16)` + PIN/4 digit HP untuk melacak order | **Diperbaiki** (dengan cara lain) | Token perangkat tersembunyi — kode order tetap, customer tidak mengetik apa pun. [Rincian 13](#13-pelacakan-order-terikat-perangkat-keputusan-4). |
| Pembuatan order dalam `$transaction` + stok atomik | Sudah ada | `UPDATE … WHERE stok >= qty` di dalam transaksi (AGENTS.md aturan 11). Tes: "stok: dua pembeli berebut stok terakhir". |
| Validasi silang varian ↔ produk | Sudah ada | `resolveProductVariants` menolak varian milik produk lain (400). Tes: "varian silang". |
| QRIS: tidak bisa ke `cooking` sebelum diverifikasi | **Diperbaiki** | Tabel transisi status order ([rincian 3](#3-tabel-transisi-status-order)). PIN untuk pembayaran besar: [rincian 14](#14-pin-untuk-pembayaran-besar-keputusan-5). |
| Bukti bayar tidak di folder publik, validasi MIME | Sudah ada | `api/uploads/` tidak di-serve statis; bukti bayar hanya lewat `GET /api/admin/orders/:id/bukti-bayar` (login + peran). Isi file diperiksa (magic bytes), maks 2 MB, nama `randomUUID()`. Di hosting disimpan di database, bukan S3/R2: [rincian 19](#19-upload-di-hosting-database). |

### D. Webhook & API key

| Poin | Status | Keterangan |
|---|---|---|
| API key di-hash, teks asli ditampilkan sekali | Sudah ada | SHA-256; teks asli hanya di respons pembuatan. Tes integrasi. |
| `ssrfSafeFetch` | **Diperbaiki** | Lihat [rincian 4](#4-ssrf-pada-webhook). |
| API key tidak pernah lewat query | Sudah ada | Hanya header `Authorization: Bearer …`; `req.query` tidak pernah dibaca. Nama header tidak diganti ke `X-API-Key` — sama-sama header, dan mengganti namanya memutus integrasi luar yang sudah memakai API key. |

### E. Admin

| Poin | Status | Keterangan |
|---|---|---|
| Session store + cookie `__Host-popside.sid` | **Diperbaiki** | Lihat [rincian 5](#5-sesi-disimpan-di-mysql). Redis tidak dipakai — tidak ada di tech stack AGENTS.md; tujuannya (sesi tidak hilang saat restart, tidak menumpuk di memori) tercapai dengan MySQL. |
| `helmet` + HSTS | Sudah ada | CSP, HSTS, X-Frame-Options, nosniff (pentest #11). Di hosting, header yang sama dipasang Vercel untuk kedua frontend ([rincian 21](#21-hosting-demo-vercel--railway)). |
| `trust proxy` yang benar | **Diperbaiki** | Lihat [rincian 6](#6-trust-proxy). |
| RBAC di setiap route admin | Sudah ada | `requireRole` di setiap router admin (tes memeriksa semua file route); kasir mendapat 403 di endpoint khusus admin (pentest #3); hapus produk khusus admin. |
| PIN void: per akun, 3x salah kunci 15 menit, tercatat | **Diperbaiki** | Lihat [rincian 7](#7-pin-void). |
| Kunci rate limit login | **Diperbaiki** | Lockout login bisa dilewati dengan spasi di username. Lihat [rincian 2](#2-kunci-rate-limit-dibakukan). |
| 2FA TOTP untuk admin | **Diperbaiki** | Wajib untuk semua admin. [Rincian 15](#15-2fa-totp-untuk-admin-keputusan-6). |
| DOMPurify untuk `v-html` | Tidak perlu | Tidak ada `v-html` sama sekali di kedua frontend (AGENTS.md aturan 13); Vue meng-escape semua `{{ }}`. |
| Excel: awalan `'` untuk isian yang diawali `= + - @` | Tidak perlu | Ekspor laporan berformat XLSX lewat `exceljs`, yang menulis teks sebagai string, bukan formula — Excel tidak menjalankannya. Menambahkan `'` di XLSX malah tampil sebagai karakter di sel. Ekspor CSV (yang memang rawan formula injection) sudah tidak ada. |

### F. Validasi & log

| Poin | Status | Keterangan |
|---|---|---|
| Semua schema zod `.strict()` | **Diperbaiki** | [Rincian 16](#16-zod-strict-di-semua-schema-keputusan-7). |
| Redaksi log | **Diperbaiki** | Lihat [rincian 8](#8-log). |
| Log audit append-only dengan trigger DB | **Diperbaiki** | Log aktivitas order ([rincian 9](#9-log-aktivitas-append-only)) dan tabel audit untuk semua aksi staff ([rincian 17](#17-log-audit-semua-aksi-staff-keputusan-8)). |

### G. Realtime & hosting

| Poin | Status | Keterangan |
|---|---|---|
| Kanal WebSocket staff tanpa login | Aman | Token bertanda tangan 60 detik dari route yang butuh sesi + 2FA. [Rincian 20](#20-realtime-socketio). |
| Koneksi WebSocket dari situs lain | Aman | Origin dicek di setiap koneksi baru (pentest #16). |
| Banjir koneksi / pesan WebSocket | Aman | Maks 1.000 koneksi sekaligus, pesan maks 10 KB, maks 10 order per koneksi. |
| Status order orang lain lewat realtime | Aman | Hanya perangkat pemesan yang bisa berlangganan (pentest #14). |
| Cookie sesi di domain hosting yang berbeda | Aman | `/api` diteruskan Vercel → cookie tetap first-party `__Host-`, `sameSite=strict`. [Rincian 21](#21-hosting-demo-vercel--railway). |
| IP palsu lewat `X-Forwarded-For` | Aman | Batas yang paling penting tidak bergantung IP. |
| Disk hosting tidak permanen | Aman | `UPLOAD_DRIVER=database`. [Rincian 19](#19-upload-di-hosting-database). |
| Rahasia produksi | Aman | Dibuat acak oleh skrip penyiapan, dikirim ke variabel Railway lewat stdin — tidak pernah di repo, layar, maupun chat. |
| Database hosting | Aman | MySQL Railway hanya di jaringan privat (tidak ada alamat internet); akun aplikasi hanya DML (tabel log: baca + tambah saja). |

## Rincian perbaikan

### 1. Batas enumerasi nomor member

Batas 15 cek nomor/menit di checkout publik dikunci per (IP + token meja), tapi bisa dilewati dengan dua cara:

- `token` meja di `POST /api/public/cart/total` **tidak pernah divalidasi** — hanya dipakai sebagai kunci rate limit. Token karangan yang berbeda tiap request selalu mendapat jatah baru, sehingga batas praktisnya kembali ke limiter umum (60/menit/IP, sekitar 3.600 nomor per jam).
- Kunci limiter dibaca sebelum validator men-`trim` token, jadi token asli + spasi di ujung juga dihitung sebagai jatah baru.

Sekarang nomor HP hanya dijawab untuk token meja yang sah (token lain ditolak 404, sama seperti saat membuat order), dan kunci limiter dibakukan persis seperti validator. Checkout publik tidak berubah: halaman checkout memang selalu mengirim token mejanya. Total keranjang tanpa nomor HP tetap bisa dihitung tanpa token.

File: `api/src/services/cart.service.js`, `api/src/controllers/cart.controller.js`, `api/src/middleware/rateLimit.js`. Tes: integrasi "cek nomor member: hanya dijawab untuk token meja yang sah"; pentest #13 (token palsu, spasi di token, batas 16 percobaan).

### 2. Kunci rate limit dibakukan

Semua limiter berjalan **sebelum** validasi, sementara validator men-`trim` isian. Akibatnya `"admin"`, `"admin "`, `"admin  "` lolos validasi sebagai akun yang sama tapi dihitung sebagai jatah terpisah — lockout 5x gagal login bisa dilewati tanpa batas hanya dengan menambah spasi. Hal yang sama berlaku untuk limiter per meja (buat order, panggil staff, cek nomor member).

Kunci login sekarang `trim` + huruf kecil (sesuai collation MySQL `_ci`); kunci per meja/kode order ikut di-`trim`. File: `api/src/middleware/rateLimit.js`. Tes: pentest #2 ("spasi tambahan di username tidak memberi jatah percobaan baru") dan #13.

### 3. Tabel transisi status order

`api/src/utils/orderStatus.js` punya tabel `TRANSITIONS` + `canTransition(dari, ke)`, dan semua perubahan status di `orderManagement.service.js` (`updateStatus`, `confirmPayment`) lewat situ:

| Dari | Boleh ke |
|---|---|
| `pending` | `waiting_verif`, `confirmed`, `cancelled` |
| `waiting_verif` | `confirmed`, `cancelled` |
| `confirmed` | `cooking`, `cancelled` |
| `cooking` | `ready`, `cancelled` |
| `ready` | `completed`, `cancelled` |
| `completed`, `cancelled` | — (final) |

Order yang sudah selesai tidak bisa di-void, status tidak bisa melompat, dan status tak dikenal selalu ditolak. Void order yang sudah dibayar tetap butuh PIN. Tes: tiga tes "status order", integrasi "void order lunas".

### 4. SSRF pada webhook

`kirimAman()` di `api/src/utils/ssrfGuard.js`, dipakai `webhook.service.js` menggantikan `fetch()`:

- Alamat IP diperiksa **pada saat koneksi dibuat** (opsi `lookup`), bukan hanya saat webhook didaftarkan — celah DNS rebinding (jawaban DNS pertama IP publik, jawaban berikutnya IP internal) tertutup.
- Semua rentang yang diminta (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 0.0.0.0, ::1, fc00::/7) plus CGNAT, benchmark, multicast, dan reserved.
- IPv6 dibaca per blok, bukan dicocokkan sebagai teks: bentuk yang menyelipkan IPv4 (mapped, compatible, NAT64, 6to4) dinilai dari IPv4 di dalamnya; `fe80::/10`, `fec0::/10`, `ff00::/8`, Teredo, dan alamat dokumentasi ikut ditolak; alamat yang tidak bisa dibaca ditolak.
- Batas waktu 3 detik. Redirect **tidak diikuti sama sekali** (lebih ketat dari "maks 1 redirect"). Isi balasan tidak pernah dibaca, jadi batas 1 MB tidak diperlukan.

Tes: tiga tes "webhook (SSRF)" — termasuk `http://2130706433/`, `http://0x7f.1/`, `http://[::ffff:127.0.0.1]/`, dan `64:ff9b::7f00:1`.

### 5. Sesi disimpan di MySQL

- `MemoryStore` bawaan diganti `PrismaSessionStore` (`api/src/utils/sessionStore.js`, tabel `sessions`, migrasi `20260925090000_sesi_di_database`). Sesi tidak hilang saat API restart dan tidak menumpuk di memori; sesi kedaluwarsa dibersihkan berkala. Perpanjangan masa sesi ditulis ke database paling sering sekali per menit per sesi (bukan di setiap request), supaya layar yang aktif tidak membebani database.
- Di produksi cookie bernama `__Host-popside.sid`: wajib HTTPS, tanpa `Domain`, `Path=/` — subdomain lain tidak bisa menimpanya. Tetap `httpOnly`, `sameSite=strict`, idle timeout 30 menit, session id diganti saat login.
- Ditemukan saat pass ini: logout menghapus cookie `popside.sid`, padahal di produksi namanya `__Host-popside.sid`. Nama cookie sekarang satu sumber (`api/src/utils/session.js`), dan logout menghapusnya dengan atribut yang sama.

Tes: "sesi: tersimpan di database…", "logout: menghapus cookie sesi…".

### 6. trust proxy

`app.set('trust proxy', …)` sekarang hanya aktif kalau `TRUST_PROXY` diisi di `.env` (jumlah hop proxy, biasanya `1`). Tanpa reverse proxy, biarkan kosong: `trust proxy` yang aktif tanpa proxy membuat klien bisa memalsukan IP lewat header `X-Forwarded-For` dan lolos dari semua rate limit. Hosting demo memakai `2` (Vercel → Railway); akibatnya bagi yang menembak Railway langsung, lihat [rincian 21](#21-hosting-demo-vercel--railway). Tes: "trust proxy: mati kecuali diatur lewat TRUST_PROXY".

### 7. PIN void

Dihitung per akun staff (bukan per IP): 3x salah dalam 15 menit → akun itu terkunci 15 menit penuh. Setiap PIN salah, penguncian, dan percobaan saat terkunci dicatat di log server (id akun — PIN-nya tidak pernah ikut tercatat). Void yang berhasil tercatat di log aktivitas order (append-only). File: `api/src/utils/pinAttempts.js`, `api/src/services/user.service.js`. Tes: "PIN void: 3x salah terkunci 15 menit, per akun", integrasi "void order lunas".

### 8. Log

Header `authorization`, `cookie`, `set-cookie`, `x-csrf-token`, dan `x-api-key` disensor. Nomor HP di URL dan query (mis. pencarian member) ditulis sebagian saja: `0812******88`. Bukti bayar tidak pernah masuk log (body upload tidak dicatat). File: `api/src/utils/logger.js`, `api/src/app.js`. Tes: "log: nomor HP disamarkan…".

### 9. Log aktivitas append-only

Tabel `order_status_log` (halaman Riwayat Aktivitas) dijaga trigger database (migrasi `20260925091000_log_status_append_only`): `UPDATE` selalu ditolak, `DELETE` ditolak untuk semua akun kecuali akun perawatan `popside_migrate` (dipakai pentest untuk menghapus order uji buatannya sendiri). Akun aplikasi tidak bisa mengubah atau menghapus jejak siapa mengubah status apa, walau ada celah di aplikasi.

Migrasi ini harus dijalankan sekali sebagai `root` (MySQL 8 dengan binary log mewajibkan hak SUPER untuk membuat trigger) — perintahnya tertulis di file migrasinya. Di MySQL terkelola (Aiven) yang tidak mengizinkan trigger, perlindungan yang sama dipasang lewat hak akses tabel: akun aplikasi hanya punya `SELECT` + `INSERT` di tabel log ([rincian 21](#21-hosting-demo-vercel--railway)). Tes: integrasi "log aktivitas: akun aplikasi tidak bisa mengubah atau menghapus log".

### 10. Database (pengetatan 23 September)

Rinciannya di `AGENTS.md` bagian "Database Lokal":

- Tiga akun MySQL: `popside_app` (API — hanya SELECT/INSERT/UPDATE/DELETE, tidak bisa DDL), `popside_migrate` (migrasi), `root` (Laragon).
- MySQL hanya mendengarkan `127.0.0.1` (port 3306 dan 33060), `secure-file-priv=NULL`.
- `scripts/audit-db.js` (`npm run db:audit`): pemeriksaan kesehatan data, baca-saja, tanpa interpolasi SQL.
- `scripts/pentest.js`: data uji dibersihkan lewat akun perawatan; kalau skrip terputus di tengah, data uji tetap dibersihkan.

### 11. OTP member (keputusan #2)

- Diskon tier member di checkout publik baru berlaku setelah nomor diverifikasi kode 6 digit yang dikirim ke nomor itu lewat gateway WhatsApp/SMS (`api/src/utils/pengirimOtp.js`, `api/src/services/memberOtp.service.js`).
- Kode hanya dikirim untuk nomor yang memang member bertier — nomor karangan tidak memicu pesan, jadi fitur ini tidak bisa dipakai untuk menghabiskan pulsa/biaya gateway ("SMS pumping").
- Kode berlaku 5 menit, sekali pakai, disimpan sebagai sidik HMAC (bukan teks asli); salah 5x → kode hangus.
- Batas: 3 permintaan/10 menit dan 10/hari per nomor, 10/jam per perangkat, 15 percobaan verifikasi/10 menit, dan batas harian seluruh toko (`OTP_BATAS_HARIAN`, bawaan 200).
- Setelah lolos, perangkat itu diingat 2 jam lewat cookie bertanda tangan `__Host-popside_member` (`httpOnly`, `sameSite=strict`).
- Tanpa verifikasi tidak ada diskon, nama, tier, maupun saldo poin yang ditampilkan; poin pesanan tetap masuk ke nomor itu setelah dibayar.
- Tanpa gateway, fitur ini mati dengan aman: checkout tidak menawarkan verifikasi, dan diskon member diberikan kasir lewat Pesanan Manual. Mode `OTP_PENGIRIM=console` (kode ditulis ke log API) hanya untuk pengembangan dan otomatis mati di `NODE_ENV=production`.
- Captcha tidak dipasang (layanan pihak ketiga); perannya diganti batas-batas di atas.

Tes: integrasi "OTP member: kode hanya untuk member bertier, sekali pakai, salah 5x hangus", "OTP member: tanpa verifikasi tidak ada diskon, detail member, maupun saldo poin"; security "OTP: mode console mati di produksi…".

### 12. Enkripsi nomor HP (keputusan #3)

- Nomor HP member dan reservasi disimpan terenkripsi AES-256-GCM dengan IV acak (`DATA_ENC_KEY`, `api/src/utils/kripto.js`); rahasia 2FA admin juga.
- Pencarian nomor persis lewat sidik HMAC-SHA256 (`DATA_HASH_KEY`) — blind index `telepon_hash` yang unik. Pencarian staff "…7890" lewat 4 digit terakhir (`telepon_akhir`); pencarian potongan di tengah nomor tidak bisa lagi.
- API menolak start kalau kunci tidak ada, bukan 32 byte, atau keduanya sama.
- Data yang sudah ada dienkripsi dengan `npm run db:enkripsi-telepon`.
- **Kunci hilang = nomor tidak bisa dibaca lagi.** Simpan salinannya terpisah dari backup database. Di hosting, kunci ada di variabel Railway, dan cadangannya ditulis skrip penyiapan ke folder Documents pemilik.

Tes: security "enkripsi: …" (3 tes); integrasi "nomor HP member: tidak ada nomor polos di database, tetap bisa dicari", "reservasi: nomor HP customer tersimpan terenkripsi".

### 13. Pelacakan order terikat perangkat (keputusan #4)

- Saat memesan, HP pemesan mendapat cookie tersembunyi `__Host-popside_perangkat` (acak 32 byte, `httpOnly`, `sameSite=strict`, 24 jam); order menyimpan sidik HMAC-nya, bukan cookie-nya.
- Halaman status, kirim bukti bayar, dan langganan realtime hanya dijawab untuk perangkat itu. Perangkat lain — walaupun kodenya benar — mendapat 404.
- Kode order tidak berubah (tetap dibacakan ke kasir, AGENTS.md aturan 10), customer tidak mengetik apa pun, dan tidak ada yang disimpan di `localStorage`.
- Karena menebak kode tidak lagi berguna, batas cek status per IP dilonggarkan 30 → 300/menit (satu WiFi kafe dipakai banyak HP sekaligus). Batas 5/menit per (IP + kode order) dari AGENTS.md tetap.

Tes: integrasi "pelacakan order: hanya dari perangkat pemesan (token tersembunyi)"; pentest #14.

### 14. PIN untuk pembayaran besar (keputusan #5)

- Menandai lunas pesanan mulai nominal tertentu wajib PIN **staff yang mengonfirmasi** — sesi kasir yang tertinggal terbuka di tablet tidak cukup.
- Batasnya diatur admin di Pengaturan → Keamanan Pembayaran: mulai Rp X (bawaan Rp 200.000), setiap pembayaran, atau tidak pernah. Nilainya dari database, bukan dari request.
- Salah PIN dihitung bersama PIN void: 3x dalam 15 menit → akun itu terkunci 15 menit.
- Layar kasir langsung meminta PIN di dialog konfirmasi (server mengirim `perluPinKonfirmasi`), jadi kasir tidak perlu mencoba dulu lalu ditolak.
- Penyimpanan bukti bayar di hosting: database, bukan S3/R2 — tidak perlu akun cloud tambahan ([rincian 19](#19-upload-di-hosting-database)).

Tes: integrasi "konfirmasi pembayaran: di atas batas wajib PIN staff, di bawahnya tidak"; diuji juga lewat web (PIN salah ditolak, PIN benar lunas).

### 15. 2FA TOTP untuk admin (keputusan #6)

- Semua akun admin wajib 2FA (TOTP RFC 6238 — Google Authenticator, Authy, dll). Dipasang saat login pertama (QR + kunci manual), lalu keluar 8 kode cadangan sekali pakai (disimpan sebagai sidik).
- Kode yang sudah dipakai tidak bisa dipakai ulang; password yang benar saja belum login (sesi menunggu kode, 5 menit); percobaan dibatasi.
- Sesi admin tanpa 2FA ditolak di semua endpoint (`PERLU_2FA`) — termasuk sesi lama sebelum fitur ini ada.
- Kasir tidak wajib 2FA (belum ada layar untuk memasangnya sendiri); pemeriksaannya di server sudah berlaku untuk akun apa pun yang 2FA-nya aktif, jadi kalau kelak diwajibkan untuk kasir, cukup mengubah aturan `wajib2fa`.
- Admin bisa me-reset 2FA akun lain dari halaman Akun Staff. Jalan terakhir kalau semua admin kehilangan HP dan kode cadangan: `npm run reset-2fa -- <username>` (butuh akses server + `.env`).

Tes: security "2FA TOTP: cocok dengan test vector resmi RFC 6238"; integrasi "2FA admin: wajib dipasang, kode sekali pakai, kode cadangan, sesi tanpa 2FA ditolak"; pentest #2b.

### 16. zod strict di semua schema (keputusan #7)

- Semua schema request memakai `z.strictObject`: field yang tidak dikenal ditolak 400 ("Field tidak dikenal: …"), bukan dibuang diam-diam.
- Semua layar kedua frontend diuji ulang dengan aturan ini sebelum diaktifkan.
- Tes penjaga gagal kalau ada schema baru yang lupa strict.

Tes: logic "validasi strict: setiap schema request menolak field yang tidak dikenal"; pentest #9.

### 17. Log audit semua aksi staff (keputusan #8)

- Tabel `audit_log`: setiap aksi tulis staff (`POST/PUT/PATCH/DELETE`) dan `GET` yang sensitif (ekspor laporan, melihat bukti bayar) — siapa, peran, aksi, hasil (berhasil/ditolak), IP, waktu.
- Isi request ikut dicatat setelah disensor: field bernama pass/pin/kode/secret/token/otp/csrf menjadi `[disamarkan]`, nomor HP disamarkan, teks dipotong 4.000 karakter.
- Append-only: trigger database (migrasi `20260926093000_audit_log_append_only`), atau hak akses tabel di MySQL terkelola ([rincian 21](#21-hosting-demo-vercel--railway)).
- Halaman Log Audit khusus admin (filter tanggal & hasil); kasir mendapat 403.

Tes: integrasi "log audit: aksi staff tercatat tanpa rahasia; akun aplikasi tidak bisa mengubah/menghapusnya"; pentest #15.

### 18. DP reservasi di bawah aturan toko (keputusan #9)

Mengurangi atau membebaskan DP di bawah aturan toko hanya boleh admin, dengan alasan wajib (min 3 karakter) yang tampil di daftar reservasi dan tercatat di log audit. Kasir ditolak 403; layar kasir mengunci tombol Simpan dan menjelaskan alasannya.

Tes: integrasi "reservasi: DP di bawah aturan toko hanya boleh admin, wajib alasan"; diuji juga lewat web (kasir memanggil API langsung melewati layar → 403).

### 19. Upload di hosting: database

- Disk container hosting (Render maupun Railway) tidak permanen. `UPLOAD_DRIVER=database` menyimpan foto menu, QRIS, dan bukti bayar di tabel `berkas_upload` (`MEDIUMBLOB`) — aturan upload sama persis: magic bytes, maks 2 MB, nama acak, dan kategori file tidak bisa ditukar.
- Bukti bayar dikirim dengan `Cache-Control: private, no-store`, hanya lewat route ber-login. Foto menu/QRIS publik boleh di-cache (immutable + ETag).

File: `api/src/lib/imageStore.js`. Tes: integrasi "upload mode database: aturan sama, bukti bayar tidak di-cache, kategori tidak bisa ditukar".

### 20. Realtime (Socket.IO)

- Kanal `/staff`: token bertanda tangan berumur 60 detik dari `GET /api/admin/realtime/token` (butuh sesi + 2FA, `requireRole`); akun yang dinonaktifkan diputus dalam 5 menit.
- Kanal `/publik`: tanpa token hanya menerima status buka/tutup kafe. Status order hanya untuk perangkat pemesan (token dari route pelacakan, [rincian 13](#13-pelacakan-order-terikat-perangkat-keputusan-4)); maks 10 order per koneksi.
- Origin dicek untuk setiap koneksi baru (situs lain ditolak), pesan di atas 10 KB memutus koneksi, dan maksimal 1.000 koneksi sekaligus di seluruh server — lewat dari itu koneksi baru ditolak dan layar tetap jalan lewat polling cadangan. Batas per IP sengaja tidak dipakai: IP asli klien WebSocket di hosting tidak bisa dipastikan.
- Isi event minimal (id, kode order, status) — tanpa nama, nomor, atau total.

File: `api/src/realtime.js`. Tes: integrasi "realtime: staff butuh token sah; customer hanya bisa berlangganan order miliknya", "realtime: jumlah koneksi dibatasi, origin asing & pesan raksasa ditolak"; pentest #16 (7 serangan).

### 21. Hosting demo (Vercel + Railway)

- Kedua frontend memanggil `/api` di domainnya sendiri, lalu Vercel meneruskannya ke Railway (rewrite di `vercel.json`). Cookie sesi, CSRF, dan cookie perangkat tetap first-party `__Host-` + `sameSite=strict` — tidak perlu dilonggarkan ke `SameSite=None` (dicek di produksi: `__Host-popside.sid` dan `__Host-popside.csrf-token` terpasang `HttpOnly; Secure; SameSite=Strict` di domain website). WebSocket langsung ke Railway dengan token ([rincian 20](#20-realtime-socketio)); di produksi, origin kedua website tersambung dan origin lain ditolak.
- Header dari Vercel: CSP ketat (`script-src 'self'` + hash satu-satunya skrip inline, `connect-src` hanya domain sendiri dan API), HSTS, `X-Frame-Options: DENY`, nosniff, Permissions-Policy.
- `TRUST_PROXY=2`. Siapa pun yang menembak Railway langsung bisa memalsukan `X-Forwarded-For`, jadi batas yang paling penting tidak bergantung IP: gagal login 20/15 menit per username, order 20/10 menit per meja, panggil staff 10/10 menit per meja, OTP per nomor. Service API dikunci 1 replika, karena batas-batas itu dan kunci PIN disimpan di memori proses.
- Rahasia (`SESSION_SECRET`, `CSRF_SECRET`, `QR_HMAC_SECRET`, `DATA_ENC_KEY`, `DATA_HASH_KEY`) dibuat acak 32 byte oleh `scripts/siapkan-produksi.js --railway` dan dikirim ke variabel Railway satu per satu lewat stdin — tidak pernah muncul di layar, argumen perintah, repo, maupun chat. Cadangannya ditulis ke folder Documents pemilik. Skrip menolak berjalan lagi kalau service sudah punya kunci, supaya kunci tidak pernah tertimpa (kunci baru = data terenkripsi hilang).
- Database produksi: MySQL Railway di region yang sama dengan API, **hanya bisa dijangkau lewat jaringan privat Railway** (`mysql.railway.internal`) — lebih tertutup dibanding database terkelola yang terbuka ke internet. Akun `popside_app` (DML saja; tabel log hanya `SELECT` + `INSERT`) dan `popside_migrate` dengan password acak; diuji sebelum dipakai: akun aplikasi bisa membaca data, tidak bisa mengubah `audit_log`. Untuk memindahkan data dari Aiven, dibuka TCP proxy sementara (koneksi TLS), lalu dihapus dan dipastikan tertutup.
- Database cadangan Aiven (Bengaluru): TLS dengan verifikasi sertifikat CA Aiven (`sslaccept=strict`), path sertifikat dibuat absolut untuk Prisma Client (`api/src/utils/urlDatabase.js`) karena penafsiran path relatif saat runtime berbeda antar OS. Tidak dipakai lagi sejak 27 September (±240 ms per query dari Railway Singapura).
- Data yang disalin dari laptop (`prisma/data-demo.json`) hanya menu, meja (token QR dibuat ulang), tier, dan info toko publik — tanpa member, order, akun, log, atau harga modal. File ini ikut di repo publik, jadi tidak boleh memuat data pribadi. `api/.railwayignore` memastikan `.env` lokal dan folder `uploads/` (bukti bayar) tidak ikut terunggah saat deploy.

Pemeriksaan produksi (27 September): health, pengaturan toko, menu, gambar menu & QRIS dari database, cookie `__Host-`, WebSocket (origin sah tersambung, origin lain ditolak), dan *path traversal* di route gambar (404). Rata-rata respons lewat domain website 0,13–0,17 detik. Tes: security "database hosting: sertifikat CA dibaca dari folder prisma/, TLS tetap diverifikasi", "sesi: … cookie __Host- …".

## npm audit

Tidak ada temuan critical di ketiga paket. `npm audit fix` (tanpa `--force`) tidak bisa mengubah apa pun, karena semua "perbaikan" yang ditawarkan npm adalah **penurunan** versi major. `npm audit fix --force` sengaja tidak dijalankan. Diperiksa ulang 26 September — temuannya sama.

| Paket | Temuan | Dampak di aplikasi ini |
|---|---|---|
| `api`: `prisma` → `@prisma/config` → `deepmerge-ts` | high | CLI Prisma (devDependency), hanya menggabungkan config milik sendiri di mesin developer/saat build — tidak ikut berjalan di API dan tidak menerima input luar. "Perbaikan" npm = turun ke `prisma` 6.12.0, tidak cocok dengan `@prisma/client` 6.19.3. |
| `api`: `exceljs` → `uuid` | moderate | Celahnya hanya terjadi kalau argumen `buf` dipakai; `exceljs` memanggil `uuidv4()` tanpa argumen. "Perbaikan" = turun ke `exceljs` 3.4.0. |
| `public-web`, `admin-web`: `shadcn-vue` (7 paket turunan) | moderate | CLI untuk menambah komponen (devDependency), tidak diimpor kode aplikasi dan tidak masuk bundle (`npm audit --omit=dev`: 0 temuan). "Perbaikan" = turun ke 0.10.5. |

## Dicatat, sengaja tidak diubah

- **Lockout login 5x gagal per 1 menit** (AGENTS.md aturan 8 menyebut 15 menit): sengaja, atas permintaan pemilik — tercatat di `api/src/middleware/rateLimit.js`. Setelah [rincian 2](#2-kunci-rate-limit-dibakukan), variasi spasi atau huruf besar di username tidak lagi memberi jatah baru. Di hosting ada tambahan batas per username yang tidak bergantung IP ([rincian 21](#21-hosting-demo-vercel--railway)).
- **QR statis per meja** — keputusan #1.
- **Batas diskon manual kasir** — keputusan #10: tetap bisa diatur 0–100% dengan alasan tercatat.
- **Nama header API key** — lihat bagian D.
- **Redis, DOMPurify, awalan `'` di Excel** — lihat bagian E.
- **Konversi upload ke `.webp`**: AGENTS.md aturan 6 menetapkan nama `randomUUID()` + ekstensi asli (diambil dari isi file, bukan dari nama yang dikirim), dan konversi butuh library pengolah gambar baru.
- **Batas koneksi WebSocket per IP** — alasannya di [rincian 20](#20-realtime-socketio).

## Keputusan pemilik (26 September)

Sepuluh poin yang di pass pertama berstatus "butuh keputusan", beserta keputusan pemilik dan hasilnya. Permintaan tambahan pemilik — kecepatan dan stabilitas tanpa lag untuk notifikasi, aksi, dan transaksi — dijawab dengan notifikasi realtime ([rincian 20](#20-realtime-socketio)); detail performanya ada di `LOGIC_BUGS_FIX.md` bug [14].

| # | Poin | Keputusan | Hasil |
|---|---|---|---|
| 1 | QR kedaluwarsa dan rotasi harian | Tetap seperti sekarang | Tidak diubah — QR statis, reset per meja |
| 2 | OTP sebelum diskon member | Pakai OTP, tanpa risiko yang dijelaskan | [Rincian 11](#11-otp-member-keputusan-2) |
| 3 | Enkripsi nomor HP | Enkripsi di database | [Rincian 12](#12-enkripsi-nomor-hp-keputusan-3) |
| 4 | Pelacakan order tanpa PIN | Token pelacakan tersembunyi | [Rincian 13](#13-pelacakan-order-terikat-perangkat-keputusan-4) |
| 5 | PIN verifikasi & penyimpanan bukti bayar | Solusi yang disarankan | [Rincian 14](#14-pin-untuk-pembayaran-besar-keputusan-5), [19](#19-upload-di-hosting-database) |
| 6 | 2FA TOTP untuk admin | Dikerjakan sebelum admin dibuka di internet | [Rincian 15](#15-2fa-totp-untuk-admin-keputusan-6) |
| 7 | zod `.strict()` | Cara yang disarankan | [Rincian 16](#16-zod-strict-di-semua-schema-keputusan-7) |
| 8 | Tabel audit semua aksi admin | Cara yang disarankan | [Rincian 17](#17-log-audit-semua-aksi-staff-keputusan-8) |
| 9 | Pembebasan DP reservasi | Cara yang disarankan | [Rincian 18](#18-dp-reservasi-di-bawah-aturan-toko-keputusan-9) |
| 10 | Batas diskon manual kasir | Tetap bisa diatur, jangan diubah | Tidak diubah |

### Yang masih menunggu

- **Gateway WhatsApp/SMS untuk OTP di produksi** — butuh akun gateway atas nama toko (isi `OTP_PENGIRIM=http` + `OTP_HTTP_*` di variabel Railway). Sampai itu ada, diskon member lewat kasir.
- **Cadangan kunci `DATA_ENC_KEY` & `DATA_HASH_KEY`** — file `popside-kunci-produksi-*.txt` di folder Documents pemilik; pindahkan ke password manager atau tempat aman lain, terpisah dari backup database.
