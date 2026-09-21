import { defineStore } from 'pinia'
import { api } from '@/lib/api'

// Staff-configurable point-to-discount tiers (store owner's own request) —
// read by both MembersView.vue (manage) and ManualOrderView.vue (suggest
// a redemption to the kasir). Kept as one small shared store rather than
// each view fetching its own copy, since the list rarely changes and
// ManualOrderView.vue in particular wants it available the instant a
// member phone is typed, not after its own extra round-trip.
export const useLoyaltyTiersStore = defineStore('loyaltyTiers', {
  state: () => ({ items: [], loaded: false }),
  getters: {
    // Highest tier a given points balance qualifies for, or null if it
    // doesn't reach even the lowest tier. items is kept sorted by
    // minPoints ascending (server's own ORDER BY) so the last match wins.
    applicableTier: (state) => (points) => {
      let best = null
      for (const tier of state.items) {
        if (points >= tier.minPoints) best = tier
      }
      return best
    },
  },
  actions: {
    async fetchAll() {
      const data = await api.get('/admin/loyalty-tiers')
      this.items = data.tiers
      this.loaded = true
    },
    async create(payload) {
      const data = await api.post('/admin/loyalty-tiers', payload)
      this.items.push(data.tier)
      this.items.sort((a, b) => a.minPoints - b.minPoints)
    },
    async update(id, payload) {
      const data = await api.put(`/admin/loyalty-tiers/${id}`, payload)
      const idx = this.items.findIndex((t) => t.id === id)
      if (idx !== -1) this.items[idx] = data.tier
      this.items.sort((a, b) => a.minPoints - b.minPoints)
    },
    async remove(id) {
      await api.del(`/admin/loyalty-tiers/${id}`)
      this.items = this.items.filter((t) => t.id !== id)
    },
  },
})
