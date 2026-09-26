import { defineStore } from 'pinia'
import { loadJSON, saveJSON } from '@/lib/persist'

const STORAGE_KEY = 'popside.recentOrders'
const MAX_RECENT = 10

// Pure recovery mechanism for "closed the tab and forgot the kode order" —
// a kodeOrder plus the moment it was placed, nothing else. No live status
// here; that's what clicking through to /pesanan/:kodeOrder is for.
//
// The stored shape used to be a bare array of kodeOrder strings. Entries
// migrated from it have no `waktu`, so the first pruneBefore() drops them —
// which is the right call: an order old enough to predate this format
// belongs to an earlier visit anyway, and some of those codes point at
// orders that no longer exist at all.
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
  }),
  getters: {
    items: (state) => state.entries.map((entry) => entry.kodeOrder),
  },
  actions: {
    add(kodeOrder, createdAt) {
      this.entries = [
        { kodeOrder, waktu: createdAt ?? new Date().toISOString() },
        ...this.entries.filter((entry) => entry.kodeOrder !== kodeOrder),
      ].slice(0, MAX_RECENT)
      this.persist()
    },
    // Same rule the table bill already uses (order.service.js's
    // getTableBill filters on currentVisitStartedAt): anything placed
    // before this visit started belongs to whoever sat here earlier, so it
    // has no business showing up in this visit's "Pesanan Saya" either.
    // Called from the table store right after a QR scan resolves, which is
    // the only moment the customer is definitely starting fresh — an open
    // tab keeps showing its own just-finished orders.
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
