// Cermin dari api/src/validators/common.js (normalisasiTelepon + pola
// nomornya). Server tetap yang menentukan — ini ada supaya customer langsung
// tahu nomornya salah ketik di bawah kolomnya, tanpa harus menekan "Pesan"
// dulu lalu ditolak.
export function normalisasiTelepon(nilai) {
  let t = String(nilai ?? '')
    .trim()
    .replace(/[\s\-.()]/g, '')
  if (t.startsWith('+62')) t = `0${t.slice(3)}`
  else if (t.startsWith('62')) t = `0${t.slice(2)}`
  else if (/^8\d/.test(t)) t = `0${t}`
  return t.replace(/^0+/, '0')
}

const POLA_TELEPON = /^0\d{8,13}$/
const KARAKTER_TELEPON = /^[\d\s\-.()+]*$/
const MIN_DIGIT = 9

// 'kosong'        — tidak diisi: customer memilih tidak ikut member.
// 'valid'         — nomor baku yang akan dikirim ke server.
// 'belum-lengkap' — cuma angka, tapi masih terlalu pendek.
// 'tidak-valid'   — ada huruf/simbol lain, atau panjangnya tidak masuk akal.
export function statusTelepon(nilai) {
  const mentah = String(nilai ?? '').trim()
  if (mentah === '') return 'kosong'
  if (!KARAKTER_TELEPON.test(mentah)) return 'tidak-valid'
  const baku = normalisasiTelepon(mentah)
  if (POLA_TELEPON.test(baku)) return 'valid'
  if (baku.length < MIN_DIGIT) return 'belum-lengkap'
  return 'tidak-valid'
}
