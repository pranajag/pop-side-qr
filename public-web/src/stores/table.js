import { defineStore } from 'pinia'
import { api } from '@/lib/api'
import { loadJSON, saveJSON } from '@/lib/persist'

const STORAGE_KEY = 'popside.table'

// sessionStorage, not localStorage — "currently sitting at this table" is
// a per-visit fact, not something that should quietly outlive the tab.
const initial = loadJSON(sessionStorage, STORAGE_KEY, { token: null, id: null, nomorMeja: null })

export const useTableStore = defineStore('table', {
  state: () => ({ ...initial, verifying: false }),
  getters: {
    isVerified: (state) => state.id !== null,
  },
  actions: {
    async verify(token) {
      this.verifying = true
      try {
        const data = await api.get(`/public/tables/${encodeURIComponent(token)}`)
        this.token = token
        this.id = data.table.id
        this.nomorMeja = data.table.nomorMeja
        this.persist()
        return true
      } catch {
        this.token = null
        this.id = null
        this.nomorMeja = null
        this.persist()
        return false
      } finally {
        this.verifying = false
      }
    },
    persist() {
      saveJSON(sessionStorage, STORAGE_KEY, { token: this.token, id: this.id, nomorMeja: this.nomorMeja })
    },
  },
})
