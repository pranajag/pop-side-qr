// Shared between OrdersView (current orders) and ActivityLogView (status
// history) so the two never drift out of sync on labels/colors for the
// same status values.
export const STATUS_LABEL = {
  pending: 'Menunggu Pembayaran',
  waiting_verif: 'Menunggu Verifikasi',
  confirmed: 'Dikonfirmasi',
  cooking: 'Dimasak',
  ready: 'Siap',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
}

export const STATUS_BADGE_CLASS = {
  pending: 'bg-status-pending text-white',
  waiting_verif: 'bg-status-waiting-verif text-white',
  confirmed: 'bg-status-confirmed text-white',
  cooking: 'bg-status-cooking text-white',
  ready: 'bg-status-ready text-white',
  completed: 'bg-status-completed text-white',
  cancelled: 'bg-status-cancelled text-white',
}
