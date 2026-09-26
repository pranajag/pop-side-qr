import { defineStore } from 'pinia'
import { api } from '@/lib/api'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null,
    ready: false,
  }),
  getters: {
    isAuthenticated: (state) => !!state.user,
    isAdmin: (state) => state.user?.role === 'admin',
  },
  actions: {
    async init() {
      if (this.ready) return
      // A CSRF token is needed either way: to submit the login form, or
      // (if a session cookie from before is still valid) as the token for
      // whatever the first protected request after /me turns out to be.
      await this.refreshCsrfToken()
      try {
        const data = await api.get('/auth/me')
        this.user = data.user
      } catch {
        this.user = null
      } finally {
        this.ready = true
      }
    },
    async refreshCsrfToken() {
      const data = await api.get('/auth/csrf-token')
      api.setCsrfToken(data.csrfToken)
    },
    // Mengembalikan null kalau login selesai, atau 'kode-2fa' / 'setup-2fa'
    // kalau akun ini wajib 2FA (admin) — belum login sampai langkah itu lulus.
    async login(username, password) {
      const data = await api.post('/auth/login', { username, password })
      if (data.langkah) return data.langkah
      this.selesaikanLogin(data)
      return null
    },
    // Login regenerates the session id server-side, which invalidates the
    // pre-login CSRF token — the response carries a fresh one.
    selesaikanLogin(data) {
      this.user = data.user
      api.setCsrfToken(data.csrfToken)
    },
    // { rahasia, otpauthUrl, qrDataUrl } untuk dipindai aplikasi authenticator.
    async mulaiSetup2fa() {
      return api.post('/auth/2fa/setup')
    },
    // Mengembalikan kode cadangan (ditampilkan sekali).
    async aktifkan2fa(kode) {
      const data = await api.post('/auth/2fa/aktifkan', { kode })
      this.selesaikanLogin(data)
      return data.kodePemulihan
    },
    async verifikasi2fa(kode) {
      const data = await api.post('/auth/2fa/verifikasi', { kode })
      this.selesaikanLogin(data)
      return data
    },
    async logout() {
      try {
        await api.post('/auth/logout')
      } finally {
        this.user = null
        await this.refreshCsrfToken()
      }
    },
  },
})
