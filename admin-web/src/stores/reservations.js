import { defineStore } from 'pinia'
import { api } from '@/lib/api'

export const useReservationsStore = defineStore('reservations', {
  state: () => ({ items: [], loading: false, statusFilter: undefined }),
  actions: {
    async fetchAll() {
      this.loading = true
      try {
        const query =
          this.statusFilter && this.statusFilter !== 'all'
            ? `?status=${this.statusFilter}`
            : ''
        const data = await api.get(`/admin/reservations${query}`)
        this.items = data.reservations
      } finally {
        this.loading = false
      }
    },
    setFilter(status) {
      this.statusFilter = status
      return this.fetchAll()
    },
    async create(payload) {
      const data = await api.post('/admin/reservations', payload)
      this.items.push(data.reservation)
    },
    async update(id, payload) {
      const data = await api.put(`/admin/reservations/${id}`, payload)
      const idx = this.items.findIndex((r) => r.id === id)
      if (idx !== -1) this.items[idx] = data.reservation
    },
    async updateStatus(id, status) {
      const data = await api.patch(`/admin/reservations/${id}/status`, {
        status,
      })
      const idx = this.items.findIndex((r) => r.id === id)
      if (idx !== -1) this.items[idx] = data.reservation
    },
    async remove(id) {
      await api.del(`/admin/reservations/${id}`)
      this.items = this.items.filter((r) => r.id !== id)
    },
  },
})
