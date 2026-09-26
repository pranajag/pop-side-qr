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
    memberEnabled: true,
    // Konfirmasi pembayaran order dengan total >= ini wajib PIN staff.
    // null = PIN tidak pernah diminta; 0 = setiap pembayaran.
    pinVerifikasiMinimal: 200000,
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
      this.memberEnabled = settings.memberEnabled !== false
      if (settings.pinVerifikasiMinimal !== undefined) this.pinVerifikasiMinimal = settings.pinVerifikasiMinimal
    },
    async updatePinVerifikasi(minimal) {
      const data = await api.patch('/admin/settings/pin-verifikasi', { minimal })
      this.pinVerifikasiMinimal = data.pinVerifikasi.minimal
    },
    // Its own endpoint, not part of the store-info form — flipping this
    // must not resend (and risk overwriting) the receipt header and tax
    // rates that happen to be loaded on another screen.
    async setMemberEnabled(memberEnabled) {
      const data = await api.patch('/admin/settings/member', { memberEnabled })
      this.applySettings(data.settings)
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
