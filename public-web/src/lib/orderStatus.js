// Shared between OrderView (single order tracking) and BillDialog (all of a
// table's orders today) so the two never drift out of sync on which
// translation key / color a status maps to. Values are locale.t() keys, not
// display strings — public-web is bilingual (id/en).
export const STATUS_LABEL_KEY = {
  pending: 'statusPending',
  waiting_verif: 'statusWaitingVerif',
  confirmed: 'statusConfirmed',
  cooking: 'statusCooking',
  ready: 'statusReady',
  completed: 'statusCompleted',
  cancelled: 'statusCancelled',
}

// Background and its matching text color travel together: the light chips
// (amber, orange, lime) need near-black text, not the white that used to be
// hardcoded at each call site.
export const STATUS_COLOR = {
  pending: 'bg-status-pending text-status-pending-foreground',
  waiting_verif: 'bg-status-waiting-verif text-status-waiting-verif-foreground',
  confirmed: 'bg-status-confirmed text-status-confirmed-foreground',
  cooking: 'bg-status-cooking text-status-cooking-foreground',
  ready: 'bg-status-ready text-status-ready-foreground',
  completed: 'bg-status-completed text-status-completed-foreground',
  cancelled: 'bg-status-cancelled text-status-cancelled-foreground',
}
