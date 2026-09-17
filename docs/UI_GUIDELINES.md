# UI Guidelines — Anti AI Slop

## Prinsip Umum

- Mobile-first mutlak untuk public web — desain dari lebar 375px dulu, baru scale up. Target: pesan penuh cukup pakai satu tangan/jempol.
- Referensi rasa: GoFood / ShopeeFood untuk public web (padat informasi tapi rapi, CTA jelas, minim dekorasi). Tabler / contoh dashboard shadcn untuk admin web (clean, data-dense, bukan template admin generik warna-warni).
- Font: **Inter** atau **Plus Jakarta Sans** — jangan pakai font default browser, jangan pakai lebih dari 2 font family dalam satu web.

## Yang DILARANG (ciri "AI slop")

- Gradient ungu-ke-biru atau ungu-ke-pink sebagai background hero/CTA.
- Card dengan `box-shadow` tebal/menyebar di semua tempat — cukup `shadow-sm` atau border tipis.
- Emoji sebagai pengganti icon di UI produksi — pakai icon set konsisten (misal Lucide, yang juga dipakai shadcn-vue).
- Border-radius berlebihan tanpa alasan (semua elemen dibuat sangat bulat).
- Placeholder text generik ("Lorem ipsum", "Product Name") yang kebawa sampai ke build akhir.

## Design Tokens (didefinisikan sekali di `tailwind.config`, jangan hardcode hex di komponen)

- **Warna primer**: satu warna brand utama (isi sesuai brand Popside sebenarnya — placeholder: teks gelap `#0F172A`, satu accent color untuk CTA/status).
- **Warna status order** (dipakai badge di admin & halaman tracking) — konsisten di semua tempat status ditampilkan:
  - `pending` = abu
  - `waiting_verif` = kuning/amber
  - `confirmed` = biru
  - `cooking` = oranye
  - `ready` = hijau muda
  - `completed` = hijau tua
  - `cancelled` = merah
- **Spacing scale**: pakai skala default Tailwind (kelipatan 4px) — jangan bikin custom spacing per komponen.
- **Typography scale**: maksimal 4 ukuran font di satu halaman (heading, subheading, body, caption).

## Komponen

- Semua komponen UI reusable ditaruh di `components/ui/` (public-web & admin-web masing-masing punya).
- Pakai shadcn-vue sebagai basis komponen (button, card, badge, dialog, table) — jangan reinvent komponen dasar dari nol.
- Tombol utama (CTA) hanya satu gaya visual per konteks — jangan campur bentuk sudut membulat penuh dengan sudut sedikit membulat untuk tombol yang setara pentingnya.

## Aksesibilitas Minimum

- Tap target minimal 44x44px untuk elemen interaktif di public web (dipakai di HP, kadang sambil buru-buru).
- Kontras teks minimal rasio 4.5:1 (WCAG AA) — terutama badge status yang warnanya soft.
- Alt text untuk semua foto produk (nama produk sudah cukup).

## Kecepatan

- Public web adalah halaman yang paling sering dibuka & paling sensitif terhadap kecepatan (customer buka sambil duduk di meja, tidak sabar menunggu). Lazy-load foto produk, jangan import seluruh icon library kalau cuma butuh beberapa icon saja.
