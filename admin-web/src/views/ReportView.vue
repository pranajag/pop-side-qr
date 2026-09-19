<script setup>
import { onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { api, formatApiError } from '@/lib/api'
import { formatRupiah } from '@/lib/format'
import { useNotificationsStore } from '@/stores/notifications'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { LoaderCircleIcon, WalletIcon, DownloadIcon } from '@lucide/vue'

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
const loading = ref(false)

const METODE_LABEL = { qris: 'QRIS', tunai: 'Tunai', debit: 'Debit' }

async function load() {
  loading.value = true
  try {
    report.value = (
      await api.get(`/admin/reports?from=${from.value}&to=${to.value}`)
    ).report
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

// Wrap in quotes only when needed (a bare comma/quote/newline would
// otherwise split into the wrong number of columns when opened in Excel).
function csvField(value) {
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function csvRow(fields) {
  return fields.map(csvField).join(',')
}

function exportCsv() {
  if (!report.value) return
  const r = report.value
  const lines = [
    csvRow(['Laporan Pendapatan', r.from, r.to]),
    csvRow(['Total Pendapatan', r.total]),
    csvRow(['Jumlah Pesanan', r.orderCount]),
    '',
    csvRow(['Metode Bayar', 'Jumlah']),
    ...Object.entries(r.byMetode).map(([metode, amount]) =>
      csvRow([METODE_LABEL[metode], amount])
    ),
    '',
    csvRow(['Produk Terlaris', 'Qty', 'Pendapatan']),
    ...r.topProducts.map((p) => csvRow([p.nama, p.qty, p.revenue])),
  ]
  // Leading BOM so Excel (which guesses ANSI otherwise) reads the UTF-8
  // rupiah/product-name text correctly instead of mangling it.
  const blob = new Blob(['﻿' + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `laporan-popside_${r.from}_${r.to}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(load)
// Opening this page IS "seeing" whatever's new — otherwise the sidebar
// badge (notifications.js's laporanCount) only ever grows, never resets,
// no matter how many times admin actually checks this page.
onMounted(() => useNotificationsStore().markLaporanSeen())
</script>

<template>
  <div class="max-w-2xl space-y-6">
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
          <Button
            size="sm"
            variant="outline"
            class="gap-1.5"
            @click="exportCsv"
          >
            <DownloadIcon class="size-3.5" />
            Export CSV
          </Button>
        </div>
        <p class="mt-1 text-3xl font-bold tracking-tight">
          {{ formatRupiah(report.total) }}
        </p>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ report.orderCount }} pesanan
        </p>
      </div>

      <div class="rounded-lg border bg-card p-4">
        <h2 class="mb-3 text-sm font-semibold text-muted-foreground">
          Breakdown Metode Bayar
        </h2>
        <div class="space-y-2">
          <div
            v-for="(amount, metode) in report.byMetode"
            :key="metode"
            class="flex items-center justify-between border-b pb-2 text-sm last:border-0 last:pb-0"
          >
            <span>{{ METODE_LABEL[metode] }}</span>
            <span class="font-medium">{{ formatRupiah(amount) }}</span>
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
            </span>
          </li>
        </ol>
      </div>
    </div>
  </div>
</template>
