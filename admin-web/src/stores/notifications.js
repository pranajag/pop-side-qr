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
    async checkLaporan() {
      const lastSeen = this.ensureBaseline(LAPORAN_KEY)
      const { shifts } = await api.get('/admin/shifts?limit=50')
      this.laporanCount = shifts.filter(
        (s) => s.endedAt && new Date(s.endedAt) > new Date(lastSeen)
      ).length
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
