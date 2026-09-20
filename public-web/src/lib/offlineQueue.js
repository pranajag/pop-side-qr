import { loadJSON, saveJSON } from '@/lib/persist'
import { api } from '@/lib/api'

// At most one pending order at a time, by design — a customer whose
// checkout failed for lack of connectivity hasn't cleared their cart
// (CheckoutView.vue only clears it on a confirmed success), so there's
// nothing meaningful for them to do except wait for this one to resolve
// before trying to order again.
const STORAGE_KEY = 'popside.pendingOrder'

// `payload` is exactly what CheckoutView.vue would have POSTed to
// /public/orders, idempotencyKey included — replaying it later (whenever
// connectivity returns) hits the exact same order.service.js path a live
// retry would, so a request that actually reached the server before the
// connection visibly dropped resolves to the order it already created
// instead of a duplicate.
export function savePendingOrder(payload) {
  saveJSON(localStorage, STORAGE_KEY, { payload, savedAt: Date.now() })
}

export function loadPendingOrder() {
  return loadJSON(localStorage, STORAGE_KEY, null)
}

export function clearPendingOrder() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable — nothing to clear, nothing else depends on it.
  }
}

// Called once at app startup and again on every 'online' event (App.vue) —
// a no-op when there's nothing queued. `err.status === undefined` is how
// lib/api.js's request() surfaces a network-level failure (fetch() itself
// threw, before a real HTTP response ever came back) as opposed to the
// server actively rejecting the request — only the former is worth
// retrying; the latter would just fail the same way forever.
export async function retryPendingOrder({ onSuccess, onServerRejected }) {
  const pending = loadPendingOrder()
  if (!pending) return
  try {
    const { order } = await api.post('/public/orders', pending.payload)
    clearPendingOrder()
    onSuccess(order)
  } catch (err) {
    if (err?.status !== undefined) {
      clearPendingOrder()
      onServerRejected(err)
    }
    // Still offline (or the API is unreachable for some other reason) —
    // leave it queued, the next 'online' event or app load tries again.
  }
}
