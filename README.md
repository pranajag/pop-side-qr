# Popside QR Ordering System

Sistem pemesanan berbasis scan QR untuk cafe/resto Popside. Customer duduk di meja, scan QR, pesan dan bayar sendiri dari HP — kasir/admin memproses pesanan lewat dashboard terpisah.

Monorepo ini terdiri dari 3 bagian yang saling terhubung ke satu database:

| Bagian | Folder | Untuk siapa | Butuh login? |
|---|---|---|---|
| **API** | [`api/`](api) | Backend Node.js + Express, dipakai kedua web di bawah | — |
| **Public Web** | [`public-web/`](public-web) | Customer — scan QR, pesan, bayar, tracking status | Tidak |
| **Admin Web** | [`admin-web/`](admin-web) | Kasir & Admin — proses pesanan, laporan, kelola menu | Ya |

## Fitur

**Customer (Public Web)**
- Scan QR meja → lihat menu → pesan (dengan varian produk kalau ada)
- Bayar QRIS (statis, tanpa payment gateway berbayar), tunai, atau debit
- Tracking status pesanan real-time + notifikasi saat makanan siap diambil
- Reservasi meja dengan deposit/DP
- Poin member otomatis dari nomor HP yang dipakai saat pesan

**Kasir & Admin (Admin Web)**
- Dashboard: omzet, jumlah order, void, toggle open bill per meja
- Konfirmasi pembayaran & progres pesanan (cooking → ready → completed)
- Pesanan manual/takeaway, termasuk split bill per orang
- Manajemen shift: clock in/out, nama staff bertugas, rekonsiliasi kas, pendapatan ojol (opsional)
- Program loyalitas: tier poin → diskon yang bisa diatur staff sendiri (opsional, dibatasi maks 25%)
- Laporan dengan grafik + ekspor Excel/PDF/jurnal yang rapi
- Kelola kategori, produk (+ stok, varian), meja, akun staff (role admin/kasir)
- Riwayat aktivitas (audit log), API key & webhook untuk integrasi eksternal
- Pengaturan toko: identitas struk, tarif pajak/service charge

**Keamanan** (server-side, tidak cuma di UI)
- Session cookie (`httpOnly`, `secure`, `sameSite: strict`) + regenerate saat login, CSRF token di semua request mengubah data
- RBAC (`admin` vs `kasir`) di setiap route admin
- Rate limiting per IP dan per resource (login, buat order, cek status, API eksternal) + lockout setelah percobaan login gagal
- Password di-hash `bcrypt`, PIN terpisah untuk aksi sensitif (void order terbayar)
- Log redaction (header `Authorization`/`Cookie` tidak pernah masuk log mentah)
- SSRF guard untuk webhook keluar (blokir IP privat/internal, dicek ulang saat dispatch)
- Validasi schema (`zod`) di server untuk semua input — harga & total selalu dihitung ulang dari database, tidak pernah dipercaya dari frontend

## Tech Stack

| Layer | Pilihan |
|---|---|
| Frontend | Vue 3 (Composition API + `<script setup>`), Vite, Pinia, Vue Router, Tailwind CSS + shadcn-vue |
| Backend | Node.js + Express |
| Database / ORM | MySQL + Prisma |
| Auth | `express-session` (cookie-based) |
| Validasi | Zod |

## Menjalankan di Lokal

### Prasyarat
- Node.js 20+
- MySQL 8+ (server manapun — cukup pastikan `DATABASE_URL` di `.env` mengarah ke situ)

### 1. Clone

```bash
git clone https://github.com/pranajag/pop-side-qr.git
cd pop-side-qr
```

### 2. Siapkan database

Buat database & user MySQL untuk project ini:

```sql
CREATE DATABASE popside_qr CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'popside_app'@'localhost' IDENTIFIED BY 'password_pilihan_anda';
GRANT ALL PRIVILEGES ON popside_qr.* TO 'popside_app'@'localhost';
```

### 3. Jalankan API (backend)

```bash
cd api
npm install
cp .env.example .env
```

Isi minimal di `api/.env`:
- `DATABASE_URL` — connection string ke database di atas
- `SESSION_SECRET`, `CSRF_SECRET`, `QR_HMAC_SECRET` — generate masing-masing dengan:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

Lalu jalankan migrasi, seed akun awal, dan start server:

```bash
npx prisma migrate deploy
npm run db:seed
npm run dev
```

API berjalan di **http://localhost:3000**.

### 4. Jalankan Admin Web

```bash
cd admin-web
npm install
npm run dev
```

Buka **http://localhost:5173**, login pakai akun hasil seed (lihat di bawah).

### 5. Jalankan Public Web

```bash
cd public-web
npm install
npm run dev
```

Buka **http://localhost:5174**.

> Ketiga bagian (`api`, `admin-web`, `public-web`) harus jalan bersamaan (3 terminal terpisah) supaya sistem berfungsi penuh.

### Akun default (hasil `npm run db:seed`)

| Username | Password | Role |
|---|---|---|
| `admin` | `ChangeMe123!` | admin |
| `kasir1` | `ChangeMe123!` | kasir |

⚠️ Ganti password ini (lewat halaman Akun Staff di Admin Web, atau set `SEED_ADMIN_PASSWORD`/`SEED_KASIR_PASSWORD` di `.env` sebelum seed) sebelum dipakai di luar lingkungan development.

## Dokumentasi Lengkap

- [`AGENTS.md`](AGENTS.md) — konvensi teknis, aturan keamanan, struktur folder detail (ditulis untuk kontributor/AI coding agent)
- [`MEMORY.md`](MEMORY.md) — konteks bisnis: kenapa QRIS manual, format kode order, siklus status pesanan, dll
- [`docs/PRD.md`](docs/PRD.md), [`docs/PLANNING.md`](docs/PLANNING.md), [`docs/ERD_DFD.md`](docs/ERD_DFD.md), [`docs/UI_GUIDELINES.md`](docs/UI_GUIDELINES.md), [`docs/SECURITY_THREATS.md`](docs/SECURITY_THREATS.md)

## Lisensi

Proyek privat milik Pranaja. Tidak untuk didistribusikan ulang tanpa izin.
