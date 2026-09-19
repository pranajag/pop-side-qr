import { defineStore } from 'pinia'

const STORAGE_KEY = 'popside.theme'

// The inline script in index.html already applied (or didn't apply) .dark
// to <html> before Vue/Pinia even loaded, using the same localStorage key —
// this store just mirrors that decision instead of re-deciding it, so
// there's exactly one place that reads localStorage/prefers-color-scheme on
// first load, and no risk of the two disagreeing.
export const useThemeStore = defineStore('theme', {
  state: () => ({
    isDark: document.documentElement.classList.contains('dark'),
  }),
  actions: {
    toggle() {
      this.isDark = !this.isDark
      document.documentElement.classList.toggle('dark', this.isDark)
      try {
        localStorage.setItem(STORAGE_KEY, this.isDark ? 'dark' : 'light')
      } catch {
        // Storage unavailable (private mode, quota, disabled) — the toggle
        // still works for this page view, it just won't survive a reload.
      }
    },
  },
})
