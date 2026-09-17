<script setup>
import { onMounted, onUnmounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { useOrdersStore } from '@/stores/orders'
import { formatApiError } from '@/lib/api'
import { formatRupiah } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { LoaderCircleIcon, CheckIcon, XIcon } from '@lucide/vue'

const POLL_MS = 8000

const store = useOrdersStore()
const busyId = ref(null)
const cancelTarget = ref(null)
const cancelReason = ref('')
const cancelling = ref(false)

const FILTERS = [
  { value: undefined, label: 'Aktif' },
  { value: 'waiting_verif', label: 'Menunggu Verifikasi' },
  { value: 'pending', label: 'Menunggu Bayar' },
  { value: 'confirmed', label: 'Dikonfirmasi' },
  { value: 'cooking', label: 'Dimasak' },
  { value: 'ready', label: 'Siap' },
  { value: 'all', label: 'Semua' },
]

const STATUS_LABEL = {
  pending: 'Menunggu Pembayaran',
  waiting_verif: 'Menunggu Verifikasi',
  confirmed: 'Dikonfirmasi',
  cooking: 'Dimasak',
  ready: 'Siap',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
}
const STATUS_BADGE_CLASS = {
  pending: 'bg-status-pending text-white',
  waiting_verif: 'bg-status-waiting-verif text-white',
  confirmed: 'bg-status-confirmed text-white',
  cooking: 'bg-status-cooking text-white',
  ready: 'bg-status-ready text-white',
  completed: 'bg-status-completed text-white',
  cancelled: 'bg-status-cancelled text-white',
}
const NEXT_ACTION = {
  confirmed: { status: 'cooking', label: 'Mulai Masak' },
  cooking: { status: 'ready', label: 'Siap Diambil' },
  ready: { status: 'completed', label: 'Selesai' },
}
const CANCELLABLE = new Set(['pending', 'waiting_verif', 'confirmed', 'cooking', 'ready'])

let pollTimer = null
onMounted(() => {
  store.fetchAll()
  pollTimer = setInterval(() => store.fetchAll(), POLL_MS)
})
onUnmounted(() => clearInterval(pollTimer))

function needsPaymentConfirm(order) {
  return (order.metode === 'qris' && order.status === 'waiting_verif') || (order.metode !== 'qris' && order.status === 'pending')
}

async function onConfirm(order) {
  busyId.value = order.id
  try {
    await store.confirmPayment(order.id)
    toast.success(`${order.kodeOrder} dikonfirmasi`)
  } catch (err) {
    toast.error(formatApiError(err))
    store.fetchAll()
  } finally {
    busyId.value = null
  }
}

async function onAdvance(order) {
  const next = NEXT_ACTION[order.status]
  if (!next) return
  busyId.value = order.id
  try {
    await store.updateStatus(order.id, next.status)
    toast.success(`${order.kodeOrder} -> ${STATUS_LABEL[next.status]}`)
  } catch (err) {
    toast.error(formatApiError(err))
    store.fetchAll()
  } finally {
    busyId.value = null
  }
}

// AlertDialogAction closes the dialog itself on click, which fires our
// @update:open handler and nulls cancelTarget — *before* the @click
// handler below gets its turn, not just racing it. A plain (non-reactive)
// variable set on open and read on confirm sidesteps that entirely,
// since nothing but this file's own code ever touches it.
let pendingCancel = null

function openCancel(order) {
  cancelTarget.value = order
  pendingCancel = order
  cancelReason.value = ''
}

async function onCancelConfirm() {
  const target = pendingCancel
  if (!target) return

  cancelling.value = true
  try {
    await store.updateStatus(target.id, 'cancelled', cancelReason.value || undefined)
    toast.success(`${target.kodeOrder} dibatalkan`)
  } catch (err) {
    toast.error(formatApiError(err))
    store.fetchAll()
  } finally {
    cancelling.value = false
    pendingCancel = null
  }
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-lg font-semibold tracking-tight">Pesanan</h1>
      <p class="text-sm text-muted-foreground">Konfirmasi pembayaran & update status pesanan.</p>
    </div>

    <div class="flex flex-wrap gap-2">
      <Button
        v-for="f in FILTERS"
        :key="f.label"
        size="sm"
        :variant="store.statusFilter === f.value ? 'default' : 'outline'"
        @click="store.setFilter(f.value)"
      >
        {{ f.label }}
      </Button>
    </div>

    <p v-if="!store.loading && store.items.length === 0" class="py-10 text-center text-sm text-muted-foreground">
      Tidak ada pesanan.
    </p>

    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="order in store.items" :key="order.id" class="space-y-3 rounded-lg border bg-card p-4">
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="font-mono text-sm font-semibold">{{ order.kodeOrder }}</p>
            <p class="text-xs text-muted-foreground">Meja {{ order.nomorMeja }} &middot; {{ order.metode.toUpperCase() }}</p>
          </div>
          <Badge :class="STATUS_BADGE_CLASS[order.status]">{{ STATUS_LABEL[order.status] }}</Badge>
        </div>

        <ul class="space-y-0.5 text-sm text-muted-foreground">
          <li v-for="(item, idx) in order.items" :key="idx">
            {{ item.qty }}x {{ item.nama }}
            <span v-if="item.catatan" class="italic">({{ item.catatan }})</span>
          </li>
        </ul>
        <p v-if="order.catatan" class="text-xs italic text-muted-foreground">Catatan: {{ order.catatan }}</p>

        <div class="flex items-center justify-between border-t pt-2 text-sm font-semibold">
          <span>Total</span>
          <span>{{ formatRupiah(order.totalHarga) }}</span>
        </div>

        <div class="flex flex-wrap gap-2 pt-1">
          <Button
            v-if="needsPaymentConfirm(order)"
            size="sm"
            class="gap-1.5"
            :disabled="busyId === order.id"
            @click="onConfirm(order)"
          >
            <LoaderCircleIcon v-if="busyId === order.id" class="size-3.5 animate-spin" />
            <CheckIcon v-else class="size-3.5" />
            Konfirmasi Bayar
          </Button>
          <Button
            v-if="NEXT_ACTION[order.status]"
            size="sm"
            variant="outline"
            :disabled="busyId === order.id"
            @click="onAdvance(order)"
          >
            <LoaderCircleIcon v-if="busyId === order.id" class="size-3.5 animate-spin" />
            {{ NEXT_ACTION[order.status].label }}
          </Button>
          <Button
            v-if="CANCELLABLE.has(order.status)"
            size="sm"
            variant="ghost"
            class="gap-1.5 text-destructive hover:text-destructive"
            @click="openCancel(order)"
          >
            <XIcon class="size-3.5" />
            Batalkan
          </Button>
        </div>
      </div>
    </div>

    <AlertDialog :open="!!cancelTarget" @update:open="(v) => !v && (cancelTarget = null)">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Batalkan pesanan {{ cancelTarget?.kodeOrder }}?</AlertDialogTitle>
          <AlertDialogDescription>
            Stok yang sudah dikurangi untuk pesanan ini akan dikembalikan. Tindakan ini tidak bisa dibatalkan.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div class="space-y-2">
          <Label for="cancel-reason">Alasan (opsional)</Label>
          <Input id="cancel-reason" v-model="cancelReason" placeholder="Misal: stok habis, customer batal" maxlength="200" />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction :disabled="cancelling" @click="onCancelConfirm">Ya, Batalkan Pesanan</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
