import { defineStore } from 'pinia'
import { api } from '@/lib/api'

export const useOrdersStore = defineStore('orders', {
  state: () => ({ items: [], loading: false, statusFilter: undefined, knownActiveIds: null, needsActionCount: 0 }),
  actions: {
    // Filter-independent: fetches the full active set regardless of
    // whatever statusFilter the Pesanan grid currently has selected, so a
    // new order is noticed even while viewing a narrow tab (or a different
    // page entirely — AppShell polls this, not OrdersView). knownActiveIds
    // stays null until the first successful check so we never report every
    // pre-existing order as "new" right after login/reload.
    async checkForNewOrders() {
      const data = await api.get('/admin/orders')
      const currentIds = new Set(data.orders.map((o) => o.id))
      const freshOrders = this.knownActiveIds ? data.orders.filter((o) => !this.knownActiveIds.has(o.id)) : []
      this.knownActiveIds = currentIds
      // Sidebar badge count — orders sitting in a state that needs a kasir
      // to act (confirm payment), independent of whatever filter the
      // Pesanan grid itself currently has selected.
      this.needsActionCount = data.orders.filter((o) => o.status === 'pending' || o.status === 'waiting_verif').length
      return freshOrders
    },
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
    async createManual(payload) {
      const data = await api.post('/admin/orders/manual', payload)
      this.replaceOrUpdate(data.order)
      return data.order
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
