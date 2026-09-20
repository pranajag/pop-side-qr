<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { api, formatApiError } from '@/lib/api'
import { formatRupiah, formatDateTime } from '@/lib/format'
import { Button } from '@/components/ui/button'
import {
  LoaderCircleIcon,
  TrendingUpIcon,
  TrendingDownIcon,
  AlertCircleIcon,
  TimerIcon,
  TrophyIcon,
  WalletIcon,
  ClipboardListIcon,
} from '@lucide/vue'

const router = useRouter()
const loading = ref(true)
const overview = ref(null)

// null (not 0/Infinity) when yesterday had zero orders/revenue — "up
// infinity percent from zero" is meaningless, so the comparison line is
// hidden entirely for that case rather than showing a made-up number.
function pctChange(today, yesterday) {
  if (!yesterday) return null
  return ((today - yesterday) / yesterday) * 100
}

const revenueChange = computed(() =>
  overview.value ? pctChange(overview.value.today.total, overview.value.yesterday.total) : null
)
const orderCountChange = computed(() =>
  overview.value
    ? pctChange(overview.value.today.orderCount, overview.value.yesterday.orderCount)
    : null
)

async function load() {
  loading.value = true
  try {
    const data = await api.get('/admin/dashboard')
    overview.value = data.overview
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    loading.value = false
  }
}

function goToPendingVerif() {
  router.push({ name: 'pesanan', query: { status: 'waiting_verif' } })
}

onMounted(load)
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-lg font-semibold tracking-tight">Dashboard</h1>
      <p class="text-sm text-muted-foreground">Ringkasan hari ini.</p>
    </div>

    <div v-if="loading" class="flex justify-center py-12">
      <LoaderCircleIcon class="size-6 animate-spin text-muted-foreground" />
    </div>

    <template v-else-if="overview">
      <div
        v-if="overview.pendingVerifCount > 0"
        class="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4"
      >
        <div class="flex items-center gap-2.5">
          <AlertCircleIcon class="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p class="text-sm font-medium text-amber-700 dark:text-amber-400">
            {{ overview.pendingVerifCount }} pembayaran QRIS menunggu diverifikasi
          </p>
        </div>
        <Button size="sm" variant="outline" @click="goToPendingVerif">Cek Sekarang</Button>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div class="space-y-1 rounded-lg border bg-card p-5">
          <p class="text-xs text-muted-foreground">Omzet Hari Ini</p>
          <p class="text-2xl font-bold">{{ formatRupiah(overview.today.total) }}</p>
          <p
            v-if="revenueChange !== null"
            class="flex items-center gap-1 text-xs"
            :class="revenueChange >= 0 ? 'text-status-completed' : 'text-destructive'"
          >
            <TrendingUpIcon v-if="revenueChange >= 0" class="size-3.5" />
            <TrendingDownIcon v-else class="size-3.5" />
            {{ Math.abs(revenueChange).toFixed(0) }}% dari kemarin
          </p>
          <p v-else class="text-xs text-muted-foreground">Kemarin tidak ada omzet</p>
        </div>

        <div class="space-y-1 rounded-lg border bg-card p-5">
          <p class="text-xs text-muted-foreground">Jumlah Order Hari Ini</p>
          <p class="text-2xl font-bold">{{ overview.today.orderCount }}</p>
          <p
            v-if="orderCountChange !== null"
            class="flex items-center gap-1 text-xs"
            :class="orderCountChange >= 0 ? 'text-status-completed' : 'text-destructive'"
          >
            <TrendingUpIcon v-if="orderCountChange >= 0" class="size-3.5" />
            <TrendingDownIcon v-else class="size-3.5" />
            {{ Math.abs(orderCountChange).toFixed(0) }}% dari kemarin
          </p>
          <p v-else class="text-xs text-muted-foreground">Kemarin tidak ada order</p>
        </div>
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <div class="space-y-3 rounded-lg border bg-card p-5">
          <h2 class="flex items-center gap-2 text-sm font-semibold">
            <WalletIcon class="size-4" />
            Metode Pembayaran Hari Ini
          </h2>
          <div v-if="overview.today.orderCount === 0" class="text-sm text-muted-foreground">
            Belum ada order hari ini.
          </div>
          <div v-else class="space-y-2">
            <div
              v-for="(amount, metode) in overview.today.byMetode"
              :key="metode"
              class="flex items-center justify-between text-sm"
            >
              <span class="uppercase text-muted-foreground">{{ metode }}</span>
              <span class="font-medium">{{ formatRupiah(amount) }}</span>
            </div>
          </div>
        </div>

        <div class="space-y-3 rounded-lg border bg-card p-5">
          <h2 class="flex items-center gap-2 text-sm font-semibold">
            <TrophyIcon class="size-4" />
            Produk Terlaris Hari Ini
          </h2>
          <div v-if="overview.today.topProducts.length === 0" class="text-sm text-muted-foreground">
            Belum ada produk terjual hari ini.
          </div>
          <ol v-else class="space-y-2">
            <li
              v-for="(p, idx) in overview.today.topProducts"
              :key="p.nama"
              class="flex items-center justify-between text-sm"
            >
              <span class="flex items-center gap-2">
                <span class="text-xs text-muted-foreground">{{ idx + 1 }}.</span>
                {{ p.nama }}
              </span>
              <span class="text-muted-foreground">{{ p.qty }}x</span>
            </li>
          </ol>
        </div>
      </div>

      <div class="space-y-3 rounded-lg border bg-card p-5">
        <h2 class="flex items-center gap-2 text-sm font-semibold">
          <TimerIcon class="size-4" />
          Shift Aktif
        </h2>
        <div v-if="overview.activeShifts.length === 0" class="text-sm text-muted-foreground">
          Tidak ada shift yang sedang berjalan.
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="shift in overview.activeShifts"
            :key="shift.id"
            class="flex items-center justify-between rounded-md border p-2.5 text-sm"
          >
            <div>
              <p class="font-medium">{{ shift.username }}</p>
              <p class="text-xs text-muted-foreground">
                Mulai {{ formatDateTime(shift.startedAt) }}
              </p>
            </div>
            <div class="text-right">
              <p class="text-xs text-muted-foreground">Kas seharusnya</p>
              <p class="font-medium">{{ formatRupiah(shift.expectedCash) }}</p>
            </div>
          </div>
        </div>
      </div>

      <router-link
        :to="{ name: 'laporan' }"
        class="flex items-center gap-1.5 text-sm text-primary hover:underline"
      >
        <ClipboardListIcon class="size-3.5" />
        Lihat laporan lengkap &amp; rentang tanggal lain
      </router-link>
    </template>
  </div>
</template>
