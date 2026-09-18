const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
})

export function formatRupiah(value) {
  return rupiah.format(Number(value))
}

// Pinned to Asia/Jakarta (WIB, fixed UTC+7) via Intl's own timeZone option —
// this cafe has one timezone regardless of which device a staff member is
// on, so display must not follow the browser's local zone (see
// ReportView.vue's jakartaNow() for the same fixed-offset rule applied to
// date-only arithmetic).
const dateTimeFormatter = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function formatDateTime(value) {
  return dateTimeFormatter.format(new Date(value))
}
