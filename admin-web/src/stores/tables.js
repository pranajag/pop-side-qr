import { defineStore } from 'pinia'
import { api } from '@/lib/api'

export const useTablesStore = defineStore('tables', {
  state: () => ({ items: [], loading: false }),
  actions: {
    async fetchAll() {
      this.loading = true
      try {
        const data = await api.get('/admin/tables')
        this.items = data.tables
      } finally {
        this.loading = false
      }
    },
    async create(payload) {
      const data = await api.post('/admin/tables', payload)
      this.items.push(data.table)
    },
    async update(id, payload) {
      const data = await api.put(`/admin/tables/${id}`, payload)
      const idx = this.items.findIndex((t) => t.id === id)
      if (idx !== -1) this.items[idx] = data.table
    },
    async remove(id) {
      await api.del(`/admin/tables/${id}`)
      this.items = this.items.filter((t) => t.id !== id)
    },
    async resetToken(id) {
      const data = await api.post(`/admin/tables/${id}/reset-token`)
      const idx = this.items.findIndex((t) => t.id === id)
      if (idx !== -1) this.items[idx] = data.table
    },
    async setBillOpen(id, isBillOpen) {
      const data = await api.patch(`/admin/tables/${id}/bill-open`, { isBillOpen })
      const idx = this.items.findIndex((t) => t.id === id)
      if (idx !== -1) this.items[idx] = data.table
    },
  },
})
