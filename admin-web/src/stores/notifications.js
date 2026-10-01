import { defineStore } from 'pinia'
import { api } from '@/lib/api'

const LAPORAN_KEY = 'popside.lastSeen.laporan'
const RIWAYAT_KEY = 'popside.lastSeen.riwayat'

function getLastSeen(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function setLastSeen(key, iso) {
  try {
    localStorage.setItem(key, iso)
  } catch {
    // Storage unavailable — badge just always reads as 0; nothing else
    // depends on this persisting.
  }
}

// Sidebar badges for Laporan/Riwayat Aktivitas: "how many ended shifts /
// activity-log entries happened since I last opened that page" — same idea
// as orders.needsActionCount, just for two pages that don't have their own
// notion of "pending" (a report/log has no pending state, only new-or-not).
export const useNotificationsStore = defineStore('notifications', {
  state: () => ({ laporanCount: 0, riwayatCount: 0 }),
  actions: {
    // No lastSeen yet (first run after this feature shipped, or a fresh
    // browser profile) seeds the baseline to right now instead of counting
    // every shift/log in the system's history as "new" — that would be a
    // wall of false positives on day one, not a useful signal.
    ensureBaseline(key) {
      let lastSeen = getLastSeen(key)
      if (!lastSeen) {
        lastSeen = new Date().toISOString()
        setLastSeen(key, lastSeen)
      }
      return lastSeen
    },
    // Satu angka dari server (satu COUNT) — bukan 50 shift lengkap dengan
    // hitungan uangnya, yang dulu diambil tiap 30 detik dan tiap ada
    // perubahan status pesanan (api shift.service.js jumlahSelesaiSejak).
    async checkLaporan() {
      const lastSeen = this.ensureBaseline(LAPORAN_KEY)
      const { jumlah } = await api.get(
        `/admin/shifts/jumlah-selesai?sejak=${encodeURIComponent(lastSeen)}`
      )
      this.laporanCount = jumlah
    },
    async checkRiwayat() {
      const lastSeen = this.ensureBaseline(RIWAYAT_KEY)
      const { logs } = await api.get('/admin/orders/activity-log?limit=20')
      this.riwayatCount = logs.filter(
        (l) => new Date(l.createdAt) > new Date(lastSeen)
      ).length
    },
    markLaporanSeen() {
      setLastSeen(LAPORAN_KEY, new Date().toISOString())
      this.laporanCount = 0
    },
    markRiwayatSeen() {
      setLastSeen(RIWAYAT_KEY, new Date().toISOString())
      this.riwayatCount = 0
    },
  },
})
