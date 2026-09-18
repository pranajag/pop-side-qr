<script setup>
import { onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { api, formatApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { STATUS_LABEL, STATUS_BADGE_CLASS } from '@/lib/orderStatus'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { LoaderCircleIcon, RefreshCwIcon } from '@lucide/vue'

const items = ref([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const { logs } = await api.get('/admin/orders/activity-log?limit=100')
    items.value = logs
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-lg font-semibold tracking-tight">Riwayat Aktivitas</h1>
        <p class="text-sm text-muted-foreground">
          Jejak audit tiap perubahan status pesanan — siapa mengubah apa dan kapan.
        </p>
      </div>
      <Button variant="outline" size="sm" class="gap-2" :disabled="loading" @click="load">
        <LoaderCircleIcon v-if="loading" class="size-4 animate-spin" />
        <RefreshCwIcon v-else class="size-4" />
        Muat Ulang
      </Button>
    </div>

    <div class="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-44">Waktu</TableHead>
            <TableHead>Order</TableHead>
            <TableHead>Perubahan Status</TableHead>
            <TableHead class="w-40">Oleh</TableHead>
            <TableHead>Catatan</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableEmpty v-if="!loading && items.length === 0" :colspan="5">Belum ada aktivitas.</TableEmpty>
          <TableRow v-for="log in items" :key="log.id">
            <TableCell class="text-sm text-muted-foreground">{{ formatDateTime(log.createdAt) }}</TableCell>
            <TableCell>
              <p class="font-mono text-sm font-medium">{{ log.kodeOrder }}</p>
              <p class="text-xs text-muted-foreground">
                {{ log.nomorMeja ? `Meja ${log.nomorMeja}` : `Bawa Pulang${log.customerName ? ` · ${log.customerName}` : ''}` }}
              </p>
            </TableCell>
            <TableCell>
              <div class="flex items-center gap-1.5 text-sm">
                <Badge :class="STATUS_BADGE_CLASS[log.statusFrom]">{{ STATUS_LABEL[log.statusFrom] }}</Badge>
                <span class="text-muted-foreground">&rarr;</span>
                <Badge :class="STATUS_BADGE_CLASS[log.statusTo]">{{ STATUS_LABEL[log.statusTo] }}</Badge>
              </div>
            </TableCell>
            <TableCell class="text-sm">
              <span v-if="log.changedBy" class="font-medium">{{ log.changedBy }}</span>
              <span v-else class="italic text-muted-foreground">Customer</span>
            </TableCell>
            <TableCell class="text-sm text-muted-foreground">{{ log.catatan || '—' }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </div>
</template>
