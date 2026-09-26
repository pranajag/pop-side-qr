<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { clearAllDrafts } from '@/lib/drafts'
import { useOrdersStore } from '@/stores/orders'
import { useStaffCallsStore } from '@/stores/staffCalls'
import { useNotificationsStore } from '@/stores/notifications'
import { useThemeStore } from '@/stores/theme'
import { useNetworkStore } from '@/stores/network'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import logoUrl from '@/assets/pop-side-logo.jpg'
import { playNotifySound } from '@/lib/notifySound'
import { formatRupiah } from '@/lib/format'
import { sambungRealtime, putuskanRealtime, dengarkan, realtimeTersambung } from '@/lib/realtime'
import {
  ClipboardListIcon,
  TimerIcon,
  CalendarClockIcon,
  LayoutGridIcon,
  UtensilsIcon,
  QrCodeIcon,
  BarChart3Icon,
  HistoryIcon,
  ScrollTextIcon,
  UsersIcon,
  SettingsIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  XIcon,
  SunIcon,
  MoonIcon,
  WifiOffIcon,
  StarIcon,
  ChevronRightIcon,
} from '@lucide/vue'
import { toast } from 'vue-sonner'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const orders = useOrdersStore()
const staffCalls = useStaffCallsStore()
const notifications = useNotificationsStore()
const theme = useThemeStore()
const network = useNetworkStore()

// Two groups rather than one long list: day-to-day shift work on top,
// admin-only configuration below, so a kasir's four items don't read as a
// truncated version of the admin's twelve.
const navGroups = computed(() => {
  const operasional = [
    {
      to: { name: 'pesanan' },
      label: 'Pesanan',
      icon: ClipboardListIcon,
      badge: orders.needsActionCount,
    },
    { to: { name: 'shift' }, label: 'Shift', icon: TimerIcon },
    { to: { name: 'reservasi' }, label: 'Reservasi', icon: CalendarClockIcon },
    { to: { name: 'member' }, label: 'Member', icon: StarIcon },
  ]
  if (!auth.isAdmin) return [{ label: 'Operasional', items: operasional }]

  // Unshift, not push — admin's landing page (router's beforeEach sends
  // '/' here for the admin role), so it belongs first in the list.
  operasional.unshift({
    to: { name: 'dashboard' },
    label: 'Dashboard',
    icon: LayoutDashboardIcon,
  })
  return [
    { label: 'Operasional', items: operasional },
    {
      label: 'Kelola',
      items: [
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
        { to: { name: 'log-audit' }, label: 'Log Audit', icon: ScrollTextIcon },
        { to: { name: 'akun' }, label: 'Akun Staff', icon: UsersIcon },
        { to: { name: 'pengaturan' }, label: 'Pengaturan', icon: SettingsIcon },
      ],
    },
  ]
})

// Breadcrumb label for routes the sidebar can't supply one for (sub-pages
// like Pesanan Manual have no nav entry of their own).
const EXTRA_TITLES = { 'pesanan-manual': 'Pesanan Manual' }
const pageTitle = computed(() => {
  for (const group of navGroups.value) {
    const hit = group.items.find((item) => item.to.name === route.name)
    if (hit) return hit.label
  }
  return EXTRA_TITLES[route.name] ?? 'Popside Admin'
})

const todayLabel = computed(() =>
  new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  }).format(new Date())
)

const userInitial = computed(() =>
  (auth.user?.username ?? '?').charAt(0).toUpperCase()
)

const logoutOpen = ref(false)
async function onLogoutConfirm() {
  await auth.logout()
  clearAllDrafts()
  router.replace({ name: 'login' })
  toast('Berhasil keluar')
}

// Off-canvas below lg (tablet/phone), fixed and always visible at lg+ so a
// long page never scrolls the menu out of reach. Closes itself on
// navigation so tapping a nav link doesn't leave the drawer covering the
// page it just opened.
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
// Selama notifikasi realtime tersambung (lib/realtime.js), polling hanya
// cadangan — pesanan baru sudah datang lewat event dalam hitungan
// milidetik, jadi jaraknya dilonggarkan.
const POLL_CADANGAN_MS = 30000
let newOrderTimer = null
let sedangMemeriksa = false

async function periksaNotifikasi() {
  // Event realtime dan polling bisa datang bersamaan — satu pemeriksaan
  // saja pada satu waktu, supaya pesanan yang sama tidak ditoast dua kali.
  if (sedangMemeriksa) return
  sedangMemeriksa = true
  try {
    await periksaSekali()
  } finally {
    sedangMemeriksa = false
  }
}

async function periksaSekali() {
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
      description: `${order.nomorMeja ? `Meja ${order.nomorMeja}` : `Bawa Pulang${order.customerName ? ` · ${order.customerName}` : ''}`} · ${formatRupiah(order.totalHarga)}`,
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
}

function jadwalkanPolling() {
  clearInterval(newOrderTimer)
  newOrderTimer = setInterval(periksaNotifikasi, realtimeTersambung.value ? POLL_CADANGAN_MS : NEW_ORDER_POLL_MS)
}

let berhentiDengar = []
onMounted(() => {
  network.init()
  refreshNotificationBadges()
  sambungRealtime()
  berhentiDengar = [
    dengarkan('order:baru', periksaNotifikasi),
    dengarkan('panggilan:baru', periksaNotifikasi),
    dengarkan('order:berubah', refreshNotificationBadges),
  ]
  jadwalkanPolling()
})
watch(realtimeTersambung, (tersambung) => {
  jadwalkanPolling()
  // Tersambung (lagi) setelah putus: kejar yang terlewat selama putus.
  if (tersambung) periksaNotifikasi()
})
onUnmounted(() => {
  clearInterval(newOrderTimer)
  for (const berhenti of berhentiDengar) berhenti()
  putuskanRealtime()
})
</script>

<template>
  <div
    v-if="!network.isOnline"
    class="fixed inset-x-0 top-0 z-60 flex items-center justify-center gap-2 bg-destructive px-4 py-1.5 text-xs font-medium text-destructive-foreground"
  >
    <WifiOffIcon class="size-3.5" />
    Tidak ada koneksi internet — perubahan (konfirmasi, ubah status, dll) tidak akan tersimpan sampai online lagi.
  </div>

  <div class="min-h-svh bg-background">
    <!-- Mobile/tablet top bar (lg:hidden) — the sidebar is off-canvas at
    these widths, this is the only way to reach it. -->
    <header
      class="sticky top-0 z-30 flex items-center gap-3 border-b border-border/70 bg-background/85 px-4 py-3 backdrop-blur lg:hidden"
    >
      <button
        type="button"
        class="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        aria-label="Buka menu"
        @click="mobileNavOpen = true"
      >
        <MenuIcon class="size-5" />
      </button>
      <img :src="logoUrl" alt="Popside" class="size-8 shrink-0 rounded-lg" />
      <p class="truncate text-sm font-semibold tracking-tight">Popside Admin</p>
      <button
        type="button"
        class="ml-auto flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
        :aria-label="
          theme.isDark ? 'Ganti ke mode terang' : 'Ganti ke mode gelap'
        "
        @click="theme.toggle()"
      >
        <SunIcon v-if="theme.isDark" class="size-4" />
        <MoonIcon v-else class="size-4" />
      </button>
    </header>

    <div
      v-if="mobileNavOpen"
      class="fixed inset-0 z-40 bg-foreground/40 backdrop-blur-sm lg:hidden"
      aria-hidden="true"
      @click="mobileNavOpen = false"
    />

    <!-- Fixed at every width so the menu never scrolls away; it shares the
    page background (no panel of its own) which is what makes the white
    content card to its right read as a separate surface. -->
    <aside
      class="fixed inset-y-0 left-0 z-50 flex w-68 -translate-x-full flex-col bg-sidebar transition-transform duration-200 lg:translate-x-0"
      :class="{ 'translate-x-0': mobileNavOpen }"
    >
      <div class="flex items-center gap-3 px-5 py-4">
        <img :src="logoUrl" alt="Popside" class="size-10 shrink-0 rounded-xl" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-bold tracking-tight">Popside</p>
          <p class="truncate text-[11px] text-muted-foreground">
            Admin Dashboard
          </p>
        </div>
        <button
          type="button"
          class="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground lg:hidden"
          aria-label="Tutup menu"
          @click="mobileNavOpen = false"
        >
          <XIcon class="size-4" />
        </button>
      </div>

      <nav class="no-scrollbar flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        <div v-for="group in navGroups" :key="group.label">
          <p
            class="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
          >
            {{ group.label }}
          </p>
          <div class="space-y-0.5">
            <router-link
              v-for="item in group.items"
              :key="item.label"
              :to="item.to"
              class="flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              active-class="bg-sidebar-primary! text-sidebar-primary-foreground! font-semibold"
            >
              <component :is="item.icon" class="size-4 shrink-0" />
              <span class="truncate">{{ item.label }}</span>
              <span
                v-if="item.badge > 0"
                class="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-semibold text-destructive-foreground"
              >
                {{ item.badge > 99 ? '99+' : item.badge }}
              </span>
            </router-link>
          </div>
        </div>
      </nav>

      <div class="border-t border-sidebar-border px-3 pb-4 pt-3">
        <p
          class="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
        >
          Akun
        </p>
        <div
          class="flex items-center gap-3 rounded-2xl border border-sidebar-border bg-card px-3 py-2.5"
        >
          <span
            class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground"
          >
            {{ userInitial }}
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold">
              {{ auth.user?.username }}
            </p>
            <p class="truncate text-[11px] capitalize text-muted-foreground">
              {{ auth.user?.role }}
            </p>
          </div>
          <button
            type="button"
            :aria-label="
              theme.isDark ? 'Ganti ke mode terang' : 'Ganti ke mode gelap'
            "
            class="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            @click="theme.toggle()"
          >
            <SunIcon v-if="theme.isDark" class="size-4" />
            <MoonIcon v-else class="size-4" />
          </button>
        </div>
        <button
          type="button"
          class="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          @click="logoutOpen = true"
        >
          <LogOutIcon class="size-4 shrink-0" />
          Keluar
        </button>
      </div>
    </aside>

    <div class="lg:pl-68">
      <div class="mx-auto w-full max-w-6xl px-4 pb-10 pt-5 lg:px-8 lg:pt-7">
        <header class="mb-4 hidden items-center justify-between gap-4 lg:flex">
          <p class="flex items-center gap-1.5 text-sm text-muted-foreground">
            Popside Admin
            <ChevronRightIcon class="size-3.5 text-primary-strong" />
            <span class="font-medium text-foreground">{{ pageTitle }}</span>
          </p>
          <div class="flex items-center gap-2">
            <span
              class="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground"
            >
              {{ todayLabel }}
            </span>
            <span
              class="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium capitalize"
            >
              Masuk sebagai {{ auth.user?.role }}
            </span>
            <button
              type="button"
              :aria-label="
                theme.isDark ? 'Ganti ke mode terang' : 'Ganti ke mode gelap'
              "
              class="flex size-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
              @click="theme.toggle()"
            >
              <SunIcon v-if="theme.isDark" class="size-4" />
              <MoonIcon v-else class="size-4" />
            </button>
          </div>
        </header>

        <main
          class="min-w-0 rounded-3xl border border-border/70 bg-card p-4 shadow-sm sm:p-6 lg:p-8"
        >
          <router-view />
        </main>
      </div>
    </div>
  </div>

  <AlertDialog v-model:open="logoutOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Keluar dari dashboard?</AlertDialogTitle>
        <AlertDialogDescription>
          Sesi {{ auth.user?.username }} akan diakhiri dan draft form yang
          belum disimpan akan dihapus dari perangkat ini.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Batal</AlertDialogCancel>
        <AlertDialogAction @click="onLogoutConfirm">Keluar</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
