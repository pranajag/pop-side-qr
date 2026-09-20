import { defineStore } from 'pinia'
import { api } from '@/lib/api'

export const useCustomersStore = defineStore('customers', {
  state: () => ({ items: [], loading: false }),
  actions: {
    async fetchAll(search) {
      this.loading = true
      try {
        const data = await api.get(
          `/admin/customers${search ? `?search=${encodeURIComponent(search)}` : ''}`
        )
        this.items = data.customers
      } finally {
        this.loading = false
      }
    },
    async get(id) {
      const data = await api.get(`/admin/customers/${id}`)
      return data.customer
    },
  },
})
