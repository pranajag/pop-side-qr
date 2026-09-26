import { defineStore } from 'pinia'
import { api } from '@/lib/api'
import { loadJSON, saveJSON } from '@/lib/persist'
import { useCartStore } from '@/stores/cart'
import { useRecentOrdersStore } from '@/stores/recentOrders'
import { hapusDraft } from '@/lib/checkoutDraft'

const STORAGE_KEY = 'popside.table'

// Info reservasi berubah seiring waktu (pemberitahuan mulai 30 menit sebelum
// jam reservasi), jadi dicek ulang di titik penting — menu dibuka setelah
// reload, dan tepat sebelum checkout. Sengaja tidak di-polling: endpoint meja
// dibatasi ketat per IP (penjaga tebak token QR, api rateLimit.js), dan satu
// WiFi kafe bisa berarti banyak customer berbagi IP yang sama.
const JEDA_CEK_RESERVASI_MS = 30 * 1000

// sessionStorage, not localStorage — "currently sitting at this table" is
// a per-visit fact, not something that should quietly outlive the tab.
const initial = loadJSON(sessionStorage, STORAGE_KEY, {
  token: null,
  id: null,
  nomorMeja: null,
})

export const useTableStore = defineStore('table', {
  // reservasi tidak ikut disimpan ke sessionStorage: itu fakta "saat ini",
  // yang harus dicek ulang, bukan diingat.
  state: () => ({
    ...initial,
    verifying: false,
    reservasi: null,
    reservasiDicek: 0,
    reservasiDiberitahu: null,
  }),
  getters: {
    isVerified: (state) => state.id !== null,
  },
  actions: {
    async verify(token) {
      this.verifying = true
      try {
        const data = await api.get(
          `/public/tables/${encodeURIComponent(token)}`
        )
        this.token = token
        this.id = data.table.id
        this.nomorMeja = data.table.nomorMeja
        this.reservasi = data.table.reservasi ?? null
        this.reservasiDicek = Date.now()
        this.persist()
        // A cart built for a different (or no) table must not silently
        // carry over to this one — see cart.js's syncTable() for why.
        useCartStore().syncTable(this.id)
        // Same idea for "Pesanan Saya": a fresh scan means a fresh visit,
        // and the table bill has already dropped the previous group's
        // orders by this exact cutoff. Keeping stale kode order around
        // would just link to orders that are done, or gone entirely.
        useRecentOrdersStore().pruneBefore(data.table.currentVisitStartedAt)
        // Draft checkout (catatan + nomor HP member) milik siapa pun yang
        // terakhir memakai perangkat ini tidak boleh terbawa ke sesi pesan
        // yang baru dimulai — lihat lib/checkoutDraft.js.
        hapusDraft()
        return true
      } catch {
        this.token = null
        this.id = null
        this.nomorMeja = null
        this.reservasi = null
        this.persist()
        return false
      } finally {
        this.verifying = false
      }
    },
    async perbaruiReservasi() {
      if (!this.token) return
      if (Date.now() - this.reservasiDicek < JEDA_CEK_RESERVASI_MS) return
      // Dicatat sebelum request supaya dua pemanggilan beruntun (menu lalu
      // checkout) tidak sama-sama mengirim.
      this.reservasiDicek = Date.now()
      try {
        const data = await api.get(`/public/tables/${encodeURIComponent(this.token)}`)
        this.reservasi = data.table.reservasi ?? null
      } catch {
        // Kena rate limit atau jaringan putus: pakai yang terakhir diketahui.
      }
    },
    persist() {
      saveJSON(sessionStorage, STORAGE_KEY, {
        token: this.token,
        id: this.id,
        nomorMeja: this.nomorMeja,
      })
    },
  },
})
