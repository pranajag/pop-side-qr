import { defineStore } from 'pinia'
import { api } from '@/lib/api'

export const useReservationsStore = defineStore('reservations', {
  // aturanDp: aturan DP toko — dipakai form untuk mengisi DP wajib otomatis.
  state: () => ({
    items: [],
    loading: false,
    statusFilter: undefined,
    aturanDp: { nominal: 0, perTamu: false },
  }),
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
    // Mengembalikan hasil lengkap (baruLunas, dikonfirmasiOtomatis, kurang)
    // supaya halaman bisa memberi tahu staff kalau DP yang dibayar saat
    // membuat reservasi langsung melunasinya.
    async create(payload) {
      const data = await api.post('/admin/reservations', payload)
      this.items.push(data.reservation)
      return data
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
    async catatPembayaranDp(id, { amount, metode }) {
      const data = await api.post(`/admin/reservations/${id}/pembayaran-dp`, { amount, metode })
      const idx = this.items.findIndex((r) => r.id === id)
      if (idx !== -1) this.items[idx] = data.reservation
      return data
    },
    async fetchAturanDp() {
      const data = await api.get('/admin/reservations/aturan-dp')
      this.aturanDp = data.aturanDp
    },
    // Admin saja (server menolak kasir) — tombolnya pun hanya muncul untuk admin.
    async updateAturanDp(payload) {
      const data = await api.patch('/admin/settings/reservasi-dp', payload)
      this.aturanDp = data.aturanDp
    },
    async remove(id) {
      await api.del(`/admin/reservations/${id}`)
      this.items = this.items.filter((r) => r.id !== id)
    },
  },
})
