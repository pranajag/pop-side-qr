<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { useOrdersStore } from '@/stores/orders'
import { useStaffCallsStore } from '@/stores/staffCalls'
import { useProductsStore } from '@/stores/products'
import { formatApiError, API_URL } from '@/lib/api'
import { formatRupiah, formatDateTime } from '@/lib/format'
import { STATUS_LABEL, STATUS_BADGE_CLASS } from '@/lib/orderStatus'
import { stockStatus } from '@/lib/stock'
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import logoUrl from '@/assets/pop-side-logo.jpg'
import {
  LoaderCircleIcon,
  CheckIcon,
  XIcon,
  BellIcon,
  PlusIcon,
  ImageIcon,
  PackageXIcon,
  SearchIcon,
  ReceiptIcon,
  PrinterIcon,
} from '@lucide/vue'

const POLL_MS = 8000

const router = useRouter()
const store = useOrdersStore()
const calls = useStaffCallsStore()
const products = useProductsStore()
const lowStockProducts = computed(() => products.items.filter((p) => stockStatus(p) !== null))

const searchQuery = ref('')
const filteredItems = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return store.items
  return store.items.filter((o) => {
    return (
      o.kodeOrder.toLowerCase().includes(q) ||
      (o.customerName?.toLowerCase().includes(q) ?? false) ||
      (o.nomorMeja?.toLowerCase().includes(q) ?? false)
    )
  })
})
const busyId = ref(null)
const cancelTarget = ref(null)
const cancelReason = ref('')
const cancelling = ref(false)
const resolvingCallId = ref(null)
const buktiOrderId = ref(null)
const receiptOrder = ref(null)

function printReceipt() {
  window.print()
}
// Split from confirmOpen deliberately: confirmTarget must never go back to
// null on close, or the dialog's description (which interpolates metode/
// totalHarga, not just an id) renders "undefined"/"NaN" for the ~150ms
// close-transition before it unmounts.
const confirmOpen = ref(false)
const confirmTarget = ref(null)

function buktiBayarUrl(orderId) {
  // Browser sends the session cookie automatically for this <img> load —
  // localhost:5173 and localhost:3000 are different origins but the same
  // *site* (SameSite=Strict only blocks cross-site, not cross-port), and
  // requireAuth on this route rejects the request without it regardless.
  return `${API_URL}/admin/orders/${orderId}/bukti-bayar`
}

const FILTERS = [
  { value: undefined, label: 'Aktif' },
  { value: 'waiting_verif', label: 'Menunggu Verifikasi' },
  { value: 'pending', label: 'Menunggu Bayar' },
  { value: 'confirmed', label: 'Dikonfirmasi' },
  { value: 'cooking', label: 'Dimasak' },
  { value: 'ready', label: 'Siap' },
  { value: 'all', label: 'Semua' },
]

const NEXT_ACTION = {
  confirmed: { status: 'cooking', label: 'Mulai Masak' },
  cooking: { status: 'ready', label: 'Siap Diambil' },
  ready: { status: 'completed', label: 'Selesai' },
}
const CANCELLABLE = new Set(['pending', 'waiting_verif', 'confirmed', 'cooking', 'ready'])

let pollTimer = null
onMounted(() => {
  store.fetchAll()
  calls.fetchPending()
  products.fetchAll()
  pollTimer = setInterval(() => {
    store.fetchAll()
    calls.fetchPending()
    products.fetchAll()
  }, POLL_MS)
})
onUnmounted(() => clearInterval(pollTimer))

function needsPaymentConfirm(order) {
  return (order.metode === 'qris' && order.status === 'waiting_verif') || (order.metode !== 'qris' && order.status === 'pending')
}

async function onResolveCall(call) {
  resolvingCallId.value = call.id
  try {
    await calls.resolve(call.id)
  } catch (err) {
    toast.error(formatApiError(err))
    calls.fetchPending()
  } finally {
    resolvingCallId.value = null
  }
}

// Same non-reactive-plain-variable pattern as pendingCancel below —
// AlertDialogAction closes the dialog (nulling confirmTarget) before the
// @click handler's own turn, so the handler needs its own copy to read.
let pendingConfirm = null

function openConfirm(order) {
  confirmTarget.value = order
  confirmOpen.value = true
  pendingConfirm = order
}

async function onConfirm() {
  const target = pendingConfirm
  if (!target) return
  busyId.value = target.id
  try {
    await store.confirmPayment(target.id)
    toast.success(`${target.kodeOrder} dikonfirmasi`)
  } catch (err) {
    toast.error(formatApiError(err))
    store.fetchAll()
  } finally {
    busyId.value = null
    pendingConfirm = null
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
const cancelRefundInput = ref('')

// Cash only actually changed hands once a tunai order passed `pending` —
// before that, the customer hadn't paid yet, so there's nothing to give
// back. QRIS/debit refunds don't run through this system's cash drawer at
// all, so they're never asked for here either.
const needsRefundInput = computed(() => cancelTarget.value?.metode === 'tunai' && cancelTarget.value?.status !== 'pending')

// Same Number-vs-string gotcha as ShiftView's cash-counted input — Vue
// auto-casts v-model on a native type="number" input to a Number once
// typed, so a bare string assumption breaks on the first keystroke.
const cancelRefundNumber = computed(() => {
  const raw = cancelRefundInput.value
  if (raw === '' || raw === null || raw === undefined) return null
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : null
})

function openCancel(order) {
  cancelTarget.value = order
  pendingCancel = order
  cancelReason.value = ''
  cancelRefundInput.value = ''
}

async function onCancelConfirm() {
  const target = pendingCancel
  if (!target) return

  cancelling.value = true
  try {
    const refund = needsRefundInput.value ? cancelRefundNumber.value ?? undefined : undefined
    await store.updateStatus(target.id, 'cancelled', cancelReason.value || undefined, refund)
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
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-lg font-semibold tracking-tight">Pesanan</h1>
        <p class="text-sm text-muted-foreground">Konfirmasi pembayaran & update status pesanan.</p>
      </div>
      <Button class="gap-2" @click="router.push({ name: 'pesanan-manual' })">
        <PlusIcon class="size-4" />
        Pesanan Manual
      </Button>
    </div>

    <div v-if="calls.items.length > 0" class="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <div v-for="call in calls.items" :key="call.id" class="flex items-center justify-between gap-3">
        <span class="flex items-center gap-2 text-sm">
          <BellIcon class="size-4 shrink-0 text-amber-600" />
          <span>
            <span class="font-semibold">Meja {{ call.nomorMeja }}</span>
            <span v-if="call.catatan" class="text-muted-foreground"> · {{ call.catatan }}</span>
          </span>
        </span>
        <Button size="sm" variant="outline" :disabled="resolvingCallId === call.id" @click="onResolveCall(call)">
          <LoaderCircleIcon v-if="resolvingCallId === call.id" class="size-3.5 animate-spin" />
          Selesai
        </Button>
      </div>
    </div>

    <div v-if="lowStockProducts.length > 0" class="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
      <PackageXIcon class="size-4 shrink-0 text-amber-600" />
      <span class="font-medium">Stok menipis:</span>
      <span
        v-for="(p, i) in lowStockProducts"
        :key="p.id"
        :class="p.stok <= 0 ? 'font-semibold text-destructive' : 'text-amber-700'"
      >
        {{ p.nama }} ({{ p.stok }}){{ i < lowStockProducts.length - 1 ? ',' : '' }}
      </span>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3">
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
      <div class="relative w-full max-w-xs sm:w-64">
        <SearchIcon class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="searchQuery" placeholder="Cari kode order, meja, nama..." class="pl-8" />
      </div>
    </div>

    <p v-if="!store.loading && filteredItems.length === 0" class="py-10 text-center text-sm text-muted-foreground">
      {{ searchQuery ? 'Tidak ada pesanan yang cocok.' : 'Tidak ada pesanan.' }}
    </p>

    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div v-for="order in filteredItems" :key="order.id" class="space-y-3 rounded-lg border bg-card p-4">
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="font-mono text-sm font-semibold">{{ order.kodeOrder }}</p>
            <p class="text-xs text-muted-foreground">
              {{ order.nomorMeja ? `Meja ${order.nomorMeja}` : `Bawa Pulang${order.customerName ? ` · ${order.customerName}` : ''}` }}
              &middot; {{ order.metode.toUpperCase() }}
            </p>
          </div>
          <Badge :class="STATUS_BADGE_CLASS[order.status]">{{ STATUS_LABEL[order.status] }}</Badge>
        </div>

        <ul class="space-y-0.5 text-sm text-muted-foreground">
          <li v-for="(item, idx) in order.items" :key="idx">
            {{ item.qty }}x {{ item.nama }}
            <span v-if="item.variants?.length">({{ item.variants.map((v) => v.namaOption).join(', ') }})</span>
            <span v-if="item.catatan" class="italic">({{ item.catatan }})</span>
          </li>
        </ul>
        <p v-if="order.catatan" class="text-xs italic text-muted-foreground">Catatan: {{ order.catatan }}</p>

        <div class="flex items-center justify-between border-t pt-2 text-sm font-semibold">
          <span>Total</span>
          <span>{{ formatRupiah(order.totalHarga) }}</span>
        </div>

        <div class="flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="outline" class="gap-1.5" @click="receiptOrder = order">
            <ReceiptIcon class="size-3.5" />
            Cetak Struk
          </Button>
          <Button
            v-if="order.hasBuktiBayar"
            size="sm"
            variant="outline"
            class="gap-1.5"
            @click="buktiOrderId = order.id"
          >
            <ImageIcon class="size-3.5" />
            Lihat Bukti
          </Button>
          <Button
            v-if="needsPaymentConfirm(order)"
            size="sm"
            class="gap-1.5"
            :disabled="busyId === order.id"
            @click="openConfirm(order)"
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

    <AlertDialog :open="confirmOpen" @update:open="(v) => (confirmOpen = v)">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Konfirmasi pembayaran {{ confirmTarget?.kodeOrder }}?</AlertDialogTitle>
          <AlertDialogDescription>
            {{
              confirmTarget?.metode === 'qris'
                ? 'Pastikan sudah cek bukti pembayarannya sebelum konfirmasi.'
                : `Pastikan sudah terima ${confirmTarget?.metode} ${formatRupiah(confirmTarget?.totalHarga)} dari customer sebelum konfirmasi.`
            }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction :disabled="busyId === confirmTarget?.id" @click="onConfirm">Ya, Konfirmasi</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

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
        <div v-if="needsRefundInput" class="space-y-2">
          <Label for="cancel-refund">Uang Dikembalikan ke Customer (opsional)</Label>
          <Input id="cancel-refund" v-model="cancelRefundInput" type="number" min="0" step="500" placeholder="0" />
          <p class="text-xs text-muted-foreground">
            Order ini sudah dikonfirmasi (tunai dianggap sudah diterima) — catat kalau uangnya dikembalikan, supaya
            rekonsiliasi kas shift ini lebih akurat.
          </p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction :disabled="cancelling" @click="onCancelConfirm">Ya, Batalkan Pesanan</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <Dialog :open="!!buktiOrderId" @update:open="(v) => !v && (buktiOrderId = null)">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bukti Pembayaran</DialogTitle>
        </DialogHeader>
        <img
          v-if="buktiOrderId"
          :src="buktiBayarUrl(buktiOrderId)"
          alt="Bukti pembayaran"
          class="w-full rounded-lg border object-contain"
        />
      </DialogContent>
    </Dialog>

    <Dialog :open="!!receiptOrder" @update:open="(v) => !v && (receiptOrder = null)">
      <DialogContent class="print:border-0 print:shadow-none sm:max-w-sm">
        <DialogHeader class="print:hidden">
          <DialogTitle>Struk {{ receiptOrder?.kodeOrder }}</DialogTitle>
        </DialogHeader>
        <div v-if="receiptOrder" class="space-y-3 font-mono text-xs">
          <div class="flex flex-col items-center gap-1.5 border-b border-dashed pb-3 text-center">
            <img :src="logoUrl" alt="Popside" class="size-10 rounded-md" />
            <p class="text-sm font-bold">POPSIDE</p>
            <p class="text-muted-foreground">{{ formatDateTime(receiptOrder.createdAt) }}</p>
          </div>
          <div class="space-y-0.5 border-b border-dashed pb-3">
            <div class="flex justify-between">
              <span>Kode</span>
              <span class="font-semibold">{{ receiptOrder.kodeOrder }}</span>
            </div>
            <div class="flex justify-between">
              <span>{{ receiptOrder.nomorMeja ? 'Meja' : 'Tipe' }}</span>
              <span>{{ receiptOrder.nomorMeja || `Bawa Pulang${receiptOrder.customerName ? ` (${receiptOrder.customerName})` : ''}` }}</span>
            </div>
            <div class="flex justify-between">
              <span>Bayar</span>
              <span>{{ receiptOrder.metode.toUpperCase() }}</span>
            </div>
          </div>
          <div class="space-y-1.5 border-b border-dashed pb-3">
            <div v-for="(item, idx) in receiptOrder.items" :key="idx">
              <div class="flex justify-between">
                <span>{{ item.qty }}x {{ item.nama }}</span>
                <span>{{ formatRupiah(item.harga * item.qty) }}</span>
              </div>
              <p v-if="item.variants?.length" class="pl-3 text-[11px] text-muted-foreground">
                {{ item.variants.map((v) => v.namaOption).join(', ') }}
              </p>
              <p v-if="item.catatan" class="pl-3 text-[11px] italic text-muted-foreground">{{ item.catatan }}</p>
            </div>
          </div>
          <div class="flex justify-between text-sm font-bold">
            <span>TOTAL</span>
            <span>{{ formatRupiah(receiptOrder.totalHarga) }}</span>
          </div>
          <p class="pt-2 text-center text-muted-foreground">Terima kasih!</p>
        </div>
        <DialogFooter class="print:hidden">
          <Button class="gap-2" @click="printReceipt">
            <PrinterIcon class="size-4" />
            Cetak
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
