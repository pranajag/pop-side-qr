import { defineStore } from 'pinia'
import { loadJSON, saveJSON } from '@/lib/persist'

const STORAGE_KEY = 'popside.cart'

// Only product_id + variant_option_ids + qty + catatan ever get persisted
// here — never price (AGENTS.md: cart di client cuma boleh product_id +
// qty + catatan). Price/availability are always re-derived server-side via
// /cart/total.
//
// tableId travels alongside the items so a cart built at one table can
// never silently resurface at another: a customer who adds items, leaves
// without ordering, then later scans a *different* table's QR (same phone,
// localStorage survives across tabs/days unlike table.js's sessionStorage)
// would otherwise see and could submit a stale cart against the wrong
// table. table.js's verify() calls syncTable() below on every successful
// scan, which clears the cart whenever the table actually changes.
const loaded = loadJSON(localStorage, STORAGE_KEY, { tableId: null, items: [] })
// Pre-migration carts saved a bare array under this key. Treat one as
// "unknown table" (tableId: null) rather than crashing on .items — the very
// next syncTable() call (table.js's verify(), on this same page load) then
// clears it for real, same as any other table mismatch.
const initialState = Array.isArray(loaded) ? { tableId: null, items: loaded } : loaded

// Two lines are the same purchasable line only if they're the same product
// AND the same variant selection — "Es Teh Large" and "Es Teh Regular" are
// legitimately separate cart lines, not one line with qty 2.
function lineKey(productId, variantOptionIds) {
  return `${productId}:${[...(variantOptionIds ?? [])].sort((a, b) => a - b).join(',')}`
}

export const useCartStore = defineStore('cart', {
  state: () => ({ tableId: initialState.tableId, items: initialState.items }),
  getters: {
    qtyFor:
      (state) =>
      (productId, variantOptionIds = []) => {
        const key = lineKey(productId, variantOptionIds)
        return (
          state.items.find(
            (i) => lineKey(i.productId, i.variantOptionIds) === key
          )?.qty ?? 0
        )
      },
    totalQty: (state) => state.items.reduce((sum, i) => sum + i.qty, 0),
    isEmpty: (state) => state.items.length === 0,
  },
  actions: {
    // qty is the line's absolute new quantity, not a delta. Creates the
    // line if it doesn't exist yet, removes it if qty drops to 0.
    setQty(productId, variantOptionIds, qty) {
      const key = lineKey(productId, variantOptionIds)
      if (qty <= 0) {
        this.items = this.items.filter(
          (i) => lineKey(i.productId, i.variantOptionIds) !== key
        )
      } else {
        const existing = this.items.find(
          (i) => lineKey(i.productId, i.variantOptionIds) === key
        )
        if (existing) {
          existing.qty = qty
        } else {
          this.items.push({
            productId,
            variantOptionIds: [...(variantOptionIds ?? [])],
            qty,
            catatan: '',
          })
        }
      }
      this.persist()
    },
    setNote(productId, variantOptionIds, catatan) {
      const key = lineKey(productId, variantOptionIds)
      const existing = this.items.find(
        (i) => lineKey(i.productId, i.variantOptionIds) === key
      )
      if (existing) {
        existing.catatan = catatan
        this.persist()
      }
    },
    clear() {
      this.items = []
      this.persist()
    },
    // Called from table.js's verify() on every successful QR scan. A cart
    // built at a different table (or no table yet known) doesn't belong
    // here — drop it rather than let it silently ride along to wherever
    // the customer scans next.
    syncTable(tableId) {
      if (this.tableId !== tableId) {
        this.tableId = tableId
        this.items = []
      }
      this.persist()
    },
    persist() {
      saveJSON(localStorage, STORAGE_KEY, { tableId: this.tableId, items: this.items })
    },
  },
})
