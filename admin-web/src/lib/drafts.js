// Every sessionStorage-backed form draft in this app, in one place — so
// logout (AppShell.vue) can wipe all of them in one call instead of each
// view's own draft key needing to be remembered separately (and a future
// view forgetting to add itself to a manual cleanup list). This is a real
// device-sharing concern, not just tidiness: sessionStorage survives a
// logout/login cycle on its own (it's tied to the browser tab, not the
// session cookie), so on a shared counter device, staff A's half-typed
// customer phone number or discount reason would otherwise still be
// sitting there for staff B to see after A logs out and B logs in.
const DRAFT_KEYS = ['popside.manualOrderDraft', 'popside.reservationDraft']

export function clearAllDrafts() {
  for (const key of DRAFT_KEYS) {
    try {
      sessionStorage.removeItem(key)
    } catch {
      // Storage unavailable — nothing to clean up.
    }
  }
}
