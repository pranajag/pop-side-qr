# MEMORY.md — Konteks Bisnis Popside QR Ordering System

File ini isinya konteks BISNIS, bukan teknis (teknis ada di `AGENTS.md`). Tujuannya biar AI tidak lupa "kenapa" sistem ini bekerja seperti ini, terutama karena beberapa flow-nya tidak intuitif kalau cuma baca kode.

## Apa itu Popside

Popside adalah cafe/resto tempat sistem ini dipakai secara fisik — customer duduk di meja bernomor, scan QR yang ditempel di meja tersebut. (Catatan: nama & detail brand di sini masih asumsi dari nama folder project, sesuaikan kalau ada detail lain.)

## Aktor & Peran

- **Customer** — tidak punya akun/login. Identitasnya sementara, hanya terhubung ke meja yang di-scan + kode order yang didapat setelah checkout.
- **Kasir** — login ke admin web. Tugas utama: konfirmasi pesanan masuk, verifikasi pembayaran (terutama tunai/debit yang butuh konfirmasi manual, dan QRIS yang butuh cek mutasi manual), update status pesanan (cooking/ready/completed).
- **Admin** — login ke admin web, akses lebih luas dari kasir: kelola menu & kategori, kelola akun kasir, lihat laporan pendapatan harian. Semua yang bisa dilakukan kasir juga bisa dilakukan admin.

## Kenapa Pembayaran QRIS "Manual"

QRIS yang dipakai adalah QRIS STATIS milik toko (satu gambar QRIS yang sama untuk semua transaksi) — BUKAN QRIS dinamis dengan payment gateway yang punya callback otomatis. Konsekuensinya, flow-nya HARUS begini:

1. Customer checkout, pilih metode QRIS.
2. Sistem tampilkan gambar QRIS statis toko.
3. Customer scan & bayar lewat e-wallet/mobile banking apa pun.
4. Karena tidak ada callback, customer klik tombol "Saya sudah bayar" secara manual.
5. Status order berubah jadi `waiting_verif`.
6. Kasir cek mutasi masuk di rekening/aplikasi merchant secara manual, cocokkan nominal & waktu.
7. Kasir klik "Konfirmasi" di admin dashboard → status jadi `confirmed`.

Ini BUKAN bug atau kekurangan — ini keterbatasan yang disengaja karena tidak memakai payment gateway berbayar. Jangan pernah mencoba "mengotomatiskan" verifikasi QRIS kecuali user secara eksplisit minta integrasi payment gateway (Midtrans/Xendit, dll) di masa depan — itu perubahan scope besar, bukan bug fix.

Untuk **tunai** dan **debit**: customer checkout → dapat kode order → customer datang/panggil kasir → sebutkan kode order secara VERBAL → kasir cari order dengan kode itu di dashboard → kasir terima pembayaran fisik → kasir klik "Konfirmasi" → status `confirmed`.

## Format & Arti Kode Order

Format: `ORD-YYYYMMDD-XXXX`

- `YYYYMMDD` = tanggal order dibuat (timezone Asia/Jakarta, bukan UTC).
- `XXXX` = 4 karakter random, dari alfabet TANPA karakter ambigu (`0 O 1 I l` dikeluarkan), karena kode ini akan DIBACAKAN SECARA VERBAL oleh customer ke kasir, bukan sekadar dibaca dari layar.
- Kode ini adalah satu-satunya "identitas publik" yang dipegang customer untuk melacak order-nya — harus anti-tebak (bukan auto increment biasa).

## Status Order (siklus hidup)

`pending` → `waiting_verif` (khusus QRIS, menunggu customer klik "sudah bayar") atau langsung diproses kasir (tunai/debit) → `confirmed` (kasir/admin sudah verifikasi pembayaran) → `cooking` → `ready` → `completed`. Bisa juga masuk `cancelled` di titik mana pun sebelum `completed` (misal stok habis, customer batal).

Baseline siapa boleh mengubah ke status apa (cek ulang ke user sebelum implementasi RBAC final):

- `pending` → `waiting_verif`/`confirmed`: sistem otomatis (QRIS klik "sudah bayar") atau kasir (tunai/debit).
- `waiting_verif` → `confirmed`: HANYA kasir/admin, setelah cek mutasi manual.
- `confirmed` → `cooking` → `ready` → `completed`: kasir/admin, sesuai progres dapur.
- → `cancelled`: kasir/admin, dengan alasan (stok habis, dll).

## Stok

Tidak semua produk butuh tracking stok. Minuman yang dibuat on-demand (kopi, teh) biasanya `track_stock = false` karena tidak ada batasan fisik. Produk dengan kuantitas fisik terbatas (kue, pastry) `track_stock = true`, dan stoknya wajib dikurangi dalam transaksi database yang sama dengan pembuatan order (anti race condition kalau dua customer memesan item terakhir hampir bersamaan).

## "Pendapatan Hari Ini"

Dihitung berdasarkan `orders.created_at` dengan timezone Asia/Jakarta. Definisi pasti order mana yang dihitung sebagai "pendapatan" (sejak `confirmed`, atau baru saat `completed`) HARUS dikonfirmasi ke user sebelum dikodekan — jangan berasumsi. Yang jelas: order `pending`, `waiting_verif`, dan `cancelled` TIDAK dihitung sebagai pendapatan.

## Hal yang sering salah kalau AI lupa konteks ini

- Membuat QRIS "auto-confirm" tanpa keterlibatan kasir — ini keliru total, verifikasi QRIS harus manual.
- Membuat order code auto-increment atau mudah ditebak.
- Menghitung ulang / memercayai harga dari input frontend.
- Berasumsi semua produk punya stok terbatas.
- Menghitung "pendapatan hari ini" dengan timezone server (UTC) bukan Asia/Jakarta.
