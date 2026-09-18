<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useOrdersStore } from '@/stores/orders'
import { useStaffCallsStore } from '@/stores/staffCalls'
import { Button } from '@/components/ui/button'
import logoUrl from '@/assets/pop-side-logo.jpg'
import { playNotifySound } from '@/lib/notifySound'
import { formatRupiah } from '@/lib/format'
import {
  ClipboardListIcon,
  TimerIcon,
  LayoutGridIcon,
  UtensilsIcon,
  QrCodeIcon,
  BarChart3Icon,
  HistoryIcon,
  UsersIcon,
  SettingsIcon,
  LogOutIcon,
} from '@lucide/vue'
import { toast } from 'vue-sonner'

const auth = useAuthStore()
const router = useRouter()
const orders = useOrdersStore()
const staffCalls = useStaffCallsStore()

const nav = computed(() => {
  const items = [
    { to: { name: 'pesanan' }, label: 'Pesanan', icon: ClipboardListIcon },
    { to: { name: 'shift' }, label: 'Shift', icon: TimerIcon },
  ]
  if (auth.isAdmin) {
    items.push(
      { to: { name: 'kategori' }, label: 'Kategori', icon: LayoutGridIcon },
      { to: { name: 'produk' }, label: 'Produk', icon: UtensilsIcon },
      { to: { name: 'meja' }, label: 'Meja', icon: QrCodeIcon },
      { to: { name: 'laporan' }, label: 'Laporan', icon: BarChart3Icon },
      { to: { name: 'riwayat' }, label: 'Riwayat Aktivitas', icon: HistoryIcon },
      { to: { name: 'akun' }, label: 'Akun Staff', icon: UsersIcon },
      { to: { name: 'pengaturan' }, label: 'Pengaturan', icon: SettingsIcon }
    )
  }
  return items
})

async function onLogout() {
  await auth.logout()
  router.replace({ name: 'login' })
  toast('Berhasil keluar')
}

// Runs here (not in OrdersView) so a new order is noticed even while the
// kasir is on Laporan/Produk/etc, not just while looking at the Pesanan tab.
const NEW_ORDER_POLL_MS = 8000
let newOrderTimer = null
onMounted(() => {
  newOrderTimer = setInterval(async () => {
    let fresh
    try {
      fresh = await orders.checkForNewOrders()
    } catch {
      return
    }
    for (const order of fresh) {
      playNotifySound()
      // Longer than sonner's ~4s default — this is the one toast on the
      // whole dashboard a kasir genuinely must not miss mid-rush, so it
      // gets a wider window and a manual close button rather than relying
      // on being glanced at within a few seconds.
      toast.success(`Pesanan baru: ${order.kodeOrder}`, {
        description: `Meja ${order.nomorMeja} · ${formatRupiah(order.totalHarga)}`,
        duration: 10000,
      })
    }

    let freshCalls
    try {
      freshCalls = await staffCalls.checkForNewCalls()
    } catch {
      return
    }
    for (const call of freshCalls) {
      playNotifySound()
      toast.warning(`Meja ${call.nomorMeja} memanggil staff`, {
        description: call.catatan || undefined,
        duration: 10000,
      })
    }
  }, NEW_ORDER_POLL_MS)
})
onUnmounted(() => clearInterval(newOrderTimer))
</script>

<template>
  <div class="flex min-h-svh">
    <aside class="flex w-56 shrink-0 flex-col border-r bg-card">
      <div class="flex items-center gap-2.5 px-4 py-4">
        <img :src="logoUrl" alt="Popside" class="size-9 shrink-0 rounded-lg" />
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold tracking-tight">Popside</p>
          <p class="truncate text-xs text-muted-foreground">Admin Dashboard</p>
        </div>
      </div>
      <nav class="flex-1 space-y-1 px-2">
        <router-link
          v-for="item in nav"
          :key="item.label"
          :to="item.to"
          class="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          active-class="bg-accent text-accent-foreground font-medium"
        >
          <component :is="item.icon" class="size-4" />
          {{ item.label }}
          <span
            v-if="item.label === 'Pesanan' && orders.needsActionCount > 0"
            class="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-semibold text-white"
          >
            {{ orders.needsActionCount > 99 ? '99+' : orders.needsActionCount }}
          </span>
        </router-link>
      </nav>
      <div class="border-t px-3 py-3">
        <p class="truncate px-1 text-xs text-muted-foreground">
          Masuk sebagai <span class="font-medium text-foreground">{{ auth.user?.username }}</span>
          <span class="text-muted-foreground/70">({{ auth.user?.role }})</span>
        </p>
        <Button variant="ghost" size="sm" class="mt-1 w-full justify-start gap-2" @click="onLogout">
          <LogOutIcon class="size-4" />
          Keluar
        </Button>
      </div>
    </aside>

    <main class="min-w-0 flex-1 overflow-y-auto p-6">
      <router-view />
    </main>
  </div>
</template>
