import { defineStore } from 'pinia'
import { api } from '@/lib/api'
import { loadJSON, saveJSON } from '@/lib/persist'

const STORAGE_KEY = 'popside.recentOrders'
const MAX_RECENT = 10
const SELESAI = new Set(['completed', 'cancelled'])

// "Pesanan Saya". Sumber utamanya server: GET /public/pesanan-saya
// mengembalikan order milik perangkat ini (cookie perangkat httpOnly — aturan
// yang sama dengan pelacakan status, jadi perangkat lain tidak bisa melihat)
// dalam 24 jam terakhir, lengkap dengan statusnya. Daftar itu tidak hilang
// walau halaman status ditutup, QR dipindai ulang, atau pesanan sudah selesai.
//
// Daftar kode di localStorage tinggal cadangan saat server tidak bisa
// dijangkau (offline) — isinya hanya kode order + waktu, tanpa harga
// (AGENTS.md).
//
// Bentuk lama berupa array kode polos. Entri migrasi darinya tidak punya
// `waktu`, jadi pruneBefore() pertama membuangnya.
function normalize(stored) {
  if (!Array.isArray(stored)) return []
  return stored
    .map((entry) =>
      typeof entry === 'string'
        ? { kodeOrder: entry, waktu: null }
        : { kodeOrder: entry?.kodeOrder ?? null, waktu: entry?.waktu ?? null }
    )
    .filter((entry) => entry.kodeOrder)
}

export const useRecentOrdersStore = defineStore('recentOrders', {
  state: () => ({
    entries: normalize(loadJSON(localStorage, STORAGE_KEY, [])),
    // Dari server, terbaru dulu: { kodeOrder, status, metode, totalHarga,
    // createdAt, nomorMeja, ringkasan }.
    pesanan: [],
    dimuat: false,
  }),
  getters: {
    // Yang ditampilkan: daftar server begitu berhasil dimuat; sebelum itu
    // (atau saat offline) kode dari localStorage tanpa status.
    daftar: (state) =>
      state.dimuat
        ? state.pesanan
        : state.entries.map((entry) => ({ kodeOrder: entry.kodeOrder, status: null, createdAt: entry.waktu })),
    aktif: (state) => (state.dimuat ? state.pesanan.filter((order) => !SELESAI.has(order.status)) : []),
  },
  actions: {
    add(kodeOrder, createdAt) {
      this.entries = [
        { kodeOrder, waktu: createdAt ?? new Date().toISOString() },
        ...this.entries.filter((entry) => entry.kodeOrder !== kodeOrder),
      ].slice(0, MAX_RECENT)
      this.persist()
    },
    async muat() {
      try {
        const { orders } = await api.get('/public/pesanan-saya')
        this.pesanan = orders
        this.dimuat = true
      } catch {
        // Offline / server tidak menjawab — daftar lokal tetap dipakai.
      }
    },
    // Hanya untuk cadangan lokal: kode dari kunjungan sebelumnya di meja ini
    // (tamu lain) dibuang saat QR dipindai. Daftar dari server sudah terikat
    // perangkat ini sendiri, jadi tidak terpengaruh.
    pruneBefore(visitStartedAt) {
      if (!visitStartedAt) return
      const batas = new Date(visitStartedAt).getTime()
      if (Number.isNaN(batas)) return
      const tersisa = this.entries.filter(
        (entry) => entry.waktu !== null && new Date(entry.waktu).getTime() >= batas
      )
      if (tersisa.length === this.entries.length) return
      this.entries = tersisa
      this.persist()
    },
    persist() {
      saveJSON(localStorage, STORAGE_KEY, this.entries)
    },
  },
})
