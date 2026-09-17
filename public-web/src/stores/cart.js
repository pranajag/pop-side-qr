import { defineStore } from 'pinia'
import { loadJSON, saveJSON } from '@/lib/persist'

const STORAGE_KEY = 'popside.cart'

// Only product_id + qty + catatan ever get persisted here — never price
// (AGENTS.md: cart di client cuma boleh product_id + qty + catatan).
// Price/availability are always re-derived server-side via /cart/total.
const initialItems = loadJSON(localStorage, STORAGE_KEY, [])

export const useCartStore = defineStore('cart', {
  state: () => ({ items: initialItems }),
  getters: {
    qtyFor: (state) => (productId) => state.items.find((i) => i.productId === productId)?.qty ?? 0,
    totalQty: (state) => state.items.reduce((sum, i) => sum + i.qty, 0),
    isEmpty: (state) => state.items.length === 0,
  },
  actions: {
    setQty(productId, qty) {
      if (qty <= 0) {
        this.items = this.items.filter((i) => i.productId !== productId)
      } else {
        const existing = this.items.find((i) => i.productId === productId)
        if (existing) {
          existing.qty = qty
        } else {
          this.items.push({ productId, qty, catatan: '' })
        }
      }
      this.persist()
    },
    setNote(productId, catatan) {
      const existing = this.items.find((i) => i.productId === productId)
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
