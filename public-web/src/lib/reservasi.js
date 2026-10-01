import { formatTime } from '@/lib/format'

// Teks pemberitahuan meja yang sedang/akan dipakai reservasi — satu sumber
// untuk banner (components/ReservasiNotice.vue) dan toast di MenuView, supaya
// keduanya tidak pernah mengatakan hal yang berbeda.
//
// jenis: 'terkunci' (meja dipegang rombongan reservasi, perangkat ini bukan
// rombongannya — tidak bisa memesan), 'rombongan' (perangkat ini memakai QR
// rombongan), atau 'info' (pemberitahuan biasa, pesanan tetap bisa dibuat).
export function teksReservasi(locale, nomorMeja, reservasi) {
  if (!reservasi) return null
  const vars = { meja: nomorMeja, jam: formatTime(reservasi.waktu) }
  if (reservasi.terkunci) {
    return {
      jenis: 'terkunci',
      judul: locale.t('mejaDireservasiTitle', vars),
      isi: locale.t('mejaDireservasiDesc', vars),
    }
  }
  if (reservasi.rombongan) {
    return {
      jenis: 'rombongan',
      judul: locale.t('rombonganTitle', vars),
      isi: locale.t('rombonganDesc', vars),
    }
  }
  return reservasi.sudahMulai
    ? {
        jenis: 'info',
        judul: locale.t('reservasiSedangTitle', vars),
        isi: locale.t('reservasiSedangDesc', vars),
      }
    : {
        jenis: 'info',
        judul: locale.t('reservasiSegeraTitle', vars),
        isi: locale.t('reservasiSegeraDesc', vars),
      }
}
