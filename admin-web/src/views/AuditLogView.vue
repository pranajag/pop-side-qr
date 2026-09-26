<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { toast } from 'vue-sonner'
import { api, formatApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ChevronLeftIcon, ChevronRightIcon, LoaderCircleIcon, RefreshCwIcon } from '@lucide/vue'

// Log audit: setiap aksi staff yang mengubah data, dicatat server
// (api middleware/auditLog.js) ke tabel yang tidak bisa diubah atau
// dihapus. Halaman ini hanya membaca.
const filter = reactive({ dari: '', sampai: '', hasil: '' })
const data = ref({ items: [], total: 0, halaman: 1, perHalaman: 50 })
const loading = ref(false)

const jumlahHalaman = computed(() => Math.max(1, Math.ceil(data.value.total / data.value.perHalaman)))

async function load(halaman = 1) {
  loading.value = true
  try {
    const q = new URLSearchParams({ halaman: String(halaman) })
    if (filter.dari) q.set('dari', filter.dari)
    if (filter.sampai) q.set('sampai', filter.sampai)
    if (filter.hasil) q.set('hasil', filter.hasil)
    data.value = await api.get(`/admin/audit-log?${q.toString()}`)
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    loading.value = false
  }
}

// Ringkasan isi aksi yang terbaca sekilas; isi lengkapnya di bawah "detail".
function ringkas(detail) {
  if (!detail || typeof detail !== 'object') return ''
  const bagian = []
  if (detail.params?.id) bagian.push(`#${detail.params.id}`)
  if (detail.body && typeof detail.body === 'object') {
    for (const [k, v] of Object.entries(detail.body).slice(0, 4)) {
      const teks = typeof v === 'object' ? JSON.stringify(v) : String(v)
      bagian.push(`${k}: ${teks.length > 40 ? `${teks.slice(0, 40)}…` : teks}`)
    }
  }
  if (detail.query) bagian.push(Object.entries(detail.query).map(([k, v]) => `${k}=${v}`).join(' '))
  if (detail.file) bagian.push(`file ${detail.file.jenis}`)
  return bagian.join(' · ')
}

onMounted(() => load(1))
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold tracking-tight">Log Audit</h1>
        <p class="text-sm text-muted-foreground">
          Setiap perubahan data oleh staff — siapa, kapan, apa, dan hasilnya.
          Tercatat otomatis dan tidak bisa diubah atau dihapus siapa pun.
        </p>
      </div>
      <Button variant="outline" size="sm" class="gap-1.5" :disabled="loading" @click="load(data.halaman)">
        <RefreshCwIcon class="size-3.5" :class="{ 'animate-spin': loading }" />
        Muat ulang
      </Button>
    </div>

    <form class="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3" @submit.prevent="load(1)">
      <div class="space-y-1">
        <Label for="audit-dari" class="text-xs">Dari</Label>
        <Input id="audit-dari" v-model="filter.dari" type="date" class="h-8 w-40" />
      </div>
      <div class="space-y-1">
        <Label for="audit-sampai" class="text-xs">Sampai</Label>
        <Input id="audit-sampai" v-model="filter.sampai" type="date" class="h-8 w-40" />
      </div>
      <div class="space-y-1">
        <Label for="audit-hasil" class="text-xs">Hasil</Label>
        <select
          id="audit-hasil"
          v-model="filter.hasil"
          class="h-8 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">Semua</option>
          <option value="berhasil">Berhasil</option>
          <option value="ditolak">Ditolak / gagal</option>
        </select>
      </div>
      <Button type="submit" size="sm" :disabled="loading">Terapkan</Button>
    </form>

    <div class="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-40">Waktu</TableHead>
            <TableHead class="w-36">Staff</TableHead>
            <TableHead>Aksi</TableHead>
            <TableHead class="w-24">Hasil</TableHead>
            <TableHead class="w-28">IP</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableEmpty v-if="!loading && data.items.length === 0" :colspan="5">
            Belum ada aktivitas tercatat untuk filter ini.
          </TableEmpty>
          <TableRow v-for="log in data.items" :key="log.id">
            <TableCell class="whitespace-nowrap text-xs tabular-nums" data-label="Waktu">
              {{ formatDateTime(log.waktu) }}
            </TableCell>
            <TableCell data-label="Staff">
              <span class="font-medium">{{ log.username ?? '—' }}</span>
              <span class="block text-xs text-muted-foreground">{{ log.role === 'admin' ? 'Admin' : log.role === 'kasir' ? 'Kasir' : '' }}</span>
            </TableCell>
            <TableCell class="whitespace-normal" data-label="Aksi">
              <span class="font-medium">{{ log.label }}</span>
              <span v-if="ringkas(log.detail)" class="block text-xs text-muted-foreground">{{ ringkas(log.detail) }}</span>
              <details v-if="log.detail" class="mt-1 text-xs">
                <summary class="cursor-pointer text-muted-foreground hover:text-foreground">detail</summary>
                <pre class="mt-1 max-w-xl overflow-x-auto whitespace-pre-wrap rounded bg-muted/50 p-2 font-mono">{{ typeof log.detail === 'string' ? log.detail : JSON.stringify(log.detail, null, 2) }}</pre>
                <span class="text-muted-foreground">{{ log.aksi }}</span>
              </details>
            </TableCell>
            <TableCell data-label="Hasil">
              <Badge :variant="log.berhasil ? 'outline' : 'destructive'">
                {{ log.berhasil ? 'Berhasil' : `Ditolak (${log.status})` }}
              </Badge>
            </TableCell>
            <TableCell class="text-xs tabular-nums text-muted-foreground" data-label="IP">{{ log.ip ?? '—' }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <div v-if="loading && data.items.length === 0" class="flex justify-center p-6">
        <LoaderCircleIcon class="size-5 animate-spin text-muted-foreground" />
      </div>
    </div>

    <div class="flex items-center justify-between text-sm text-muted-foreground">
      <span>{{ data.total }} catatan</span>
      <div class="flex items-center gap-2">
        <Button variant="outline" size="icon" class="size-8" :disabled="loading || data.halaman <= 1" aria-label="Halaman sebelumnya" @click="load(data.halaman - 1)">
          <ChevronLeftIcon class="size-4" />
        </Button>
        <span class="tabular-nums">{{ data.halaman }} / {{ jumlahHalaman }}</span>
        <Button variant="outline" size="icon" class="size-8" :disabled="loading || data.halaman >= jumlahHalaman" aria-label="Halaman berikutnya" @click="load(data.halaman + 1)">
          <ChevronRightIcon class="size-4" />
        </Button>
      </div>
    </div>
  </div>
</template>
