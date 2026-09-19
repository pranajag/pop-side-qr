const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
})

export function formatRupiah(value) {
  return rupiah.format(Number(value))
}

// Pinned to Asia/Jakarta regardless of device locale/timezone, same
// reasoning as admin-web's formatDateTime — this cafe has one timezone.
// Time-only (no date) since every caller already knows the day (BillDialog:
// always today; a "sudah dibayar" order age reads better as a clock time
// than a full date/time stamp).
const timeFormatter = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  timeStyle: 'short',
})

export function formatTime(value) {
  return timeFormatter.format(new Date(value))
}
