import { defineStore } from 'pinia'
import { loadJSON, saveJSON } from '@/lib/persist'

const STORAGE_KEY = 'popside.cart'

// Only product_id + variant_option_ids + qty + catatan ever get persisted
// here — never price (AGENTS.md: cart di client cuma boleh product_id +
// qty + catatan). Price/availability are always re-derived server-side via
// /cart/total.
const initialItems = loadJSON(localStorage, STORAGE_KEY, [])

// Two lines are the same purchasable line only if they're the same product
// AND the same variant selection — "Es Teh Large" and "Es Teh Regular" are
// legitimately separate cart lines, not one line with qty 2.
function lineKey(productId, variantOptionIds) {
  return `${productId}:${[...(variantOptionIds ?? [])].sort((a, b) => a - b).join(',')}`
}

export const useCartStore = defineStore('cart', {
  state: () => ({ items: initialItems }),
  getters: {
    qtyFor:
      (state) =>
      (productId, variantOptionIds = []) => {
        const key = lineKey(productId, variantOptionIds)
        return state.items.find((i) => lineKey(i.productId, i.variantOptionIds) === key)?.qty ?? 0
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
        this.items = this.items.filter((i) => lineKey(i.productId, i.variantOptionIds) !== key)
      } else {
        const existing = this.items.find((i) => lineKey(i.productId, i.variantOptionIds) === key)
        if (existing) {
          existing.qty = qty
        } else {
          this.items.push({ productId, variantOptionIds: [...(variantOptionIds ?? [])], qty, catatan: '' })
        }
      }
      this.persist()
    },
    setNote(productId, variantOptionIds, catatan) {
      const key = lineKey(productId, variantOptionIds)
      const existing = this.items.find((i) => lineKey(i.productId, i.variantOptionIds) === key)
      if (existing) {
        existing.catatan = catatan
        this.persist()
      }
    },
    clear() {
      this.items = []
      this.persist()
    },
    persist() {
      saveJSON(localStorage, STORAGE_KEY, this.items)
    },
  },
})
