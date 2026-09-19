<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useOrdersStore } from '@/stores/orders'
import { useStaffCallsStore } from '@/stores/staffCalls'
import { useNotificationsStore } from '@/stores/notifications'
import { useThemeStore } from '@/stores/theme'
import { Button } from '@/components/ui/button'
import logoUrl from '@/assets/pop-side-logo.jpg'
import { playNotifySound } from '@/lib/notifySound'
import { formatRupiah } from '@/lib/format'
import {
  ClipboardListIcon,
  TimerIcon,
  CalendarClockIcon,
  LayoutGridIcon,
  UtensilsIcon,
  QrCodeIcon,
  BarChart3Icon,
  HistoryIcon,
  UsersIcon,
  SettingsIcon,
  LogOutIcon,
  MenuIcon,
  XIcon,
  SunIcon,
  MoonIcon,
} from '@lucide/vue'
import { toast } from 'vue-sonner'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const orders = useOrdersStore()
const staffCalls = useStaffCallsStore()
const notifications = useNotificationsStore()
const theme = useThemeStore()

const nav = computed(() => {
  const items = [
    {
      to: { name: 'pesanan' },
      label: 'Pesanan',
      icon: ClipboardListIcon,
      badge: orders.needsActionCount,
    },
    { to: { name: 'shift' }, label: 'Shift', icon: TimerIcon },
    { to: { name: 'reservasi' }, label: 'Reservasi', icon: CalendarClockIcon },
  ]
  if (auth.isAdmin) {
    items.push(
      { to: { name: 'kategori' }, label: 'Kategori', icon: LayoutGridIcon },
      { to: { name: 'produk' }, label: 'Produk', icon: UtensilsIcon },
      { to: { name: 'meja' }, label: 'Meja', icon: QrCodeIcon },
      {
        to: { name: 'laporan' },
        label: 'Laporan',
        icon: BarChart3Icon,
        badge: notifications.laporanCount,
      },
      {
        to: { name: 'riwayat' },
        label: 'Riwayat Aktivitas',
        icon: HistoryIcon,
        badge: notifications.riwayatCount,
      },
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

// Off-canvas below lg (tablet/phone) — static/always-visible at lg+
// (laptop/TV). Closes itself on navigation so tapping a nav link doesn't
// leave the drawer covering the page it just opened.
const mobileNavOpen = ref(false)
watch(
  () => route.path,
  () => {
    mobileNavOpen.value = false
  }
)

// Runs here (not in OrdersView) so a new order is noticed even while the
// kasir is on Laporan/Produk/etc, not just while looking at the Pesanan tab.
// Best-effort, silent on failure — a missed badge-count refresh isn't worth
// surfacing to the kasir/admin (unlike a missed new-order toast below).
async function refreshNotificationBadges() {
  if (!auth.isAdmin) return
  try {
    await Promise.all([
      notifications.checkLaporan(),
      notifications.checkRiwayat(),
    ])
  } catch {
    // Next poll tick tries again.
  }
}

const NEW_ORDER_POLL_MS = 8000
let newOrderTimer = null
onMounted(() => {
  refreshNotificationBadges()
  newOrderTimer = setInterval(async () => {
    refreshNotificationBadges()

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
  <div class="flex min-h-svh flex-col lg:flex-row">
    <!-- Mobile/tablet top bar (lg:hidden) — the sidebar below is off-canvas
    at these widths, this is the only way to reach it. Sticky rather than
    fixed so it just pushes <main> down in normal flow, no padding math. -->
    <header
      class="sticky top-0 z-30 flex items-center gap-3 border-b bg-card px-4 py-3 lg:hidden"
    >
      <Button
        variant="ghost"
        size="icon"
        class="shrink-0"
        aria-label="Buka menu"
        @click="mobileNavOpen = true"
      >
        <MenuIcon class="size-5" />
      </Button>
      <img :src="logoUrl" alt="Popside" class="size-8 shrink-0 rounded-lg" />
      <p class="truncate text-sm font-semibold tracking-tight">Popside Admin</p>
      <Button
        variant="ghost"
        size="icon"
        class="ml-auto shrink-0"
        :aria-label="
          theme.isDark ? 'Ganti ke mode terang' : 'Ganti ke mode gelap'
        "
        @click="theme.toggle()"
      >
        <SunIcon v-if="theme.isDark" class="size-4" />
        <MoonIcon v-else class="size-4" />
      </Button>
    </header>

    <div
      v-if="mobileNavOpen"
      class="fixed inset-0 z-40 bg-black/40 lg:hidden"
      aria-hidden="true"
      @click="mobileNavOpen = false"
    />

    <aside
      class="fixed inset-y-0 left-0 z-50 flex w-64 -translate-x-full flex-col border-r bg-card transition-transform duration-200 lg:static lg:z-auto lg:w-56 lg:translate-x-0"
      :class="{ 'translate-x-0': mobileNavOpen }"
    >
      <div class="flex items-center gap-2.5 px-4 py-4">
        <img :src="logoUrl" alt="Popside" class="size-9 shrink-0 rounded-lg" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-semibold tracking-tight">Popside</p>
          <p class="truncate text-xs text-muted-foreground">Admin Dashboard</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          class="shrink-0 lg:hidden"
          aria-label="Tutup menu"
          @click="mobileNavOpen = false"
        >
          <XIcon class="size-4" />
        </Button>
      </div>
      <nav class="flex-1 space-y-1 overflow-y-auto px-2">
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
            v-if="item.badge > 0"
            class="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-semibold text-white"
          >
            {{ item.badge > 99 ? '99+' : item.badge }}
          </span>
        </router-link>
      </nav>
      <div class="border-t px-3 py-3">
        <div class="flex items-center justify-between gap-2 px-1">
          <p class="min-w-0 truncate text-xs text-muted-foreground">
            Masuk sebagai
            <span class="font-medium text-foreground">{{
              auth.user?.username
            }}</span>
            <span class="text-muted-foreground/70"
              >({{ auth.user?.role }})</span
            >
          </p>
          <button
            type="button"
            :aria-label="
              theme.isDark ? 'Ganti ke mode terang' : 'Ganti ke mode gelap'
            "
            class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            @click="theme.toggle()"
          >
            <SunIcon v-if="theme.isDark" class="size-4" />
            <MoonIcon v-else class="size-4" />
          </button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          class="mt-1 w-full justify-start gap-2"
          @click="onLogout"
        >
          <LogOutIcon class="size-4" />
          Keluar
        </Button>
      </div>
    </aside>

    <main class="min-w-0 flex-1 overflow-y-auto p-4 lg:p-6">
      <router-view />
    </main>
  </div>
</template>
