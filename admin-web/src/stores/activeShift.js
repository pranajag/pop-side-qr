import { defineStore } from 'pinia'
import { api } from '@/lib/api'

// Shared between ShiftView.vue (its own richer local state) and anywhere
// that just needs a yes/no "can I confirm/progress an order right now" —
// OrdersView.vue and ManualOrderView.vue, gating the same shift
// requirement the server itself enforces (orderManagement.service.js's
// assertActiveShift). This is a UX convenience (disable the button, show
// why, before the user even tries) — the server-side check is what
// actually matters for correctness, this just avoids a surprise 403.
export const useActiveShiftStore = defineStore('activeShift', {
  state: () => ({ shift: null, loaded: false }),
  getters: {
    hasActiveShift: (state) => state.shift !== null,
  },
  actions: {
    async fetch() {
      try {
        const data = await api.get('/admin/shifts/active')
        this.shift = data.shift
      } finally {
        this.loaded = true
      }
    },
  },
})
