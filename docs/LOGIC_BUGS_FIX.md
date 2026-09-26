# Logic Bugs Fix — 16 Bug

Hasil pengecekan dan perbaikan 16 bug logika bisnis dari prompt "fix 16 bug". Hardening keamanan ada di [`SECURITY_FIXES.md`](SECURITY_FIXES.md); arti status (**Diperbaiki**, **Sudah ada**, **Tidak perlu**, **Diputuskan tetap**) sama dengan di sana. Poin yang di pass pertama menunggu keputusan pemilik sudah diputuskan dan dikerjakan 26 September.

Setiap bug dicek langsung di kode. Dua race condition yang ditemukan di pass ini (booking meja, poin member) **dibuktikan dulu** dengan uji bersamaan sebelum diperbaiki, lalu diuji ulang sesudahnya; race buka shift terlihat langsung dari kodenya (cek lalu buat, tanpa kunci).

Pemeriksaan terakhir (26 September): `npm test` di `api/` (57/57 lulus), `npm run pentest` (49/49 aman), `npx prisma validate` (valid), `npm run build` di `public-web/` dan `admin-web/` (sukses).

## Ringkasan

| # | Bug | Status |
|---|---|---|
| 1 | Race stok, open bill, booking meja | Stok & bill: sudah ada. Booking meja: **diperbaiki** |
| 2 | Varian silang harga | Sudah ada |
| 3 | State machine pesanan bolong | **Diperbaiki** (tabel transisi + rollback poin atomik) |
| 4 | Split bill rounding | Tidak perlu — tidak ada pembagian nominal |
| 5 | Reservasi DP 0 | Sudah tertutup untuk publik; pembebasan DP: **diperbaiki** (hanya admin, alasan wajib) |
| 6 | Diskon tier 25% bypass | Sudah ada; batas diskon manual kasir: diputuskan tetap bisa diatur |
| 7 | Shift & kas manipulasi | **Diperbaiki** (shift ganda; shift bersamaan menghitung uang yang sama dua kali) + sudah ada (kas minus, selisih) |
| 8 | Enumerasi HP member | Sudah ada (tanpa nama) + **diperbaiki** (batas bisa dilewati) |
| 9 | OTP member | **Diperbaiki** |
| 10 | Audit log bisa dihapus | **Diperbaiki** |
| 11 | Tipe data uang Float | Sudah ada |
| 12 | Cart di localStorage | Sudah ada |
| 13 | Timezone laporan | Sudah ada |
| 14 | Polling DDoS | Sudah ada (20 detik) + **diperbaiki** (berhenti saat tab tersembunyi; notifikasi realtime, polling jadi cadangan) |
| 15 | Session MemoryStore | **Diperbaiki** |
| 16 | File upload | Sudah ada |

## Rincian

### [1] Race stok, open bill, booking meja

- **Stok — sudah ada.** Pengurangan stok memakai `UPDATE … WHERE stok >= qty` di dalam `$transaction`, dan jumlah baris yang ter-update dicek; kalau 0, seluruh order dibatalkan (409 "Stok … tidak cukup").
- **Open bill — tidak mungkin dua.** Bill disimpan di baris meja itu sendiri (`isBillOpen`, `currentVisitStartedAt`), bukan tabel bill terpisah.
- **Booking meja — diperbaiki.** Pengecekan "meja ini sudah dibooking di jam itu" berjalan di luar transaksi. Uji bersamaan: 3 staff membooking meja & jam yang sama sekaligus → **ketiganya tersimpan, di 5 dari 5 percobaan**. Sekarang pengecekannya di dalam transaksi dan diawali `SELECT … FOR UPDATE` pada baris meja, jadi booking untuk meja yang sama antre; hasil uji ulang: tepat 1 tersimpan, sisanya ditolak 409. Edit reservasi dan ganti status ikut dikunci, dan **menghidupkan lagi reservasi yang sudah batal** kini dicek bentrok (sebelumnya tidak dicek sama sekali). File: `api/src/services/reservation.service.js`.
- **Pembayaran DP bersamaan** sudah dikunci dengan cara yang sama sejak fitur DP bertahap (dua staff mencatat cicilan bersamaan tidak bisa membuat DP terbayar dua kali).
- Shift ganda: lihat [7].

Tes: "stok: dua pembeli berebut stok terakhir", "reservasi: tiga staff membooking meja & jam yang sama bersamaan", "reservasi: menghidupkan lagi reservasi batal yang jadwalnya sudah diambil ditolak". Uji HTTP ke API yang berjalan juga lolos (booking bersamaan 201/409/409; edit dan ganti status biasa tetap jalan).

### [2] Varian silang harga — sudah ada

`resolveProductVariants` hanya menerima pilihan varian dari grup varian milik produk itu sendiri; varian milik produk lain ditolak 400, dan harga tambahan varian diambil dari database. Tes: "varian silang: pilihan varian milik produk lain ditolak".

### [3] State machine pesanan — diperbaiki

- **Tabel transisi** di `api/src/utils/orderStatus.js` (`TRANSITIONS` + `canTransition`), dipakai semua perubahan status di `orderManagement.service.js`. Rincian tabelnya di `SECURITY_FIXES.md` rincian 3. Order `completed`/`cancelled` final: order selesai tidak bisa di-void, dan status tidak bisa melompat (mis. `pending` → `completed`).
- **Nama status** mengikuti yang sudah dipakai aplikasi, bukan usulan prompt: `pending` = *pending_payment*, `waiting_verif` = *waiting_verification*, dan "void" = `cancelled` dari status yang sudah dibayar (`confirmed`/`cooking`/`ready`, wajib PIN). Ada langkah `confirmed` di antara verifikasi dan `cooking` — di situlah pembayaran dicatat dan poin dikreditkan, jadi `waiting_verif` tidak bisa langsung ke `cooking`.
- **Rollback poin saat void — sudah ada, tapi rawan race; diperbaiki.** Poin ditarik kembali di transaksi yang sama dengan void, tapi dengan cara baca-lalu-tulis: kalau bersamaan ada order lain milik member yang sama dikonfirmasi, poin yang baru masuk tertimpa saldo lama. Uji bersamaan (saldo 100, +7 ×10 dan −3 ×10, seharusnya 140) dengan kode lama: **108, 108, 108, 108, 115**. Sekarang satu pernyataan `UPDATE … SET points = GREATEST(points - ?, 0)`; uji ulang selalu 140. File: `api/src/services/customer.service.js`.

Tes: tiga tes "status order", "poin member: void dan konfirmasi bersamaan tidak saling menimpa saldo", "void order lunas: poin member ditarik kembali, PIN salah tidak mengubah apa pun" (alur kasir asli: bayar → poin masuk → PIN salah ditolak → void → poin kembali → order batal tidak bisa dihidupkan lagi).

### [4] Split bill rounding — tidak perlu

Tidak ada fitur yang membagi satu nominal ke beberapa orang. Mode "pisah pesanan" di Pesanan Manual memecah **item** ke beberapa order terpisah (tiap order dihitung dari harga itemnya sendiri), dan diskon manual sengaja tidak bisa dipakai bersamaan dengan mode itu. Semua nominal uang Decimal/bulat rupiah ([11]).

### [5] Reservasi DP 0

- **Publik tidak bisa membuat reservasi**: semua endpoint reservasi butuh login staff (admin/kasir), jadi "booking semua meja gratis lewat Postman" tidak mungkin tanpa akun staff.
- **DP wajib dari database**: kalau tidak diisi staff, DP wajib dihitung dari aturan DP toko (`reservasiDpNominal`, `reservasiDpPerTamu`), bukan dari request. Reservasi baru otomatis `confirmed` hanya setelah DP wajib itu lunas. Cicilan DP 0 atau minus ditolak.
- **DP di bawah aturan toko (termasuk 0) — diperbaiki** (keputusan pemilik #9). Fiturnya tetap ada, tapi sekarang hanya admin yang boleh, dengan alasan wajib yang tampil di daftar reservasi dan tercatat di log audit; kasir ditolak 403 (layar kasir mengunci tombol Simpan). File: `api/src/services/reservation.service.js`. Rincian: `SECURITY_FIXES.md` rincian 18.

Tes: "reservasi: DP wajib dihitung dari aturan toko di database, bukan dari request", "reservasi: DP di bawah aturan toko hanya boleh admin, wajib alasan", "DP reservasi: cicilan 0 atau minus ditolak".

### [6] Diskon tier 25% bypass — sudah ada

- Batas 25% ada di **server** (`loyaltyTier.validator.js`), untuk membuat maupun mengedit tier; mengatur tier hanya bisa admin (kasir mendapat 403, pentest #3).
- Diskon manual di Pesanan Manual: staff boleh 0–100% dengan alasan tercatat, dibatasi subtotal. Batas di layar dan di server sama — bukan batas yang hanya ada di UI. Pemilik memutuskan batas ini **tetap bisa diatur** (keputusan #10), jadi tidak diubah.

Tes: "diskon tier: di atas 25% ditolak server, termasuk lewat edit".

### [7] Shift & kas

- **Dua shift terbuka — diperbaiki.** `startShift` lama memeriksa "masih ada shift terbuka?" lalu membuat shift baru tanpa kunci, jadi klik "Mulai Shift" bersamaan bisa lolos dua-duanya. Sekarang keduanya di dalam satu transaksi yang diawali `SELECT … FOR UPDATE` pada baris akun staff. File: `api/src/services/shift.service.js`.
- **Kas minus — sudah ada.** Modal awal, uang dihitung, dan pendapatan ojol ditolak kalau minus.
- **Selisih kas — sudah ada.** Saat tutup shift: kas seharusnya = modal awal + penjualan tunai + DP tunai; selisih = uang dihitung − kas seharusnya, dan selisih minus ditandai.
- **Shift bersamaan menghitung uang yang sama dua kali — diperbaiki** (ditemukan saat uji web 26 September). Rekap shift dulu memasukkan *semua* pesanan yang dibuat selama shift berjalan, siapa pun yang menerima uangnya. Kalau dua staff shift bersamaan (mis. pemilik membantu di kasir), setiap pesanan terhitung di kedua shift: di uji web, pesanan Rp 216.000 yang dibayar ke kasir ikut muncul di shift admin, sehingga "seharusnya di laci" admin jadi Rp 351.100, padahal isinya Rp 135.100. Pesanan yang dibuat sebelum shift mulai tapi dibayar di dalamnya malah tidak masuk shift mana pun. Sekarang pesanan masuk ke shift **staff yang menerima pembayarannya** (log status `→ confirmed` oleh akun itu, di dalam jendela shift-nya), dan DP masuk ke shift staff yang mencatatnya. Menerima pembayaran dan mencatat DP memang selalu butuh shift terbuka milik staff itu, jadi setiap rupiah masuk tepat satu shift. Rekap shift lama yang sudah ditutup dicek ulang: tidak berubah, kecuali satu shift 23 September yang kini mendapat pesanan QRIS Rp 18.000 yang tadinya tidak tercatat di shift mana pun (kas tunainya tetap). File: `api/src/services/shift.service.js`.

Tes: "shift: klik Mulai Shift bersamaan tidak membuka dua shift", "shift bersamaan: pesanan & DP masuk ke shift staff yang menerima uangnya, tidak dihitung dua kali" (dibuktikan gagal dengan aturan lama), "kas shift: nominal minus ditolak".

### [8] Enumerasi HP member

- **Tanpa nama — sudah ada.** Cek nomor di checkout publik hanya mengembalikan nomor yang diketik sendiri, poin, dan tier. Daftar member lengkap hanya untuk staff yang login.
- **Batas cek — diperbaiki.** Batas 15 cek/menit bisa dilewati dengan token meja karangan atau spasi di token. Rincian: `SECURITY_FIXES.md` rincian 1 dan 2.

Tes: "cek nomor member: hanya dijawab untuk token meja yang sah", pentest #13.

### [9] OTP member — diperbaiki

Diskon tier member di checkout publik baru berlaku setelah nomor diverifikasi kode 6 digit (berlaku 5 menit, sekali pakai, salah 5x hangus, hanya dikirim ke member bertier, dibatasi per nomor/perangkat/hari). Tanpa verifikasi tidak ada diskon, nama, tier, maupun saldo poin. Tanpa gateway WhatsApp/SMS (produksi tanpa `OTP_HTTP_*`), fitur ini mati dengan aman dan diskon member lewat kasir. Rincian: `SECURITY_FIXES.md` rincian 11.

Tes: "OTP member: kode hanya untuk member bertier, sekali pakai, salah 5x hangus", "OTP member: tanpa verifikasi tidak ada diskon, detail member, maupun saldo poin".

### [10] Audit log bisa dihapus — diperbaiki

`order_status_log` (Riwayat Aktivitas) dijaga trigger database: `UPDATE` selalu ditolak, `DELETE` hanya boleh oleh akun perawatan. Rincian: `SECURITY_FIXES.md` rincian 9. Tes: "log aktivitas: akun aplikasi tidak bisa mengubah atau menghapus log".

### [11] Tipe data uang Float — sudah ada

Tidak ada kolom `Float` di `schema.prisma`; semua harga, total, pajak, DP, dan kas memakai `Decimal`. Tes: "uang: tidak ada kolom Float di skema".

### [12] Cart di localStorage — sudah ada

Keranjang di browser hanya menyimpan `productId`, `variantOptionIds`, `qty`, dan catatan — tanpa harga. Total selalu dihitung ulang server (`POST /api/public/cart/total` untuk tampilan, `createOrder` untuk tagihan); harga/total/diskon kiriman browser dibuang. Tes: "keranjang: harga/total kiriman browser dibuang", pentest #5.

### [13] Timezone laporan — sudah ada

Laporan menghitung batas hari dalam WIB lalu mengubahnya ke UTC untuk query (`jakartaDayBoundsUTC`), karena Prisma menyimpan waktu dalam UTC. Tanggal yang tidak valid ditolak. Tes: "laporan: batas hari mengikuti WIB, disimpan sebagai UTC".

### [14] Polling DDoS

- **Interval — sudah ada.** Halaman status order mengecek tiap 20 detik (bukan 2 detik), dan cek status dibatasi per IP.
- **Tab tersembunyi — diperbaiki.** Polling berhenti selama tab di latar belakang, dan langsung menyegarkan status begitu tab terlihat lagi. File: `public-web/src/views/OrderView.vue`.
- **Notifikasi realtime — ditambahkan** (permintaan pemilik: tanpa lag untuk notifikasi, aksi, dan transaksi). Socket.IO (tech stack AGENTS.md) mengirim pesanan baru, panggilan meja, perubahan status, dan buka/tutup kafe dalam hitungan milidetik; di uji web, status di HP customer berubah ±1 detik setelah kasir menekan tombol, dan menu customer menjadi "tutup" ±1 detik setelah shift terakhir diakhiri. Polling tetap ada sebagai cadangan kalau koneksi realtime putus, tapi dilonggarkan selama realtime tersambung (admin 8 → 30 detik; status order customer tidak dimuat ulang kalau baru dimuat <60 detik lalu).
- **Status beruntun tidak menembus batas request — diperbaiki** (ditemukan saat uji web). Kalau kasir mengubah status beberapa kali dalam semenit (bayar → masak → siap → selesai), halaman customer dulu memuat ulang di setiap event dan bisa menembus batas 5 request/menit per kode order, sehingga status terakhir telat muncul. Sekarang status dari event langsung ditampilkan (dicocokkan dengan kode order-nya), detail lain dimuat ulang paling sering sekali per 20 detik, dan token langganan dipakai ulang saat koneksi putus-sambung. Uji web: 4 perubahan status dalam 5 detik tampil seketika, dengan total 4 request. File: `public-web/src/views/OrderView.vue`, `public-web/src/lib/realtime.js`.
- Pengamanan kanal realtime: `SECURITY_FIXES.md` rincian 20.

Tes: "polling status order: jeda >= 10 detik dan berhenti saat tab tersembunyi", "realtime: staff butuh token sah; customer hanya bisa berlangganan order miliknya", "realtime: jumlah koneksi dibatasi, origin asing & pesan raksasa ditolak".

### [15] Session MemoryStore — diperbaiki

Sesi disimpan di MySQL (bukan Redis — tidak ada di tech stack AGENTS.md); cookie `__Host-popside.sid` di produksi; session id diganti saat login; logout menghapus cookie yang benar. Rincian: `SECURITY_FIXES.md` rincian 5. Tes: "sesi: tersimpan di database…", "logout: menghapus cookie sesi…".

### [16] File upload — sudah ada

Jenis file ditentukan dari isi file (magic bytes JPEG/PNG/WebP), bukan dari nama — `shell.php.jpg` ditolak. Maks 2 MB, nama `randomUUID()` + ekstensi dari isi file, disimpan di `api/uploads/` yang tidak di-serve statis. Tidak dikonversi ke `.webp`: AGENTS.md aturan 6 menetapkan ekstensi asli, dan konversi butuh library pengolah gambar baru. Tes: "upload: isi bukan gambar ditolak walau namanya .jpg".

## Pemetaan nama tes di prompt

Codebase ini JavaScript (CommonJS), jadi tes ditulis sebagai `.js` dengan test runner bawaan Node (`node:test`, tanpa dependency baru), bukan `.ts`. Semua ada di `api/tests/` dan dijalankan dengan `npm test`.

| Nama di prompt | Tes di `api/tests/` |
|---|---|
| testRaceConditionStock | integrasi — "stok: dua pembeli berebut stok terakhir" |
| testVariantCrossProduct | logic — "varian silang" |
| testStateMachineInvalidTransition | logic — "status order: tidak bisa melompat…", "…status tak dikenal selalu ditolak" |
| testVoidAfterCompleted | logic — "status order: completed dan cancelled final…" |
| testRollbackPointsOnVoid | integrasi — "void order lunas: poin member ditarik kembali…", "poin member: void dan konfirmasi bersamaan…" |
| testSplitBillRounding | tidak ada — fitur pembagian nominal tidak ada ([4]) |
| testReservationZeroDeposit | integrasi — "reservasi: DP wajib dihitung dari aturan toko…"; logic — "DP reservasi: cicilan 0 atau minus ditolak" |
| testDiscountMaxBypass | logic — "diskon tier: di atas 25% ditolak server…" |
| testShiftDoubleOpen | integrasi — "shift: klik Mulai Shift bersamaan…", "shift bersamaan: pesanan & DP masuk ke shift staff yang menerima uangnya…" |
| testMemberEnumeration | integrasi — "cek nomor member: hanya dijawab untuk token meja yang sah"; pentest #13 |
| testOtpBypass | integrasi — "OTP member: kode hanya untuk member bertier…", "OTP member: tanpa verifikasi tidak ada diskon…" |
| testAuditLogDelete | integrasi — "log aktivitas: akun aplikasi tidak bisa mengubah atau menghapus log" |
| testDecimalMoney | logic — "uang: tidak ada kolom Float di skema" |
| testCartPriceTamper | logic — "keranjang: harga/total kiriman browser dibuang…"; pentest #5 |
| testTimezoneReport | logic — "laporan: batas hari mengikuti WIB…" |
| testPollingDDoS | logic — "polling status order: jeda >= 10 detik…"; integrasi — dua tes "realtime: …"; pentest #16 |

Tambahan di luar daftar prompt: "reservasi: tiga staff membooking meja & jam yang sama bersamaan", "reservasi: menghidupkan lagi reservasi batal…", "order publik: field terlarang…", "kas shift: nominal minus ditolak", "member: nomor HP dibakukan…", "kode order: akhiran meja…", dan semua tes di `security.test.js`.

## Definition of Done prompt

| Butir | Status |
|---|---|
| `docs/LOGIC_BUGS_FIX.md` | Dokumen ini |
| Tes logika | Lihat pemetaan di atas — 15 dari 16 nama punya tes; satu sisanya untuk fitur yang memang tidak ada (pembagian nominal, [4]) |
| Semua zod `.strict()` | **Diperbaiki** — `z.strictObject` di semua schema, dijaga tes "validasi strict: …" (`SECURITY_FIXES.md` rincian 16) |
| `npm run build` & `npx prisma validate` | Lolos |
