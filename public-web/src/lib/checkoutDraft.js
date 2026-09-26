import { loadJSON, saveJSON } from '@/lib/persist'

// Catatan dan nomor HP member yang sedang diketik di checkout — supaya
// tidak hilang kalau halaman tidak sengaja ter-reload atau tombol back
// tersentuh. sessionStorage, bukan localStorage: ini coretan satu sesi
// pesan, bukan sesuatu yang boleh masih ada seminggu kemudian.
//
// Ditandai dengan meja, dan dibuang setiap kali QR discan (stores/table.js).
// Tanpa itu, di perangkat yang dipakai bergantian — tablet di meja, HP
// staff yang dipakai demo — nomor HP customer sebelumnya muncul sendiri di
// checkout orang berikutnya, lalu poin dan diskon membernya masuk ke orang
// yang salah.
const DRAFT_KEY = 'popside.checkoutDraft'

export function simpanDraft(tableId, { catatan, customerPhone }) {
  saveJSON(sessionStorage, DRAFT_KEY, { tableId, catatan, customerPhone })
}

// Hanya draft milik meja ini yang dikembalikan. Draft format lama (tanpa
// tableId) diperlakukan sebagai milik orang lain.
export function muatDraft(tableId) {
  const draft = loadJSON(sessionStorage, DRAFT_KEY, null)
  if (!draft || tableId == null || draft.tableId !== tableId) return null
  return draft
}

export function hapusDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    // Storage tidak bisa diakses — tidak ada yang perlu dibersihkan.
  }
}
