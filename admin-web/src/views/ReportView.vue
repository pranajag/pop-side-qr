<script setup>
import { computed, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Chart as ChartJS, registerables } from 'chart.js'
import { Line, Doughnut, Bar } from 'vue-chartjs'
import { api, formatApiError, API_URL } from '@/lib/api'
import { formatRupiah } from '@/lib/format'
import { useNotificationsStore } from '@/stores/notifications'
import { useThemeStore } from '@/stores/theme'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { LoaderCircleIcon, WalletIcon, DownloadIcon, TrendingUpIcon, BookTextIcon } from '@lucide/vue'

ChartJS.register(...registerables)
const theme = useThemeStore()

// Asia/Jakarta (WIB) is a fixed UTC+7 offset, no DST — computed directly
// rather than via the browser's local-timezone Date getters, which would
// silently shift a day during Jakarta 00:00-06:59 on any staff device not
// itself set to WIB. Mirrors api/src/utils/jakartaTime.js's approach.
function jakartaNow() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000)
}
function toISO(d) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function todayISO() {
  return toISO(jakartaNow())
}
function startOfWeekISO() {
  const d = jakartaNow()
  const dow = d.getUTCDay()
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1)) // Monday start
  return toISO(d)
}
function startOfMonthISO() {
  const d = jakartaNow()
  d.setUTCDate(1)
  return toISO(d)
}

const from = ref(todayISO())
const to = ref(todayISO())
const report = ref(null)
const dailyData = ref([])
const loading = ref(false)

const METODE_LABEL = { qris: 'QRIS', tunai: 'Tunai', debit: 'Debit' }

async function load() {
  loading.value = true
  try {
    const [reportRes, dailyRes] = await Promise.all([
      api.get(`/admin/reports?from=${from.value}&to=${to.value}`),
      api.get(`/admin/reports/daily?from=${from.value}&to=${to.value}`),
    ])
    report.value = reportRes.report
    dailyData.value = dailyRes.days
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    loading.value = false
  }
}

function applyPreset(preset) {
  to.value = todayISO()
  if (preset === 'today') from.value = todayISO()
  else if (preset === 'week') from.value = startOfWeekISO()
  else if (preset === 'month') from.value = startOfMonthISO()
  load()
}

// Plain GET behind the session cookie, same as ShiftView.vue's own
// reportUrl() — no CSRF token needed (GET is exempt server-side too) and a
// direct navigation lets the browser handle the download/Content-
// Disposition itself. Replaces the old client-side CSV builder entirely —
// exceljs on the server now produces an actually-formatted workbook
// (bold headers, column widths, rupiah number formatting) instead of the
// plain-text CSV this used to hand-assemble.
function exportUrl(kind) {
  const file = kind === 'jurnal' ? 'jurnal.xlsx' : 'export.xlsx'
  return `${API_URL}/admin/reports/${file}?from=${from.value}&to=${to.value}`
}

// Resolved from the live CSS custom properties (style.css) rather than
// hardcoded hex — charts then automatically match whatever the app's own
// theme is, light or dark, instead of drifting into their own separate
// palette. Recomputed on every theme.isDark flip (the actual dependency
// this computed tracks), since getComputedStyle needs to re-read after
// the .dark class toggles on <html>.
const chartColors = computed(() => {
  void theme.isDark
  const styles = getComputedStyle(document.documentElement)
  const read = (name) => styles.getPropertyValue(name).trim()
  return {
    primary: read('--primary'),
    completed: read('--status-completed'),
    muted: read('--muted-foreground'),
    grid: read('--border'),
    palette: [read('--primary'), read('--status-completed'), read('--status-ready') || read('--muted-foreground')],
  }
})

const revenueTrendChart = computed(() => ({
  labels: dailyData.value.map((d) => d.date.slice(5)),
  datasets: [
    {
      label: 'Omzet',
      data: dailyData.value.map((d) => d.total),
      borderColor: chartColors.value.primary,
      backgroundColor: chartColors.value.primary,
      tension: 0.25,
      pointRadius: dailyData.value.length > 31 ? 0 : 3,
    },
  ],
}))
const revenueTrendOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: { callbacks: { label: (ctx) => formatRupiah(ctx.parsed.y) } },
  },
  scales: {
    y: {
      ticks: { callback: (v) => formatRupiah(v), color: chartColors.value.muted },
      grid: { color: chartColors.value.grid },
    },
    x: { ticks: { color: chartColors.value.muted }, grid: { display: false } },
  },
}))

const metodeChart = computed(() => ({
  labels: Object.keys(report.value?.byMetode ?? {}).map((m) => METODE_LABEL[m]),
  datasets: [
    {
      data: Object.values(report.value?.byMetode ?? {}),
      backgroundColor: chartColors.value.palette,
      borderWidth: 0,
    },
  ],
}))
const metodeChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'bottom', labels: { color: chartColors.value.muted, boxWidth: 12 } },
    tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${formatRupiah(ctx.parsed)}` } },
  },
}))

const topProductsChart = computed(() => {
  const top = (report.value?.topProducts ?? []).slice(0, 8)
  return {
    labels: top.map((p) => p.nama),
    datasets: [
      {
        label: 'Pendapatan',
        data: top.map((p) => p.revenue),
        backgroundColor: chartColors.value.primary,
      },
    ],
  }
})
const topProductsChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  indexAxis: 'y',
  plugins: {
    legend: { display: false },
    tooltip: { callbacks: { label: (ctx) => formatRupiah(ctx.parsed.x) } },
  },
  scales: {
    x: {
      ticks: { callback: (v) => formatRupiah(v), color: chartColors.value.muted },
      grid: { color: chartColors.value.grid },
    },
    y: { ticks: { color: chartColors.value.muted }, grid: { display: false } },
  },
}))

onMounted(load)
// Opening this page IS "seeing" whatever's new — otherwise the sidebar
// badge (notifications.js's laporanCount) only ever grows, never resets,
// no matter how many times admin actually checks this page.
onMounted(() => useNotificationsStore().markLaporanSeen())
</script>

<template>
  <div class="max-w-4xl space-y-6">
    <div>
      <h1 class="text-lg font-semibold tracking-tight">Laporan Pendapatan</h1>
      <p class="text-sm text-muted-foreground">
        Dihitung sejak pesanan dikonfirmasi, timezone Asia/Jakarta.
      </p>
    </div>

    <div class="flex flex-wrap gap-2">
      <Button size="sm" variant="outline" @click="applyPreset('today')"
        >Hari Ini</Button
      >
      <Button size="sm" variant="outline" @click="applyPreset('week')"
        >Minggu Ini</Button
      >
      <Button size="sm" variant="outline" @click="applyPreset('month')"
        >Bulan Ini</Button
      >
    </div>

    <div class="flex flex-wrap items-end gap-3">
      <div class="space-y-2">
        <Label for="from">Dari</Label>
        <Input
          id="from"
          v-model="from"
          type="date"
          class="w-44"
          @change="load"
        />
      </div>
      <div class="space-y-2">
        <Label for="to">Sampai</Label>
        <Input id="to" v-model="to" type="date" class="w-44" @change="load" />
      </div>
      <LoaderCircleIcon
        v-if="loading"
        class="mb-2 size-4 animate-spin text-muted-foreground"
      />
    </div>

    <div v-if="report" class="space-y-4">
      <div class="rounded-lg border bg-card p-6">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 text-sm text-muted-foreground">
            <WalletIcon class="size-4" />
            Total Pendapatan
          </div>
          <div class="flex gap-2">
            <a :href="exportUrl('report')">
              <Button size="sm" variant="outline" class="gap-1.5">
                <DownloadIcon class="size-3.5" />
                Export Excel
              </Button>
            </a>
            <a :href="exportUrl('jurnal')">
              <Button size="sm" variant="outline" class="gap-1.5">
                <BookTextIcon class="size-3.5" />
                Export Jurnal
              </Button>
            </a>
          </div>
        </div>
        <p class="mt-1 text-3xl font-bold tracking-tight">
          {{ formatRupiah(report.total) }}
        </p>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ report.orderCount }} pesanan
        </p>
      </div>

      <div class="rounded-lg border bg-card p-6">
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <TrendingUpIcon class="size-4" />
          Margin Kotor
        </div>
        <p class="mt-1 text-3xl font-bold tracking-tight text-status-completed">
          {{ formatRupiah(report.totalMargin) }}
        </p>
        <p class="mt-1 text-sm text-muted-foreground">
          <template v-if="report.knownMarginRevenue < report.total">
            Dihitung dari {{ formatRupiah(report.knownMarginRevenue) }} pendapatan yang produknya sudah punya Harga
            Modal — isi HPP produk lain di Produk untuk cakupan penuh.
          </template>
          <template v-else-if="report.total > 0"> Mencakup seluruh pendapatan periode ini. </template>
          <template v-else> Belum ada penjualan. </template>
        </p>
      </div>

      <div class="rounded-lg border bg-card p-4">
        <h2 class="mb-3 text-sm font-semibold text-muted-foreground">
          Tren Omzet
        </h2>
        <p v-if="dailyData.length <= 1" class="text-sm text-muted-foreground">
          Pilih rentang lebih dari 1 hari untuk lihat tren.
        </p>
        <div v-else class="h-56">
          <Line :data="revenueTrendChart" :options="revenueTrendOptions" />
        </div>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div class="rounded-lg border bg-card p-4">
          <h2 class="mb-3 text-sm font-semibold text-muted-foreground">
            Breakdown Metode Bayar
          </h2>
          <div v-if="report.orderCount === 0" class="text-sm text-muted-foreground">
            Belum ada penjualan.
          </div>
          <template v-else>
            <div class="mx-auto h-44 max-w-52">
              <Doughnut :data="metodeChart" :options="metodeChartOptions" />
            </div>
            <div class="mt-4 space-y-2">
              <div
                v-for="(amount, metode) in report.byMetode"
                :key="metode"
                class="flex items-center justify-between border-b pb-2 text-sm last:border-0 last:pb-0"
              >
                <span>{{ METODE_LABEL[metode] }}</span>
                <span class="font-medium">{{ formatRupiah(amount) }}</span>
              </div>
            </div>
          </template>
        </div>

        <div class="rounded-lg border bg-card p-4">
          <h2 class="mb-3 text-sm font-semibold text-muted-foreground">
            Produk Terlaris — Pendapatan
          </h2>
          <div v-if="report.topProducts.length === 0" class="text-sm text-muted-foreground">
            Belum ada penjualan.
          </div>
          <div v-else class="h-56">
            <Bar :data="topProductsChart" :options="topProductsChartOptions" />
          </div>
        </div>
      </div>

      <div class="rounded-lg border bg-card p-4">
        <h2 class="mb-3 text-sm font-semibold text-muted-foreground">
          Produk Terlaris
        </h2>
        <p
          v-if="report.topProducts.length === 0"
          class="text-sm text-muted-foreground"
        >
          Belum ada penjualan.
        </p>
        <ol v-else class="space-y-2">
          <li
            v-for="(p, idx) in report.topProducts"
            :key="p.nama"
            class="flex items-center justify-between border-b pb-2 text-sm last:border-0 last:pb-0"
          >
            <span class="flex items-center gap-2">
              <span
                class="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
              >
                {{ idx + 1 }}
              </span>
              {{ p.nama }}
            </span>
            <span class="flex items-center gap-3 text-muted-foreground">
              <span>{{ p.qty }}x</span>
              <span class="font-medium text-foreground">{{
                formatRupiah(p.revenue)
              }}</span>
              <span
                class="w-20 shrink-0 text-right text-xs"
                :class="p.margin === null ? 'italic text-muted-foreground/70' : 'text-status-completed'"
              >
                {{ p.margin === null ? 'HPP kosong' : formatRupiah(p.margin) }}
              </span>
            </span>
          </li>
        </ol>
      </div>
    </div>
  </div>
</template>
