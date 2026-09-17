<script setup>
import { onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { api, formatApiError } from '@/lib/api'
import { formatRupiah } from '@/lib/format'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoaderCircleIcon, WalletIcon } from '@lucide/vue'

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const date = ref(todayISO())
const report = ref(null)
const loading = ref(false)

const METODE_LABEL = { qris: 'QRIS', tunai: 'Tunai', debit: 'Debit' }

async function load() {
  loading.value = true
  try {
    report.value = (await api.get(`/admin/reports/daily?date=${date.value}`)).report
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="max-w-2xl space-y-6">
    <div>
      <h1 class="text-lg font-semibold tracking-tight">Laporan Pendapatan</h1>
      <p class="text-sm text-muted-foreground">Dihitung sejak pesanan dikonfirmasi, timezone Asia/Jakarta.</p>
    </div>

    <div class="flex items-end gap-3">
      <div class="space-y-2">
        <Label for="date">Tanggal</Label>
        <Input id="date" v-model="date" type="date" class="w-44" @change="load" />
      </div>
      <LoaderCircleIcon v-if="loading" class="mb-2 size-4 animate-spin text-muted-foreground" />
    </div>

    <div v-if="report" class="space-y-4">
      <div class="rounded-lg border bg-card p-6">
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <WalletIcon class="size-4" />
          Total Pendapatan
        </div>
        <p class="mt-1 text-3xl font-bold tracking-tight">{{ formatRupiah(report.total) }}</p>
        <p class="mt-1 text-sm text-muted-foreground">{{ report.orderCount }} pesanan</p>
      </div>

      <div class="rounded-lg border bg-card p-4">
        <h2 class="mb-3 text-sm font-semibold text-muted-foreground">Breakdown Metode Bayar</h2>
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
    </div>
  </div>
</template>
