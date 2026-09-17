import { defineStore } from 'pinia'
import { api } from '@/lib/api'

export const useMenuStore = defineStore('menu', {
  state: () => ({ categories: [], loading: false, loaded: false }),
  actions: {
    async fetchMenu() {
      this.loading = true
      try {
        const data = await api.get('/public/menu')
        this.categories = data.categories
        this.loaded = true
      } finally {
        this.loading = false
      }
    },
    findProduct(productId) {
      for (const category of this.categories) {
        const product = category.products.find((p) => p.id === productId)
        if (product) return product
      }
      return null
    },
  },
})
