import { defineStore } from 'pinia'
import { api } from '@/lib/api'
import { dengarkan } from '@/lib/realtime'

// Seberapa sering status kafe dicek ulang selama halaman terbuka. Saat tutup
// dicek lebih rapat supaya customer yang menunggu di menu langsung bisa
// pesan begitu staff mulai shift, tanpa harus reload. Saat buka cukup
// jarang — kalau kafe keburu tutup, checkout mengecek ulang sendiri dan
// server tetap menolak ordernya.
//
// Sengaja tidak lebih rapat: /public/settings dibatasi per IP (api
// rateLimit.js), dan satu WiFi kafe bisa berarti banyak customer berbagi
// satu IP. Perubahan buka/tutup yang sebenarnya datang seketika lewat
// realtime (event kafe:status) — pengecekan berkala ini hanya cadangan.
const JEDA_SAAT_TUTUP_MS = 30 * 1000
const JEDA_SAAT_BUKA_MS = 2 * 60 * 1000
const DETAK_MS = 15 * 1000

let sedangDipantau = false

// Is the cafe actually open for orders — i.e. is any staff clocked into a
// shift. Kept separate from the menu: the menu is safe to browse whenever,
// but an order placed with nobody on duty has no one to confirm payment,
// cook it, or hand it over, so it would just sit pending until someone
// finds it later with a customer already waiting at the table.
//
// Advisory only. api/src/services/order.service.js refuses the order for
// real; this exists so the customer learns on the menu screen instead of
// after building a whole cart.
export const useCafeStatusStore = defineStore('cafeStatus', {
  // memberEnabled rides along on the same request: the checkout screen has
  // to know whether to ask for a phone number at all, and that answer comes
  // from the same settings payload. Defaults to true so a failed/old
  // response never hides a feature that is actually on.
  state: () => ({
    sedangBuka: true,
    memberEnabled: true,
    loaded: false,
    terakhirDicek: 0,
  }),
  getters: {
    tutup: (state) => state.loaded && !state.sedangBuka,
  },
  actions: {
    async fetch() {
      try {
        const data = await api.get('/public/settings')
        this.sedangBuka = data.sedangBuka !== false
        this.memberEnabled = data.settings?.memberEnabled !== false
      } catch {
        // First load failing: unreachable API is the offline banner's job
        // to explain, so assume open rather than showing "tutup" for what
        // is really a connection problem. A later refresh failing (one
        // rate-limited poll, a WiFi blip) keeps what was last known —
        // flipping a closed cafe to "open" because a single check failed
        // is exactly the wrong way to fail.
        if (!this.loaded) this.sedangBuka = true
      } finally {
        this.loaded = true
        this.terakhirDicek = Date.now()
      }
    },
    // Dipanggil sekali dari App.vue, hidup selama aplikasi terbuka. Cuma
    // mengecek saat tab benar-benar terlihat — tab di latar belakang tidak
    // ikut menghabiskan jatah rate limit.
    pantau() {
      if (sedangDipantau || typeof document === 'undefined') return
      sedangDipantau = true

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.fetch()
      })
      // Staff mulai/akhiri shift -> semua HP customer langsung tahu kafe
      // buka/tutup (api realtime.js), tanpa menunggu pengecekan berikutnya.
      dengarkan('kafe:status', (isi) => {
        if (typeof isi?.sedangBuka !== 'boolean') return
        this.sedangBuka = isi.sedangBuka
        this.loaded = true
        this.terakhirDicek = Date.now()
      })
      setInterval(() => {
        if (document.visibilityState !== 'visible' || !this.loaded) return
        const jeda = this.sedangBuka ? JEDA_SAAT_BUKA_MS : JEDA_SAAT_TUTUP_MS
        if (Date.now() - this.terakhirDicek >= jeda) this.fetch()
      }, DETAK_MS)
    },
  },
})
