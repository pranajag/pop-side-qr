import { defineStore } from 'pinia'
import { api } from '@/lib/api'

// Kartu "Pesanan kamu" di menu. Sumbernya server: GET /public/pesanan-saya
// mengembalikan order milik perangkat ini (cookie perangkat httpOnly — aturan
// yang sama dengan pelacakan status, jadi perangkat lain tidak bisa melihat)
// yang masih berjalan, plus yang baru selesai selama struk digitalnya masih
// bisa diambil (api order.service.js JENDELA_STRUK_MS). Riwayat pesanan yang
// sudah selesai sengaja tidak ada — tidak di server, tidak juga di perangkat.
const KUNCI_RIWAYAT_LAMA = 'popside.recentOrders'

export const useRecentOrdersStore = defineStore('recentOrders', {
  state: () => {
    // Versi lama menyimpan daftar kode order di localStorage sebagai riwayat
    // cadangan — dibuang sekali, karena riwayat itu tidak boleh ada lagi.
    try {
      localStorage.removeItem(KUNCI_RIWAYAT_LAMA)
    } catch {
      // Storage tidak tersedia — memang tidak ada yang perlu dibuang.
    }
    // Dari server, terbaru dulu: { kodeOrder, status, metode, totalHarga,
    // createdAt, nomorMeja, ringkasan, strukBerlakuSampai }.
    return { pesanan: [] }
  },
  actions: {
    async muat() {
      try {
        const { orders } = await api.get('/public/pesanan-saya')
        this.pesanan = orders
      } catch {
        // Offline / server tidak menjawab — kartu tetap berisi hasil terakhir.
      }
    },
  },
})
