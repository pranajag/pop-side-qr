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

export const STATUS_COLOR = {
  pending: 'bg-status-pending',
  waiting_verif: 'bg-status-waiting-verif',
  confirmed: 'bg-status-confirmed',
  cooking: 'bg-status-cooking',
  ready: 'bg-status-ready',
  completed: 'bg-status-completed',
  cancelled: 'bg-status-cancelled',
}
