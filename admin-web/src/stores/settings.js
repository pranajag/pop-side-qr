import { defineStore } from 'pinia'
import { api } from '@/lib/api'

export const useSettingsStore = defineStore('settings', {
  state: () => ({ qrisImage: null, loading: false }),
  actions: {
    async fetchSettings() {
      this.loading = true
      try {
        const data = await api.get('/admin/settings')
        this.qrisImage = data.settings.qrisImage
      } finally {
        this.loading = false
      }
    },
    async updateQris(file) {
      const fd = new FormData()
      fd.append('foto', file)
      const data = await api.put('/admin/settings/qris', fd, { isFormData: true })
      this.qrisImage = data.settings.qrisImage
    },
  },
})
