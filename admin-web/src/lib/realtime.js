import { io } from 'socket.io-client'
import { ref } from 'vue'
import { api, API_URL } from '@/lib/api'

// Notifikasi realtime staff (api/src/realtime.js, Socket.IO). Satu koneksi
// per tab, dibuka AppShell setelah login dan ditutup saat keluar.
//
// Tokennya diambil lewat API biasa setiap kali (menyambung ulang juga):
// token berumur 60 detik itu diterbitkan route yang sama ketatnya dengan API
// (sesi + 2FA), dan tidak disimpan di mana pun di browser.
//
// VITE_REALTIME_URL: alamat API langsung (di hosting, API di domain lain dari
// dashboard — WebSocket tidak lewat proxy /api Vercel). Bawaan: asal
// VITE_API_URL.
const REALTIME_URL =
  import.meta.env.VITE_REALTIME_URL ||
  (API_URL.startsWith('http') ? new URL(API_URL).origin : window.location.origin)

export const realtimeTersambung = ref(false)
let socket = null

export function sambungRealtime() {
  if (socket) return socket
  socket = io(`${REALTIME_URL}/staff`, {
    path: '/api/realtime',
    transports: ['websocket', 'polling'],
    auth: (cb) => {
      api
        .get('/admin/realtime/token')
        .then((d) => cb({ token: d.token }))
        .catch(() => cb({}))
    },
    reconnectionDelayMax: 10000,
  })
  socket.on('connect', () => {
    realtimeTersambung.value = true
  })
  socket.on('disconnect', () => {
    realtimeTersambung.value = false
  })
  socket.on('connect_error', () => {
    realtimeTersambung.value = false
  })
  return socket
}

export function putuskanRealtime() {
  socket?.disconnect()
  socket = null
  realtimeTersambung.value = false
}

// Berlangganan satu event; mengembalikan fungsi berhenti-berlangganan
// (dipanggil di onUnmounted halaman yang memakainya).
export function dengarkan(event, handler) {
  const s = sambungRealtime()
  s.on(event, handler)
  return () => s.off(event, handler)
}
