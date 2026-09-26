import { io } from 'socket.io-client'
import { ref } from 'vue'
import { api, API_URL } from '@/lib/api'

// Notifikasi realtime untuk HP customer (api/src/realtime.js, Socket.IO):
// status pesanan berubah seketika (bukan menunggu polling), dan status
// buka/tutup kafe langsung ikut begitu staff memulai/mengakhiri shift.
//
// Berlangganan status pesanan butuh token dari API (GET
// /public/orders/:kode/realtime) yang hanya diberikan ke perangkat pemesan
// — aturan yang sama dengan pelacakan biasa. Token berumur 60 detik, tidak
// disimpan di mana pun.
//
// VITE_REALTIME_URL: alamat API langsung (di hosting, WebSocket tidak lewat
// proxy /api Vercel). Bawaan: asal VITE_API_URL.
const REALTIME_URL =
  import.meta.env.VITE_REALTIME_URL ||
  (API_URL.startsWith('http') ? new URL(API_URL).origin : window.location.origin)

export const realtimeTersambung = ref(false)
let socket = null
const orderDilacak = new Set()
// Token dipakai ulang kalau koneksi putus-sambung sebelum umurnya habis —
// sinyal HP yang naik-turun tidak menghabiskan jatah 5 request/menit/kode
// order yang juga dipakai halaman status (AGENTS.md). Hanya di memori.
const PAKAI_ULANG_TOKEN_MS = 50 * 1000
const tokenLacak = new Map()

async function kirimLacak(kodeOrder) {
  try {
    let simpanan = tokenLacak.get(kodeOrder)
    if (!simpanan || Date.now() - simpanan.didapat > PAKAI_ULANG_TOKEN_MS) {
      const { token } = await api.get(`/public/orders/${encodeURIComponent(kodeOrder)}/realtime`)
      simpanan = { token, didapat: Date.now() }
      tokenLacak.set(kodeOrder, simpanan)
    }
    socket?.emit('lacak', { token: simpanan.token })
  } catch {
    // Bukan perangkat pemesan / order tidak ada — polling tetap jalan.
  }
}

function sambung() {
  if (socket) return socket
  socket = io(`${REALTIME_URL}/publik`, {
    path: '/api/realtime',
    transports: ['websocket', 'polling'],
    reconnectionDelayMax: 15000,
  })
  socket.on('connect', () => {
    realtimeTersambung.value = true
    // Menyambung ulang = langganan lama hilang di server; daftarkan lagi.
    for (const kode of orderDilacak) kirimLacak(kode)
  })
  socket.on('disconnect', () => {
    realtimeTersambung.value = false
  })
  return socket
}

export function lacakOrder(kodeOrder) {
  const s = sambung()
  if (orderDilacak.has(kodeOrder)) return
  orderDilacak.add(kodeOrder)
  if (s.connected) kirimLacak(kodeOrder)
}

export function berhentiLacak(kodeOrder) {
  orderDilacak.delete(kodeOrder)
  tokenLacak.delete(kodeOrder)
}

// Berlangganan satu event; mengembalikan fungsi berhenti-berlangganan.
export function dengarkan(event, handler) {
  const s = sambung()
  s.on(event, handler)
  return () => s.off(event, handler)
}
