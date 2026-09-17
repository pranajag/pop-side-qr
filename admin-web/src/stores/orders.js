import { defineStore } from 'pinia'
import { api } from '@/lib/api'

export const useOrdersStore = defineStore('orders', {
  state: () => ({ items: [], loading: false, statusFilter: undefined }),
  actions: {
    async fetchAll() {
      this.loading = true
      try {
        const query = this.statusFilter ? `?status=${this.statusFilter}` : ''
        const data = await api.get(`/admin/orders${query}`)
        this.items = data.orders
      } finally {
        this.loading = false
      }
    },
    setFilter(status) {
      this.statusFilter = status
      return this.fetchAll()
    },
    async confirmPayment(id) {
      const data = await api.post(`/admin/orders/${id}/konfirmasi`)
      this.replaceOrUpdate(data.order)
    },
    async updateStatus(id, status, catatan) {
      const data = await api.patch(`/admin/orders/${id}/status`, { status, catatan })
      this.replaceOrUpdate(data.order)
    },
    replaceOrUpdate(order) {
      const idx = this.items.findIndex((o) => o.id === order.id)
      // Order no longer matches the current filter (e.g. just completed
      // while viewing "Aktif") — drop it from the list instead of showing
      // a stale status.
      const stillMatches = this.matchesFilter(order.status)
      if (idx !== -1) {
        if (stillMatches) this.items[idx] = order
        else this.items.splice(idx, 1)
      } else if (stillMatches) {
        this.items.push(order)
      }
    },
    matchesFilter(status) {
      if (this.statusFilter === 'all') return true
      if (this.statusFilter) return status === this.statusFilter
      return status !== 'completed' && status !== 'cancelled'
    },
  },
})
