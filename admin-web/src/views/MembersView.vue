<script setup>
import { onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { useCustomersStore } from '@/stores/customers'
import { formatApiError } from '@/lib/api'
import { formatRupiah, formatDateTime } from '@/lib/format'
import { STATUS_LABEL, STATUS_BADGE_CLASS } from '@/lib/orderStatus'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LoaderCircleIcon, SearchIcon, StarIcon } from '@lucide/vue'

const store = useCustomersStore()
const searchQuery = ref('')

let searchDebounce = null
function onSearchInput() {
  clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => store.fetchAll(searchQuery.value.trim() || undefined), 250)
}

onMounted(() => store.fetchAll())

const detailId = ref(null)
const detailData = ref(null)
const detailLoading = ref(false)

async function openDetail(customer) {
  detailId.value = customer.id
  detailData.value = null
  detailLoading.value = true
  try {
    detailData.value = await store.get(customer.id)
  } catch (err) {
    toast.error(formatApiError(err))
    detailId.value = null
  } finally {
    detailLoading.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-lg font-semibold tracking-tight">Member</h1>
      <p class="text-sm text-muted-foreground">
        Program loyalitas — poin didapat otomatis dari Pesanan Manual dengan nomor HP diisi.
      </p>
    </div>

    <div class="relative max-w-sm">
      <SearchIcon class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        v-model="searchQuery"
        placeholder="Cari nomor HP atau nama..."
        class="pl-8"
        @input="onSearchInput"
      />
    </div>

    <div class="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>No. HP</TableHead>
            <TableHead>Nama</TableHead>
            <TableHead class="w-28">Poin</TableHead>
            <TableHead class="w-40">Member Sejak</TableHead>
            <TableHead class="w-20"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableEmpty v-if="!store.loading && store.items.length === 0" :colspan="5">
            {{ searchQuery ? 'Tidak ada member yang cocok.' : 'Belum ada member.' }}
          </TableEmpty>
          <TableRow v-for="c in store.items" :key="c.id">
            <TableCell class="font-medium">{{ c.telepon }}</TableCell>
            <TableCell class="text-muted-foreground">{{ c.nama || '—' }}</TableCell>
            <TableCell>
              <span class="flex items-center gap-1 font-semibold text-accent-foreground">
                <StarIcon class="size-3.5 fill-current text-amber-500" />
                {{ c.points }}
              </span>
            </TableCell>
            <TableCell class="text-sm text-muted-foreground">{{ formatDateTime(c.createdAt) }}</TableCell>
            <TableCell class="text-right">
              <Button variant="ghost" size="sm" @click="openDetail(c)">Detail</Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <Dialog :open="!!detailId" @update:open="(v) => !v && (detailId = null)">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Member {{ detailData?.telepon }}</DialogTitle>
        </DialogHeader>
        <div v-if="detailLoading" class="flex justify-center py-8">
          <LoaderCircleIcon class="size-6 animate-spin text-muted-foreground" />
        </div>
        <div v-else-if="detailData" class="space-y-4">
          <div class="flex items-center justify-between rounded-md border p-3">
            <div>
              <p class="font-medium">{{ detailData.nama || 'Tanpa nama' }}</p>
              <p class="text-xs text-muted-foreground">{{ detailData.telepon }}</p>
            </div>
            <span class="flex items-center gap-1.5 text-lg font-bold text-accent-foreground">
              <StarIcon class="size-5 fill-current text-amber-500" />
              {{ detailData.points }}
            </span>
          </div>

          <div>
            <h3 class="mb-2 text-sm font-semibold text-muted-foreground">Riwayat Pesanan</h3>
            <p v-if="detailData.orders.length === 0" class="text-sm text-muted-foreground">
              Belum ada pesanan.
            </p>
            <div v-else class="space-y-2">
              <div
                v-for="o in detailData.orders"
                :key="o.id"
                class="flex items-center justify-between rounded-md border p-2.5 text-sm"
              >
                <div>
                  <p class="font-mono font-medium">{{ o.kodeOrder }}</p>
                  <p class="text-xs text-muted-foreground">{{ formatDateTime(o.createdAt) }}</p>
                </div>
                <div class="text-right">
                  <Badge :class="STATUS_BADGE_CLASS[o.status]">{{ STATUS_LABEL[o.status] }}</Badge>
                  <p class="mt-0.5 text-xs text-muted-foreground">
                    {{ formatRupiah(o.totalHarga) }}
                    <span v-if="o.pointsEarned > 0">· +{{ o.pointsEarned }} poin</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
