import { defineStore } from 'pinia'
import { api } from '@/lib/api'

// Is the cafe actually open for orders — i.e. is any staff clocked into a
// shift. Kept separate from the menu: the menu is safe to browse whenever,
// but an order placed with nobody on duty has no one to confirm payment,
// cook it, or hand it over, so it would just sit pending until someone
// finds it later with a customer already waiting at the table.
//
// Advisory only. api/src/services/order.service.js refuses the order for
// real; this exists so the customer learns on the menu screen instead of
// after building a whole cart.
export const useCafeStatusStore = defineStore('cafeStatus', {
  state: () => ({ sedangBuka: true, loaded: false }),
  actions: {
    async fetch() {
      try {
        const data = await api.get('/public/settings')
        this.sedangBuka = data.sedangBuka !== false
      } catch {
        // Unreachable API is the offline banner's job to explain, not
        // this store's — assume open rather than showing "tutup" for what
        // is really a connection problem.
        this.sedangBuka = true
      } finally {
        this.loaded = true
      }
    },
  },
})
