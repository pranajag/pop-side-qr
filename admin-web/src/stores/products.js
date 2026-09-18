import { defineStore } from 'pinia'
import { api } from '@/lib/api'

function toFormData(payload) {
  const fd = new FormData()
  for (const [key, value] of Object.entries(payload)) {
    // undefined foto = "keep the existing photo" (see api product.service) —
    // must be omitted, not sent as the string "undefined".
    if (value === undefined || value === null) continue
    if (value instanceof File) {
      fd.append(key, value)
    } else if (Array.isArray(value)) {
      // Multipart fields are flat strings — variantGroups is the one
      // nested-array field, sent JSON-stringified (api/product.validator
      // parses it back out).
      fd.append(key, JSON.stringify(value))
    } else {
      fd.append(key, String(value))
    }
  }
  return fd
}

export const useProductsStore = defineStore('products', {
  state: () => ({ items: [], loading: false }),
  actions: {
    async fetchAll() {
      this.loading = true
      try {
        const data = await api.get('/admin/products')
        this.items = data.products
      } finally {
        this.loading = false
      }
    },
    async create(payload) {
      const data = await api.post('/admin/products', toFormData(payload), { isFormData: true })
      this.items.push(data.product)
    },
    async update(id, payload) {
      const data = await api.put(`/admin/products/${id}`, toFormData(payload), { isFormData: true })
      const idx = this.items.findIndex((p) => p.id === id)
      if (idx !== -1) this.items[idx] = data.product
    },
    async remove(id) {
      await api.del(`/admin/products/${id}`)
      this.items = this.items.filter((p) => p.id !== id)
    },
  },
})
