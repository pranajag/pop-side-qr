import { defineStore } from 'pinia'
import { loadJSON, saveJSON } from '@/lib/persist'
import { translations } from '@/lib/translations'

const STORAGE_KEY = 'popside.locale'

// Only translates this app's own UI chrome (labels, buttons, status text).
// Admin-authored content — product/category/variant names, order notes,
// server-side validation messages — has no English counterpart anywhere in
// this system and is shown exactly as the admin typed it, in both locales.
export const useLocaleStore = defineStore('locale', {
  state: () => ({ locale: loadJSON(localStorage, STORAGE_KEY, 'id') }),
  getters: {
    t: (state) => (key, params) => {
      const raw =
        translations[state.locale]?.[key] ?? translations.id[key] ?? key
      if (!params) return raw
      return Object.entries(params).reduce(
        (s, [k, v]) => s.replaceAll(`{${k}}`, v),
        raw
      )
    },
  },
  actions: {
    setLocale(locale) {
      this.locale = locale
      saveJSON(localStorage, STORAGE_KEY, locale)
    },
    toggle() {
      this.setLocale(this.locale === 'id' ? 'en' : 'id')
    },
  },
})
