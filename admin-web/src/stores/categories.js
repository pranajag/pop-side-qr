import { defineStore } from 'pinia'
import { api } from '@/lib/api'

export const useCategoriesStore = defineStore('categories', {
  state: () => ({ items: [], loading: false }),
  actions: {
    async fetchAll() {
      this.loading = true
      try {
        const data = await api.get('/admin/categories')
        this.items = data.categories
      } finally {
        this.loading = false
      }
    },
    async create(payload) {
      const data = await api.post('/admin/categories', payload)
      this.items.push(data.category)
      this.items.sort((a, b) => a.urutan - b.urutan)
    },
    async update(id, payload) {
      const data = await api.put(`/admin/categories/${id}`, payload)
      const idx = this.items.findIndex((c) => c.id === id)
      if (idx !== -1) this.items[idx] = data.category
      this.items.sort((a, b) => a.urutan - b.urutan)
    },
    async remove(id) {
      await api.del(`/admin/categories/${id}`)
      this.items = this.items.filter((c) => c.id !== id)
    },
  },
})
