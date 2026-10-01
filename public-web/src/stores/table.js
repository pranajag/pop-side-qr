import { defineStore } from 'pinia'
import { api } from '@/lib/api'
import { loadJSON, saveJSON } from '@/lib/persist'
import { useCartStore } from '@/stores/cart'
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
  rombongan: null,
})

// `rombongan`: token QR rombongan reservasi (`?r=` di QR dari tombol "Mulai
// Pesanan" kasir). Selama reservasi terkonfirmasi memegang meja ini, hanya
// perangkat yang membawanya yang bisa memesan & membuka bill — server yang
// memutuskan setiap kali (api reservation.service.js aksesMejaPublik).
function urlMeja(token, rombongan) {
  const dasar = `/public/tables/${encodeURIComponent(token)}`
  return rombongan ? `${dasar}?r=${encodeURIComponent(rombongan)}` : dasar
}

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
    // Meja sedang dipegang rombongan reservasi dan perangkat ini bukan
    // rombongannya: menu hanya bisa dilihat.
    terkunci: (state) => state.reservasi?.terkunci === true,
  },
  actions: {
    async verify(token, rombonganBaru = null) {
      this.verifying = true
      // Scan ulang QR meja yang sama tanpa `?r=` (mis. stiker di meja) tidak
      // membuang token rombongan yang sudah dibawa perangkat ini.
      const rombongan = rombonganBaru ?? (token === this.token ? this.rombongan : null)
      try {
        const data = await api.get(urlMeja(token, rombongan))
        this.token = token
        this.rombongan = rombongan
        this.id = data.table.id
        this.nomorMeja = data.table.nomorMeja
        this.reservasi = data.table.reservasi ?? null
        this.reservasiDicek = Date.now()
        this.persist()
        // A cart built for a different (or no) table must not silently
        // carry over to this one — see cart.js's syncTable() for why.
        useCartStore().syncTable(this.id)
        // Draft checkout (catatan + nomor HP member) milik siapa pun yang
        // terakhir memakai perangkat ini tidak boleh terbawa ke sesi pesan
        // yang baru dimulai — lihat lib/checkoutDraft.js.
        hapusDraft()
        return true
      } catch {
        this.token = null
        this.id = null
        this.nomorMeja = null
        this.rombongan = null
        this.reservasi = null
        this.persist()
        return false
      } finally {
        this.verifying = false
      }
    },
    // paksa: server baru saja menolak karena meja dipegang reservasi
    // (MEJA_DIRESERVASI) — jangan tunggu jeda cek berikutnya.
    async perbaruiReservasi({ paksa = false } = {}) {
      if (!this.token) return
      if (!paksa && Date.now() - this.reservasiDicek < JEDA_CEK_RESERVASI_MS) return
      // Dicatat sebelum request supaya dua pemanggilan beruntun (menu lalu
      // checkout) tidak sama-sama mengirim.
      this.reservasiDicek = Date.now()
      try {
        const data = await api.get(urlMeja(this.token, this.rombongan))
        this.reservasi = data.table.reservasi ?? null
      } catch {
        // Kena rate limit atau jaringan putus: pakai yang terakhir diketahui.
      }
    },
    // Server menolak dengan MEJA_DIRESERVASI: kunci layar seketika, lalu
    // ambil detail reservasinya (jam) dari server.
    async tandaiTerkunci() {
      const sebelumnya = this.reservasi
      this.reservasi = {
        waktu: sebelumnya?.waktu ?? new Date().toISOString(),
        sudahMulai: sebelumnya?.sudahMulai ?? true,
        terkunci: true,
        rombongan: false,
      }
      await this.perbaruiReservasi({ paksa: true })
    },
    persist() {
      saveJSON(sessionStorage, STORAGE_KEY, {
        token: this.token,
        id: this.id,
        nomorMeja: this.nomorMeja,
        rombongan: this.rombongan,
      })
    },
  },
})
