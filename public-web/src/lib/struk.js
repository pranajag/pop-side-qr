import logoUrl from '@/assets/pop-side-logo.jpg'
import { formatRupiah } from '@/lib/format'

// Struk digital customer (PNG/PDF), digambar di <canvas> dari data pesanan
// yang sudah dihitung server (harga, diskon, pajak, total — tidak ada angka
// yang dihitung ulang di sini selain subtotal yang diurai balik, sama dengan
// struk cetak kasir di admin-web OrdersView.vue). Tanpa library tambahan:
// PNG langsung dari canvas, PDF membungkus gambar yang sama dalam satu
// halaman selebar kertas struk kasir (80 mm).
//
// Tata letaknya mengikuti struk cetak kasir supaya dua-duanya terasa sama:
// logo + info toko, kode/meja/bayar, item, rincian, TOTAL, terima kasih.

const LEBAR = 360 // lebar logis (px); gambar akhirnya SKALA kali lebih besar
const SKALA = 2
const PAD = 22
const ISI = LEBAR - PAD * 2
const LEBAR_KERTAS_MM = 80
// Font sistem saja (tidak perlu diunduh dulu) — monospace seperti struk kasir.
const FONT = '"SFMono-Regular", ui-monospace, Menlo, Consolas, "Liberation Mono", "Courier New", monospace'
const WARNA = { teks: '#111827', redup: '#6b7280', garis: '#9ca3af', hijau: '#15803d', latar: '#ffffff' }

function font(ukuran, tebal = false) {
  return `${tebal ? 700 : 400} ${ukuran}px ${FONT}`
}

// Memecah teks jadi baris yang muat di `lebar` — per kata, dan per huruf
// untuk kata yang lebih panjang dari satu baris.
function bungkus(ctx, teks, lebar) {
  const hasil = []
  for (const paragraf of String(teks ?? '').split('\n')) {
    let kini = ''
    for (const kata of paragraf.split(/\s+/).filter(Boolean)) {
      const coba = kini ? `${kini} ${kata}` : kata
      if (ctx.measureText(coba).width <= lebar) {
        kini = coba
        continue
      }
      if (kini) hasil.push(kini)
      kini = ''
      for (const huruf of kata) {
        if (kini && ctx.measureText(kini + huruf).width > lebar) {
          hasil.push(kini)
          kini = huruf
        } else {
          kini += huruf
        }
      }
    }
    hasil.push(kini)
  }
  return hasil
}

function jalurBulat(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function muatGambar(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function formatWaktu(nilai, bahasa) {
  return new Intl.DateTimeFormat(bahasa === 'en' ? 'en-GB' : 'id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(nilai))
}

// Isi struk sebagai daftar baris gambar — dipisah dari cara menggambarnya.
function barisStruk({ order, toko, t, bahasa }) {
  const baris = []
  const teks = (isi, opsi = {}) => baris.push({ jenis: 'teks', teks: isi, ukuran: 12, ...opsi })
  const pasangan = (kiri, kanan, opsi = {}) => baris.push({ jenis: 'pasangan', kiri, kanan, ukuran: 12, ...opsi })
  const garis = () => baris.push({ jenis: 'garis' })
  const redup = { warna: WARNA.redup }

  baris.push({ jenis: 'logo', ukuran: 52 })
  // Kop struk: nama toko saja — alamat & nomor telepon toko sengaja tidak
  // dicetak (permintaan kafe, 3 Oktober), sama dengan struk cetak dashboard.
  teks(toko?.namaToko || 'POPSIDE', { ukuran: 17, tebal: true, rata: 'tengah' })
  baris.push({ jenis: 'jarak', tinggi: 10 })
  baris.push({ jenis: 'lencana', teks: t('strukLunasSelesai'), ukuran: 12, warna: WARNA.hijau })
  garis()

  pasangan(t('strukKode'), order.kodeOrder, { tebal: true })
  pasangan(
    order.nomorMeja ? t('meja') : t('strukTipe'),
    order.nomorMeja ?? `${t('bawaPulang')}${order.customerName ? ` (${order.customerName})` : ''}`
  )
  pasangan(t('strukDipesan'), formatWaktu(order.createdAt, bahasa))
  if (order.berakhirPada) pasangan(t('statusCompleted'), formatWaktu(order.berakhirPada, bahasa))
  const METODE = { qris: 'QRIS', tunai: t('tunai').toUpperCase(), debit: 'DEBIT' }
  pasangan(t('strukBayar'), METODE[order.metode] ?? String(order.metode).toUpperCase())
  // Nama yang diisi kasir saat Mulai Shift (api shift.service.js namaKasirUntuk).
  if (order.kasir) pasangan(t('strukKasir'), order.kasir)
  garis()

  for (const item of order.items) {
    pasangan(`${item.qty}x ${item.nama}`, formatRupiah(item.harga * item.qty))
    if (item.variants?.length) {
      teks(item.variants.map((v) => v.namaOption).join(', '), { ukuran: 11, indent: 14, ...redup })
    }
    if (item.catatan) teks(item.catatan, { ukuran: 11, indent: 14, ...redup })
  }
  garis()

  // totalHarga sudah dikurangi diskon dan ditambah pajak/service (server) —
  // subtotal diurai balik dari situ, sama seperti halaman status.
  const adaRincian = order.discountAmount > 0 || order.taxAmount > 0 || order.serviceChargeAmount > 0
  if (adaRincian) {
    const subtotal = order.totalHarga - order.taxAmount - order.serviceChargeAmount + order.discountAmount
    pasangan(t('subtotal'), formatRupiah(subtotal), redup)
    if (order.discountAmount > 0) {
      pasangan(
        `${t('diskon')}${order.discountReason ? ` (${order.discountReason})` : ''}`,
        `-${formatRupiah(order.discountAmount)}`
      )
    }
    if (order.taxAmount > 0) pasangan(t('strukPajak'), formatRupiah(order.taxAmount), redup)
    if (order.serviceChargeAmount > 0) pasangan('Service Charge', formatRupiah(order.serviceChargeAmount), redup)
  }
  pasangan(t('strukTotal'), formatRupiah(order.totalHarga), { ukuran: 15, tebal: true })
  if (order.cashReceived !== null && order.cashReceived !== undefined) {
    pasangan(t('strukTunai'), formatRupiah(order.cashReceived))
    pasangan(t('strukKembalian'), formatRupiah(order.changeAmount ?? 0), { tebal: true })
  }
  if (order.pointsEarned > 0) {
    baris.push({ jenis: 'jarak', tinggi: 4 })
    teks(t('poinDidapat', { n: order.pointsEarned }), { ukuran: 11, warna: WARNA.hijau })
  }
  if (order.catatan) teks(t('catatanLabel', { catatan: order.catatan }), { ukuran: 11, ...redup })
  garis()

  teks(t('strukTerimaKasih'), { ukuran: 13, tebal: true, rata: 'tengah' })
  teks(t('strukDibuat', { waktu: formatWaktu(new Date(), bahasa) }), { ukuran: 10, rata: 'tengah', ...redup })
  return baris
}

// Lintasan pertama: ukur setiap baris (pembungkusan teks) dan posisinya,
// supaya tinggi canvas pas dengan isinya.
function susun(ctx, daftar) {
  let y = PAD
  const siap = []
  for (const b of daftar) {
    if (b.jenis === 'jarak') {
      y += b.tinggi
    } else if (b.jenis === 'garis') {
      siap.push({ ...b, y: y + 7 })
      y += 14
    } else if (b.jenis === 'logo') {
      siap.push({ ...b, y })
      y += b.ukuran + 10
    } else if (b.jenis === 'lencana') {
      siap.push({ ...b, y })
      y += b.ukuran + 18
    } else {
      ctx.font = font(b.ukuran, b.tebal)
      const tinggiBaris = Math.round(b.ukuran * 1.5)
      const lebarKanan = b.jenis === 'pasangan' ? ctx.measureText(b.kanan).width + 12 : 0
      const lebar = Math.max(60, ISI - (b.indent ?? 0) - lebarKanan)
      const pecahan = bungkus(ctx, b.jenis === 'pasangan' ? b.kiri : b.teks, lebar)
      siap.push({ ...b, pecahan, tinggiBaris, y })
      y += pecahan.length * tinggiBaris
    }
  }
  return { siap, tinggi: Math.ceil(y + PAD) }
}

function gambar(ctx, siap, logo) {
  ctx.textBaseline = 'top'
  for (const b of siap) {
    if (b.jenis === 'garis') {
      ctx.strokeStyle = WARNA.garis
      ctx.lineWidth = 1
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(PAD, b.y + 0.5)
      ctx.lineTo(LEBAR - PAD, b.y + 0.5)
      ctx.stroke()
      ctx.setLineDash([])
    } else if (b.jenis === 'logo') {
      if (!logo) continue
      const x = (LEBAR - b.ukuran) / 2
      ctx.save()
      jalurBulat(ctx, x, b.y, b.ukuran, b.ukuran, 12)
      ctx.clip()
      ctx.drawImage(logo, x, b.y, b.ukuran, b.ukuran)
      ctx.restore()
    } else if (b.jenis === 'lencana') {
      ctx.font = font(b.ukuran, true)
      const w = ctx.measureText(b.teks).width + 24
      const x = (LEBAR - w) / 2
      ctx.strokeStyle = b.warna
      ctx.lineWidth = 1.5
      jalurBulat(ctx, x, b.y, w, b.ukuran + 10, 7)
      ctx.stroke()
      ctx.fillStyle = b.warna
      ctx.fillText(b.teks, x + 12, b.y + 5)
    } else {
      ctx.font = font(b.ukuran, b.tebal)
      ctx.fillStyle = b.warna ?? WARNA.teks
      b.pecahan.forEach((isi, i) => {
        const x = b.rata === 'tengah' ? (LEBAR - ctx.measureText(isi).width) / 2 : PAD + (b.indent ?? 0)
        ctx.fillText(isi, x, b.y + i * b.tinggiBaris)
      })
      if (b.jenis === 'pasangan') {
        ctx.fillText(b.kanan, LEBAR - PAD - ctx.measureText(b.kanan).width, b.y)
      }
    }
  }
}

// data: { order, toko, t, bahasa } — order dari GET /public/orders/:kode,
// toko dari GET /public/settings (boleh null), t = locale.t.
export async function buatStruk(data) {
  const logo = await muatGambar(logoUrl).catch(() => null)
  const { siap, tinggi } = susun(document.createElement('canvas').getContext('2d'), barisStruk(data))
  const canvas = document.createElement('canvas')
  canvas.width = LEBAR * SKALA
  canvas.height = tinggi * SKALA
  const ctx = canvas.getContext('2d')
  ctx.scale(SKALA, SKALA)
  ctx.fillStyle = WARNA.latar
  ctx.fillRect(0, 0, LEBAR, tinggi)
  gambar(ctx, siap, logo)
  return canvas
}

export function keBlob(canvas, tipe, kualitas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas kosong'))), tipe, kualitas)
  })
}

// PDF 1.4 satu halaman berisi gambar struk (JPEG, /DCTDecode). Ditulis
// langsung — formatnya cukup sederhana untuk satu gambar, jadi tidak perlu
// library PDF. Offset di tabel xref dihitung dalam byte.
export async function pdfDariCanvas(canvas, { judul = 'Struk' } = {}) {
  const jpeg = new Uint8Array(await (await keBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer())
  const lebarPt = (LEBAR_KERTAS_MM * 72) / 25.4
  const tinggiPt = (lebarPt * canvas.height) / canvas.width
  const angka = (n) => n.toFixed(2)
  const judulAman = judul.replace(/[^\x20-\x7e]/g, '').replace(/[\\()]/g, (c) => `\\${c}`)

  const enc = new TextEncoder()
  const potongan = []
  const offset = []
  let panjang = 0
  const tulis = (isi) => {
    const bytes = typeof isi === 'string' ? enc.encode(isi) : isi
    potongan.push(bytes)
    panjang += bytes.length
  }
  const objek = (n, isi) => {
    offset[n] = panjang
    tulis(`${n} 0 obj\n`)
    isi()
    tulis('\nendobj\n')
  }

  // Baris kedua berisi byte > 127: penanda file biner untuk pembaca PDF.
  tulis('%PDF-1.4\n')
  tulis(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))
  objek(1, () => tulis('<< /Type /Catalog /Pages 2 0 R >>'))
  objek(2, () => tulis('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'))
  objek(3, () =>
    tulis(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${angka(lebarPt)} ${angka(tinggiPt)}] ` +
        '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'
    )
  )
  objek(4, () => {
    tulis(
      `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
    )
    tulis(jpeg)
    tulis('\nendstream')
  })
  const konten = `q ${angka(lebarPt)} 0 0 ${angka(tinggiPt)} 0 0 cm /Im0 Do Q`
  objek(5, () => tulis(`<< /Length ${konten.length} >>\nstream\n${konten}\nendstream`))
  objek(6, () => tulis(`<< /Title (${judulAman}) /Producer (Popside) >>`))

  const awalXref = panjang
  tulis('xref\n0 7\n0000000000 65535 f \n')
  for (let n = 1; n <= 6; n++) tulis(`${String(offset[n]).padStart(10, '0')} 00000 n \n`)
  tulis(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${awalXref}\n%%EOF\n`)
  return new Blob(potongan, { type: 'application/pdf' })
}

export function unduh(blob, namaFile) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = namaFile
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Beri waktu browser mulai mengunduh sebelum URL-nya dilepas.
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
