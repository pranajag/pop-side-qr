import { defineStore } from 'pinia'
import { loadJSON, saveJSON } from '@/lib/persist'

const STORAGE_KEY = 'popside.recentOrders'
const MAX_RECENT = 10

// Pure recovery mechanism for "closed the tab and forgot the kode order" —
// just kodeOrder strings, nothing else. No live status here; that's what
// clicking through to /pesanan/:kodeOrder is for.
const initialOrders = loadJSON(localStorage, STORAGE_KEY, [])

export const useRecentOrdersStore = defineStore('recentOrders', {
  state: () => ({ items: initialOrders }),
  actions: {
    add(kodeOrder) {
      this.items = [kodeOrder, ...this.items.filter((k) => k !== kodeOrder)].slice(0, MAX_RECENT)
      saveJSON(localStorage, STORAGE_KEY, this.items)
    },
  },
})
