<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useRecentOrdersStore } from '@/stores/recentOrders'
import { useLocaleStore } from '@/stores/locale'
import { STATUS_LABEL_KEY, STATUS_COLOR } from '@/lib/orderStatus'
import HitungMundur from '@/components/HitungMundur.vue'
import { ChevronRightIcon, ReceiptTextIcon } from '@lucide/vue'

// "Pesanan kamu": status pesanan milik perangkat ini, dari server (cookie
// perangkat, api GET /public/pesanan-saya) — bukan dari sesi meja di tab ini.
// Karena itu kartu ini juga tampil di layar "Scan QR" (MenuView, saat sesi
// meja tab ini hilang — tab ditutup lalu dibuka lagi dari riwayat, halaman
// dimuat ulang browser HP, dsb.): pesanan yang belum selesai harus selalu
// bisa dibuka lagi statusnya, termasuk sesudah menekan "Kembali ke Menu".
// Pesanan selesai hanya muncul selama struk digitalnya masih bisa diambil;
// tidak ada riwayat pesanan selesai. Diperbarui berkala selama halaman
// terlihat, dan langsung begitu kembali ke tab ini.
const recentOrders = useRecentOrdersStore()
const locale = useLocaleStore()
const router = useRouter()

const JEDA_RIWAYAT_MS = 30000
let timerRiwayat = null
function segarkanRiwayat() {
  if (document.visibilityState !== 'hidden') recentOrders.muat()
}
onMounted(() => {
  recentOrders.muat()
  timerRiwayat = setInterval(segarkanRiwayat, JEDA_RIWAYAT_MS)
  document.addEventListener('visibilitychange', segarkanRiwayat)
})
onUnmounted(() => {
  clearInterval(timerRiwayat)
  document.removeEventListener('visibilitychange', segarkanRiwayat)
})

// Struk pesanan selesai hilang sendiri setelah 5 menit — begitu hitung
// mundurnya habis, entrinya langsung lenyap dari kartu (server juga sudah
// tidak mengembalikannya di muat berikutnya).
function strukHabis(kodeOrder) {
  recentOrders.pesanan = recentOrders.pesanan.filter((o) => o.kodeOrder !== kodeOrder)
}

function bukaPesanan(kodeOrder) {
  router.push({ name: 'order', params: { kodeOrder } })
}
</script>

<template>
  <section
    v-if="recentOrders.pesanan.length > 0"
    class="space-y-2 rounded-2xl border border-primary/40 bg-primary/10 p-3 text-left"
  >
    <p class="px-0.5 text-xs font-semibold">{{ locale.t('pesananKamu') }}</p>
    <button
      v-for="order in recentOrders.pesanan"
      :key="order.kodeOrder"
      type="button"
      class="flex w-full items-center gap-2.5 rounded-xl bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent active:bg-accent"
      @click="bukaPesanan(order.kodeOrder)"
    >
      <ReceiptTextIcon v-if="order.status === 'completed'" class="size-4 shrink-0 text-status-completed" />
      <span v-else class="size-2.5 shrink-0 rounded-full" :class="STATUS_COLOR[order.status]" />
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-medium">{{ locale.t(STATUS_LABEL_KEY[order.status]) }}</span>
        <span
          v-if="order.status === 'completed' && order.strukBerlakuSampai"
          class="block truncate text-xs text-muted-foreground"
          >{{ locale.t('strukHilangSingkat') }}
          <HitungMundur :sampai="order.strukBerlakuSampai" @habis="strukHabis(order.kodeOrder)"
        /></span>
        <span v-else class="block truncate font-mono text-xs text-muted-foreground">{{ order.kodeOrder }}</span>
      </span>
      <span class="shrink-0 text-xs font-semibold text-primary-strong">{{
        locale.t(order.status === 'completed' ? 'lihatStruk' : 'lihatStatus')
      }}</span>
      <ChevronRightIcon class="size-4 shrink-0 text-muted-foreground" />
    </button>
  </section>
</template>
