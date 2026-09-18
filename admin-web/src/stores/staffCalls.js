import { defineStore } from 'pinia'
import { api } from '@/lib/api'

export const useStaffCallsStore = defineStore('staffCalls', {
  state: () => ({ items: [], loading: false, knownIds: null }),
  actions: {
    async fetchPending() {
      this.loading = true
      try {
        const data = await api.get('/admin/staff-calls')
        this.items = data.calls
      } finally {
        this.loading = false
      }
    },
    async resolve(id) {
      await api.patch(`/admin/staff-calls/${id}/resolve`)
      this.items = this.items.filter((c) => c.id !== id)
    },
    // Same filter-independent shape as orders.checkForNewOrders — always
    // checks the pending set regardless of which page is currently open.
    async checkForNewCalls() {
      const data = await api.get('/admin/staff-calls')
      const currentIds = new Set(data.calls.map((c) => c.id))
      const freshCalls = this.knownIds ? data.calls.filter((c) => !this.knownIds.has(c.id)) : []
      this.knownIds = currentIds
      return freshCalls
    },
  },
})
