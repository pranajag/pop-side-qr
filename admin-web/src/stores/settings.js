import { defineStore } from 'pinia'
import { api } from '@/lib/api'

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    qrisImage: null,
    namaToko: null,
    alamat: null,
    telepon: null,
    pajakPersen: 0,
    serviceChargePersen: 0,
    loading: false,
  }),
  actions: {
    applySettings(settings) {
      this.qrisImage = settings.qrisImage
      this.namaToko = settings.namaToko
      this.alamat = settings.alamat
      this.telepon = settings.telepon
      this.pajakPersen = settings.pajakPersen
      this.serviceChargePersen = settings.serviceChargePersen
    },
    async fetchSettings() {
      this.loading = true
      try {
        const data = await api.get('/admin/settings')
        this.applySettings(data.settings)
      } finally {
        this.loading = false
      }
    },
    async updateQris(file) {
      const fd = new FormData()
      fd.append('foto', file)
      const data = await api.put('/admin/settings/qris', fd, {
        isFormData: true,
      })
      this.qrisImage = data.settings.qrisImage
    },
    async updateStoreInfo(payload) {
      const data = await api.put('/admin/settings/toko', payload)
      this.applySettings(data.settings)
    },
  },
})
