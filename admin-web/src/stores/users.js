import { defineStore } from 'pinia'
import { api } from '@/lib/api'

export const useUsersStore = defineStore('users', {
  state: () => ({ items: [], loading: false }),
  actions: {
    async fetchAll() {
      this.loading = true
      try {
        const data = await api.get('/admin/users')
        this.items = data.users
      } finally {
        this.loading = false
      }
    },
    async create(payload) {
      const data = await api.post('/admin/users', payload)
      this.items.push(data.user)
    },
    async update(id, payload) {
      const data = await api.put(`/admin/users/${id}`, payload)
      const idx = this.items.findIndex((u) => u.id === id)
      if (idx !== -1) this.items[idx] = data.user
    },
    // Mencabut 2FA seorang staff (HP hilang/ganti). Butuh PIN admin yang
    // melakukannya; semua sesi login akun itu dihapus server.
    async reset2fa(id, pin) {
      await api.post(`/admin/users/${id}/reset-2fa`, { pin })
      const user = this.items.find((u) => u.id === id)
      if (user) user.duaFaktorAktif = false
    },
    async remove(id) {
      await api.del(`/admin/users/${id}`)
      this.items = this.items.filter((u) => u.id !== id)
    },
  },
})
