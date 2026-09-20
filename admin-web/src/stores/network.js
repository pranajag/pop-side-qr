import { defineStore } from 'pinia'

// navigator.onLine is a best-effort signal (true just means "has a network
// interface", not "can actually reach the internet") but it's exactly what
// the browser's own online/offline events are keyed on, so it's the
// cheapest honest thing to show — good enough for "WiFi obviously dropped"
// without pretending to ping the API on every render.
export const useNetworkStore = defineStore('network', {
  state: () => ({ isOnline: typeof navigator === 'undefined' ? true : navigator.onLine }),
  actions: {
    init() {
      window.addEventListener('online', () => {
        this.isOnline = true
      })
      window.addEventListener('offline', () => {
        this.isOnline = false
      })
    },
  },
})
