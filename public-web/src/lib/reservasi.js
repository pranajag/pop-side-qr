import { formatTime } from '@/lib/format'

// Teks pemberitahuan meja yang sedang/akan dipakai reservasi — satu sumber
// untuk banner (components/ReservasiNotice.vue) dan toast di MenuView, supaya
// keduanya tidak pernah mengatakan hal yang berbeda.
export function teksReservasi(locale, nomorMeja, reservasi) {
  if (!reservasi) return null
  const vars = { meja: nomorMeja, jam: formatTime(reservasi.waktu) }
  return reservasi.sudahMulai
    ? {
        judul: locale.t('reservasiSedangTitle', vars),
        isi: locale.t('reservasiSedangDesc', vars),
      }
    : {
        judul: locale.t('reservasiSegeraTitle', vars),
        isi: locale.t('reservasiSegeraDesc', vars),
      }
}
