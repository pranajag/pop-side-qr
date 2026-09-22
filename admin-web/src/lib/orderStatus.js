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

// Each chip pairs its background with the matching -foreground token rather
// than a blanket text-white: amber/orange/lime chips are light enough that
// white text on them was unreadable, and dark mode lightens every chip.
export const STATUS_BADGE_CLASS = {
  pending: 'bg-status-pending text-status-pending-foreground',
  waiting_verif: 'bg-status-waiting-verif text-status-waiting-verif-foreground',
  confirmed: 'bg-status-confirmed text-status-confirmed-foreground',
  cooking: 'bg-status-cooking text-status-cooking-foreground',
  ready: 'bg-status-ready text-status-ready-foreground',
  completed: 'bg-status-completed text-status-completed-foreground',
  cancelled: 'bg-status-cancelled text-status-cancelled-foreground',
}
