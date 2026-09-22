<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { useOrdersStore } from '@/stores/orders'
import { useStaffCallsStore } from '@/stores/staffCalls'
import { useProductsStore } from '@/stores/products'
import { useSettingsStore } from '@/stores/settings'
import { useActiveShiftStore } from '@/stores/activeShift'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import logoUrl from '@/assets/pop-side-logo.jpg'
import {
  LoaderCircleIcon,
  CheckIcon,
  XIcon,
  BanIcon,
  BellIcon,
  PlusIcon,
  ImageIcon,
  PackageXIcon,
  SearchIcon,
  ReceiptIcon,
  PrinterIcon,
  EllipsisVerticalIcon,
  ClockIcon,
  ChefHatIcon,
} from '@lucide/vue'

const POLL_MS = 8000

const router = useRouter()
const route = useRoute()
const store = useOrdersStore()
const calls = useStaffCallsStore()
const products = useProductsStore()
const settings = useSettingsStore()
const activeShiftStore = useActiveShiftStore()
const lowStockProducts = computed(() =>
  products.items.filter((p) => stockStatus(p) !== null)
)

const searchQuery = ref('')
// Kitchen queue position — "buat ini duluan, lalu ini". store.items is
// already sorted confirmed/cooking-first then oldest-first (server's
// list(), orderManagement.service.js), so position is just this order's
// index within that existing order — no separate sequence field needed.
// It's naturally live: when #1 finishes (moves to 'ready'), it drops out
// of this filter and #2 becomes #1 on the very next poll, no renumbering
// logic required anywhere.
const KITCHEN_QUEUE_STATUSES = new Set(['confirmed', 'cooking'])
const kitchenQueue = computed(() =>
  store.items.filter((o) => KITCHEN_QUEUE_STATUSES.has(o.status))
)
function queuePosition(order) {
  if (!KITCHEN_QUEUE_STATUSES.has(order.status)) return null
  return kitchenQueue.value.findIndex((o) => o.id === order.id) + 1
}

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
// Split from cancelTarget deliberately, same reason as confirmOpen/
// confirmTarget below: AlertDialogAction closes the dialog (nulling a
// target ref bound straight to :open) before the close transition finishes,
// which flashes "kodeOrder undefined" in the title for ~150ms. cancelTarget
// keeps its last value across a close so the fade-out still reads correctly.
const cancelOpen = ref(false)
const cancelTarget = ref(null)
const cancelReason = ref('')
const cancelling = ref(false)
const resolvingCallId = ref(null)
const buktiOrderId = ref(null)
const receiptOrder = ref(null)
// totalHarga already has discount subtracted and tax/service added
// (order.service.js's computeTaxAndService) — subtotal for the receipt's
// own breakdown line has to walk that back out.
const receiptSubtotal = computed(() => {
  if (!receiptOrder.value) return 0
  return (
    receiptOrder.value.totalHarga -
    receiptOrder.value.taxAmount -
    receiptOrder.value.serviceChargeAmount +
    receiptOrder.value.discountAmount
  )
})
const kitchenTicketOrder = ref(null)

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
const CANCELLABLE = new Set([
  'pending',
  'waiting_verif',
  'confirmed',
  'cooking',
  'ready',
])
// Past the payment gate (confirmed/cooking/ready) means money already
// changed hands — cancelling one of these is a "void" (customer backed out
// after paying), not a plain pre-payment cancel. Same statuses, different
// label/copy/refund emphasis in the dialog below.
const PAID_STATUSES = new Set(['confirmed', 'cooking', 'ready'])
function isVoidCase(order) {
  return PAID_STATUSES.has(order.status)
}

// Time since the order's LAST STATUS CHANGE (not since it was placed) — for
// "ready" that's how long it's sat waiting for pickup, for "confirmed"/
// "cooking" it's how long the kitchen has had it. Ticks off `now` so the
// number keeps moving between polls instead of jumping every POLL_MS.
const TERMINAL_STATUSES = new Set(['completed', 'cancelled'])
const URGENT_MINUTES = 10
const now = ref(Date.now())
function elapsedMinutes(order) {
  return Math.max(
    0,
    Math.floor((now.value - new Date(order.updatedAt).getTime()) / 60000)
  )
}
function isUrgent(order) {
  return (
    !TERMINAL_STATUSES.has(order.status) &&
    elapsedMinutes(order) >= URGENT_MINUTES
  )
}

let pollTimer = null
let clockTimer = null
onMounted(() => {
  // DashboardView.vue's "Cek Sekarang" link deep-links here with
  // ?status=waiting_verif — only ever applied when it's one of this page's
  // own known filter values, so a stray/malformed query param can't set
  // statusFilter to something the tab bar itself has no button for.
  const queryStatus = route.query.status
  if (queryStatus && FILTERS.some((f) => f.value === queryStatus)) {
    store.setFilter(queryStatus)
  } else {
    store.fetchAll()
  }
  calls.fetchPending()
  products.fetchAll()
  settings.fetchSettings()
  activeShiftStore.fetch()
  pollTimer = setInterval(() => {
    store.fetchAll()
    calls.fetchPending()
    products.fetchAll()
  }, POLL_MS)
  clockTimer = setInterval(() => {
    now.value = Date.now()
  }, 30000)
})
onUnmounted(() => {
  clearInterval(pollTimer)
  clearInterval(clockTimer)
})

function needsPaymentConfirm(order) {
  return (
    (order.metode === 'qris' && order.status === 'waiting_verif') ||
    (order.metode !== 'qris' && order.status === 'pending')
  )
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

// Cash handed over on a tunai order. Blank is allowed — a kasir who
// already knows the change isn't forced through an extra field — and the
// server recomputes the change from this anyway, so what shows here is
// only ever a preview of what it will say.
const cashReceivedInput = ref('')
const cashReceivedNumber = computed(() => {
  const raw = cashReceivedInput.value
  if (raw === '' || raw === null) return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : null
})
// Back out the pre-discount subtotal: tax and service were charged on the
// amount left AFTER the discount, so they have to come off before the
// discount goes back on. Both are 0 unless the store configured a rate.
const confirmSubtotal = computed(() => {
  const o = confirmTarget.value
  if (!o) return 0
  return o.totalHarga - o.taxAmount - o.serviceChargeAmount + o.discountAmount
})
const changePreview = computed(() => {
  if (cashReceivedNumber.value === null || !confirmTarget.value) return null
  return cashReceivedNumber.value - confirmTarget.value.totalHarga
})
// Quick-tap amounts: the exact total, then the round numbers a customer
// actually hands over for a bill of this size.
const cashSuggestions = computed(() => {
  const total = confirmTarget.value?.totalHarga
  if (!total) return []
  const rounded = [20000, 50000, 100000, 150000, 200000].filter((v) => v > total)
  const ceil = Math.ceil(total / 10000) * 10000
  return [...new Set([total, ceil, ...rounded])].slice(0, 4)
})

function openConfirm(order) {
  confirmTarget.value = order
  confirmOpen.value = true
  pendingConfirm = order
  cashReceivedInput.value = ''
}

async function onConfirm() {
  const target = pendingConfirm
  if (!target) return
  // Only ever sent for cash — the server rejects it on any other method
  // rather than silently recording something meaningless.
  const cash = target.metode === 'tunai' ? cashReceivedNumber.value : null
  busyId.value = target.id
  try {
    const order = await store.confirmPayment(target.id, cash)
    if (order?.changeAmount !== null && order?.changeAmount !== undefined) {
      toast.success(`${target.kodeOrder} dikonfirmasi`, {
        description: `Kembalian untuk customer: ${formatRupiah(order.changeAmount)}`,
        duration: 10000,
      })
    } else {
      toast.success(`${target.kodeOrder} dikonfirmasi`)
    }
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

// AlertDialogAction closes the dialog itself on click, which flips
// cancelOpen to false right away — before the @click handler below gets its
// turn, not just racing it. A plain (non-reactive) variable set on open and
// read on confirm sidesteps needing cancelTarget to still be "current" at
// submit time, since nothing but this file's own code ever touches it.
let pendingCancel = null
const cancelRefundInput = ref('')
const cancelPin = ref('')

// Cash only actually changed hands once a tunai order passed `pending` —
// before that, the customer hadn't paid yet, so there's nothing to give
// back. QRIS/debit refunds don't run through this system's cash drawer at
// all, so they're never asked for here either.
const needsRefundInput = computed(
  () =>
    cancelTarget.value?.metode === 'tunai' &&
    cancelTarget.value?.status !== 'pending'
)

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
  cancelOpen.value = true
  pendingCancel = order
  cancelReason.value = ''
  cancelPin.value = ''
  // Voiding a paid tunai order is almost always a full refund — prefilled
  // so the common case takes zero typing, still editable for a partial one.
  cancelRefundInput.value =
    isVoidCase(order) && order.metode === 'tunai'
      ? String(order.totalHarga)
      : ''
}

async function onCancelConfirm() {
  const target = pendingCancel
  if (!target) return

  cancelling.value = true
  try {
    const refund = needsRefundInput.value
      ? (cancelRefundNumber.value ?? undefined)
      : undefined
    await store.updateStatus(
      target.id,
      'cancelled',
      cancelReason.value || undefined,
      refund,
      isVoidCase(target) ? cancelPin.value : undefined
    )
    toast.success(
      isVoidCase(target)
        ? `${target.kodeOrder} di-void`
        : `${target.kodeOrder} dibatalkan`
    )
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
        <p class="text-sm text-muted-foreground">
          Konfirmasi pembayaran & update status pesanan.
        </p>
      </div>
      <Button class="gap-2" @click="router.push({ name: 'pesanan-manual' })">
        <PlusIcon class="size-4" />
        Pesanan Manual
      </Button>
    </div>

    <div
      v-if="calls.items.length > 0"
      class="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950"
    >
      <div
        v-for="call in calls.items"
        :key="call.id"
        class="flex items-center justify-between gap-3"
      >
        <span class="flex items-center gap-2 text-sm">
          <BellIcon
            class="size-4 shrink-0 text-amber-600 dark:text-amber-400"
          />
          <span>
            <span class="font-semibold">Meja {{ call.nomorMeja }}</span>
            <span v-if="call.catatan" class="text-muted-foreground">
              · {{ call.catatan }}</span
            >
          </span>
        </span>
        <Button
          size="sm"
          variant="outline"
          :disabled="resolvingCallId === call.id"
          @click="onResolveCall(call)"
        >
          <LoaderCircleIcon
            v-if="resolvingCallId === call.id"
            class="size-3.5 animate-spin"
          />
          Selesai
        </Button>
      </div>
    </div>

    <div
      v-if="activeShiftStore.loaded && !activeShiftStore.hasActiveShift"
      class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm"
    >
      <span class="text-destructive">
        Kamu belum mulai shift — konfirmasi bayar & proses pesanan tidak bisa dilakukan dulu.
      </span>
      <Button size="sm" variant="outline" @click="router.push({ name: 'shift' })">
        Mulai Shift
      </Button>
    </div>

    <div
      v-if="lowStockProducts.length > 0"
      class="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950"
    >
      <PackageXIcon
        class="size-4 shrink-0 text-amber-600 dark:text-amber-400"
      />
      <span class="font-medium">Stok menipis:</span>
      <span
        v-for="(p, i) in lowStockProducts"
        :key="p.id"
        :class="
          p.stok <= 0
            ? 'font-semibold text-destructive'
            : 'text-amber-700 dark:text-amber-300'
        "
      >
        {{ p.nama }} ({{ p.stok }}){{
          i < lowStockProducts.length - 1 ? ',' : ''
        }}
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
        <SearchIcon
          class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          v-model="searchQuery"
          placeholder="Cari kode order, meja, nama..."
          class="pl-8"
        />
      </div>
    </div>

    <p
      v-if="!store.loading && filteredItems.length === 0"
      class="py-10 text-center text-sm text-muted-foreground"
    >
      {{ searchQuery ? 'Tidak ada pesanan yang cocok.' : 'Tidak ada pesanan.' }}
    </p>

    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div
        v-for="order in filteredItems"
        :key="order.id"
        class="space-y-3 rounded-lg border bg-card p-4"
      >
        <div class="flex items-start justify-between gap-2">
          <div>
            <div class="flex items-center gap-1.5">
              <span
                v-if="queuePosition(order)"
                class="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground"
                :title="`Antrian dapur ke-${queuePosition(order)}`"
              >
                {{ queuePosition(order) }}
              </span>
              <p class="font-mono text-sm font-semibold">{{ order.kodeOrder }}</p>
            </div>
            <p class="text-xs text-muted-foreground">
              {{
                order.nomorMeja
                  ? `Meja ${order.nomorMeja}`
                  : `Bawa Pulang${order.customerName ? ` · ${order.customerName}` : ''}`
              }}
              &middot; {{ order.metode.toUpperCase() }}
            </p>
          </div>
          <div class="flex flex-col items-end gap-1">
            <Badge :class="STATUS_BADGE_CLASS[order.status]">{{
              STATUS_LABEL[order.status]
            }}</Badge>
            <p
              v-if="!TERMINAL_STATUSES.has(order.status)"
              class="flex items-center gap-1 text-[11px]"
              :class="
                isUrgent(order)
                  ? 'font-medium text-destructive'
                  : 'text-muted-foreground'
              "
            >
              <ClockIcon class="size-3" />
              {{ elapsedMinutes(order) }} menit
            </p>
          </div>
        </div>

        <ul class="space-y-0.5 text-sm text-muted-foreground">
          <li v-for="(item, idx) in order.items" :key="idx">
            {{ item.qty }}x {{ item.nama }}
            <span v-if="item.variants?.length"
              >({{ item.variants.map((v) => v.namaOption).join(', ') }})</span
            >
            <span v-if="item.catatan" class="italic">({{ item.catatan }})</span>
          </li>
        </ul>
        <p v-if="order.catatan" class="text-xs italic text-muted-foreground">
          Catatan: {{ order.catatan }}
        </p>
        <p v-if="order.discountAmount > 0" class="text-xs text-destructive">
          Diskon {{ formatRupiah(order.discountAmount) }}{{ order.discountReason ? ` — ${order.discountReason}` : '' }}
        </p>

        <div
          class="flex items-center justify-between border-t pt-2 text-sm font-semibold"
        >
          <span>Total</span>
          <span>{{ formatRupiah(order.totalHarga) }}</span>
        </div>

        <!-- Exactly 2 top-level controls per card, on purpose: one primary
        button that's whatever actually moves the order forward, plus one
        overflow menu for everything else (receipt, proof, cancel/void) — a
        busy kasir shouldn't have to scan 4-5 buttons to find the one that
        matters right now. -->
        <div class="flex items-center gap-2 pt-1">
          <Button
            v-if="needsPaymentConfirm(order)"
            size="sm"
            class="flex-1 gap-1.5"
            :disabled="busyId === order.id || (activeShiftStore.loaded && !activeShiftStore.hasActiveShift)"
            @click="openConfirm(order)"
          >
            <LoaderCircleIcon
              v-if="busyId === order.id"
              class="size-3.5 animate-spin"
            />
            <CheckIcon v-else class="size-3.5" />
            Konfirmasi Bayar
          </Button>
          <Button
            v-else-if="NEXT_ACTION[order.status]"
            size="sm"
            class="flex-1 gap-1.5"
            :disabled="busyId === order.id || (activeShiftStore.loaded && !activeShiftStore.hasActiveShift)"
            @click="onAdvance(order)"
          >
            <LoaderCircleIcon
              v-if="busyId === order.id"
              class="size-3.5 animate-spin"
            />
            {{ NEXT_ACTION[order.status].label }}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button
                size="sm"
                variant="outline"
                class="shrink-0"
                aria-label="Aksi lainnya"
              >
                <EllipsisVerticalIcon class="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem class="gap-2" @click="receiptOrder = order">
                <ReceiptIcon class="size-3.5" />
                Cetak Struk
              </DropdownMenuItem>
              <DropdownMenuItem class="gap-2" @click="kitchenTicketOrder = order">
                <ChefHatIcon class="size-3.5" />
                Cetak Tiket Dapur
              </DropdownMenuItem>
              <DropdownMenuItem
                v-if="order.hasBuktiBayar"
                class="gap-2"
                @click="buktiOrderId = order.id"
              >
                <ImageIcon class="size-3.5" />
                Lihat Bukti
              </DropdownMenuItem>
              <DropdownMenuSeparator v-if="CANCELLABLE.has(order.status)" />
              <DropdownMenuItem
                v-if="CANCELLABLE.has(order.status)"
                variant="destructive"
                class="gap-2"
                @click="openCancel(order)"
              >
                <BanIcon v-if="isVoidCase(order)" class="size-3.5" />
                <XIcon v-else class="size-3.5" />
                {{ isVoidCase(order) ? 'Void' : 'Batalkan' }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>

    <AlertDialog :open="confirmOpen" @update:open="(v) => (confirmOpen = v)">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle
            >Konfirmasi pembayaran
            {{ confirmTarget?.kodeOrder }}?</AlertDialogTitle
          >
          <AlertDialogDescription v-if="confirmTarget?.metode !== 'qris'">
            Pastikan sudah terima {{ confirmTarget?.metode }}
            {{ formatRupiah(confirmTarget?.totalHarga) }} dari customer sebelum
            konfirmasi.
          </AlertDialogDescription>
          <AlertDialogDescription v-else>
            Pastikan sudah cek bukti pembayarannya sebelum konfirmasi.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <!-- Shown before anything else: without it a kasir is asked to
        collect less than the menu prices add up to, with no visible reason
        — which reads as a bug, and hides the one case worth questioning
        (a discount claimed on someone else's member number). -->
        <div
          v-if="confirmTarget?.discountAmount > 0"
          class="space-y-1 rounded-lg border border-primary-strong/30 bg-primary/10 px-3 py-2.5 text-sm"
        >
          <p class="font-medium">
            Pesanan ini dapat diskon
            <span v-if="confirmTarget?.discountReason" class="font-normal text-muted-foreground">
              — {{ confirmTarget.discountReason }}
            </span>
          </p>
          <div class="flex justify-between text-muted-foreground">
            <span>Sebelum diskon</span>
            <span>{{ formatRupiah(confirmSubtotal) }}</span>
          </div>
          <div class="flex justify-between">
            <span>Ditagih ke customer</span>
            <span class="font-semibold">{{ formatRupiah(confirmTarget.totalHarga) }}</span>
          </div>
        </div>

        <div v-if="confirmTarget?.metode === 'qris'" class="space-y-3">
          <img
            v-if="confirmTarget?.hasBuktiBayar"
            :src="buktiBayarUrl(confirmTarget.id)"
            alt="Bukti pembayaran"
            class="max-h-72 w-full rounded-lg border object-contain"
          />
        </div>

        <div v-else-if="confirmTarget?.metode === 'tunai'" class="space-y-3">
          <div class="space-y-2">
            <Label for="cash-received">Uang Diterima (opsional)</Label>
            <Input
              id="cash-received"
              v-model="cashReceivedInput"
              type="number"
              inputmode="numeric"
              min="0"
              :placeholder="String(confirmTarget?.totalHarga ?? 0)"
            />
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="amount in cashSuggestions"
                :key="amount"
                type="button"
                class="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                @click="cashReceivedInput = String(amount)"
              >
                {{ formatRupiah(amount) }}
              </button>
            </div>
          </div>

          <div
            v-if="changePreview !== null"
            class="rounded-lg border px-3 py-2.5 text-sm"
            :class="
              changePreview < 0
                ? 'border-destructive/40 bg-destructive/10 text-destructive'
                : 'border-primary-strong/30 bg-primary/10'
            "
          >
            <template v-if="changePreview < 0">
              Uang diterima kurang {{ formatRupiah(Math.abs(changePreview)) }}
              dari total.
            </template>
            <template v-else>
              <span class="text-muted-foreground">Kembalian ke customer</span>
              <span class="ml-2 text-base font-semibold">{{
                formatRupiah(changePreview)
              }}</span>
            </template>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction
            :disabled="
              busyId === confirmTarget?.id ||
              (changePreview !== null && changePreview < 0)
            "
            @click="onConfirm"
            >Ya, Konfirmasi</AlertDialogAction
          >
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog :open="cancelOpen" @update:open="(v) => (cancelOpen = v)">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{
              cancelTarget && isVoidCase(cancelTarget)
                ? `Void pesanan ${cancelTarget?.kodeOrder}?`
                : `Batalkan pesanan ${cancelTarget?.kodeOrder}?`
            }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            <template v-if="cancelTarget && isVoidCase(cancelTarget)">
              Customer tidak jadi memesan, tapi pesanan ini sudah dibayar ({{
                cancelTarget.metode.toUpperCase()
              }}). Stok yang sudah dikurangi akan dikembalikan. Tindakan ini
              tidak bisa dibatalkan.
            </template>
            <template v-else>
              Stok yang sudah dikurangi untuk pesanan ini akan dikembalikan.
              Tindakan ini tidak bisa dibatalkan.
            </template>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div class="space-y-2">
          <Label for="cancel-reason">Alasan (opsional)</Label>
          <Input
            id="cancel-reason"
            v-model="cancelReason"
            placeholder="Misal: stok habis, customer batal"
            maxlength="200"
          />
        </div>
        <div v-if="needsRefundInput" class="space-y-2">
          <Label for="cancel-refund">Uang Dikembalikan ke Customer</Label>
          <Input
            id="cancel-refund"
            v-model="cancelRefundInput"
            type="number"
            min="0"
            step="500"
            placeholder="0"
          />
          <p class="text-xs text-muted-foreground">
            Order ini sudah dikonfirmasi (tunai dianggap sudah diterima) — sudah
            diisi otomatis dengan total order, sesuaikan kalau cuma sebagian
            yang dikembalikan. Ini yang dipakai rekonsiliasi kas shift ini.
          </p>
        </div>
        <div
          v-else-if="
            cancelTarget &&
            isVoidCase(cancelTarget) &&
            cancelTarget.metode !== 'tunai'
          "
          class="rounded-md border bg-muted/50 p-2.5 text-xs text-muted-foreground"
        >
          Pembayaran {{ cancelTarget.metode.toUpperCase() }} tidak lewat kas —
          proses refund-nya di luar sistem ini.
        </div>
        <div v-if="cancelTarget && isVoidCase(cancelTarget)" class="space-y-2">
          <Label for="cancel-pin">PIN Kamu</Label>
          <Input
            id="cancel-pin"
            v-model="cancelPin"
            type="password"
            inputmode="numeric"
            placeholder="4-6 digit"
            maxlength="6"
            autocomplete="off"
          />
          <p class="text-xs text-muted-foreground">
            Void order yang sudah dibayar perlu konfirmasi PIN kamu sendiri — set/ubah PIN di Akun Staff.
          </p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction
            :disabled="
              cancelling ||
              (cancelTarget && isVoidCase(cancelTarget) && !cancelPin)
            "
            @click="onCancelConfirm"
          >
            {{
              cancelTarget && isVoidCase(cancelTarget)
                ? 'Ya, Void Pesanan'
                : 'Ya, Batalkan Pesanan'
            }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <Dialog
      :open="!!buktiOrderId"
      @update:open="(v) => !v && (buktiOrderId = null)"
    >
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bukti Pembayaran</DialogTitle>
          <DialogDescription class="sr-only">
            Foto bukti transfer yang diunggah customer untuk pesanan ini.
          </DialogDescription>
        </DialogHeader>
        <img
          v-if="buktiOrderId"
          :src="buktiBayarUrl(buktiOrderId)"
          alt="Bukti pembayaran"
          class="w-full rounded-lg border object-contain"
        />
      </DialogContent>
    </Dialog>

    <Dialog
      :open="!!receiptOrder"
      @update:open="(v) => !v && (receiptOrder = null)"
    >
      <DialogContent class="print:border-0 print:shadow-none sm:max-w-sm">
        <DialogHeader class="print:hidden">
          <DialogTitle>Struk {{ receiptOrder?.kodeOrder }}</DialogTitle>
          <DialogDescription class="sr-only">
            Pratinjau struk customer, siap dicetak.
          </DialogDescription>
        </DialogHeader>
        <div v-if="receiptOrder" class="space-y-3 font-mono text-xs">
          <div
            class="flex flex-col items-center gap-1.5 border-b border-dashed pb-3 text-center"
          >
            <img :src="logoUrl" alt="Popside" class="size-10 rounded-md" />
            <p class="text-sm font-bold">{{ settings.namaToko || 'POPSIDE' }}</p>
            <p v-if="settings.alamat" class="text-muted-foreground">{{ settings.alamat }}</p>
            <p v-if="settings.telepon" class="text-muted-foreground">{{ settings.telepon }}</p>
            <p class="text-muted-foreground">
              {{ formatDateTime(receiptOrder.createdAt) }}
            </p>
          </div>
          <div class="space-y-0.5 border-b border-dashed pb-3">
            <div class="flex justify-between">
              <span>Kode</span>
              <span class="font-semibold">{{ receiptOrder.kodeOrder }}</span>
            </div>
            <div class="flex justify-between">
              <span>{{ receiptOrder.nomorMeja ? 'Meja' : 'Tipe' }}</span>
              <span>{{
                receiptOrder.nomorMeja ||
                `Bawa Pulang${receiptOrder.customerName ? ` (${receiptOrder.customerName})` : ''}`
              }}</span>
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
              <p
                v-if="item.variants?.length"
                class="pl-3 text-[11px] text-muted-foreground"
              >
                {{ item.variants.map((v) => v.namaOption).join(', ') }}
              </p>
              <p
                v-if="item.catatan"
                class="pl-3 text-[11px] italic text-muted-foreground"
              >
                {{ item.catatan }}
              </p>
            </div>
          </div>
          <div
            v-if="receiptOrder.discountAmount > 0 || receiptOrder.taxAmount > 0 || receiptOrder.serviceChargeAmount > 0"
            class="space-y-0.5 border-b border-dashed pb-3"
          >
            <div class="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span>{{ formatRupiah(receiptSubtotal) }}</span>
            </div>
            <div v-if="receiptOrder.discountAmount > 0" class="flex justify-between">
              <span>Diskon{{ receiptOrder.discountReason ? ` (${receiptOrder.discountReason})` : '' }}</span>
              <span>-{{ formatRupiah(receiptOrder.discountAmount) }}</span>
            </div>
            <div v-if="receiptOrder.taxAmount > 0" class="flex justify-between text-muted-foreground">
              <span>Pajak</span>
              <span>{{ formatRupiah(receiptOrder.taxAmount) }}</span>
            </div>
            <div v-if="receiptOrder.serviceChargeAmount > 0" class="flex justify-between text-muted-foreground">
              <span>Service Charge</span>
              <span>{{ formatRupiah(receiptOrder.serviceChargeAmount) }}</span>
            </div>
          </div>
          <div class="flex justify-between text-sm font-bold">
            <span>TOTAL</span>
            <span>{{ formatRupiah(receiptOrder.totalHarga) }}</span>
          </div>
          <!-- Cash only, and only when the kasir recorded what was handed
          over — this is the line a customer checks their change against. -->
          <div
            v-if="receiptOrder.cashReceived !== null"
            class="space-y-0.5 border-t border-dashed pt-1.5"
          >
            <div class="flex justify-between">
              <span>Tunai</span>
              <span>{{ formatRupiah(receiptOrder.cashReceived) }}</span>
            </div>
            <div class="flex justify-between font-semibold">
              <span>Kembalian</span>
              <span>{{ formatRupiah(receiptOrder.changeAmount) }}</span>
            </div>
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

    <Dialog
      :open="!!kitchenTicketOrder"
      @update:open="(v) => !v && (kitchenTicketOrder = null)"
    >
      <DialogContent class="print:border-0 print:shadow-none sm:max-w-sm">
        <DialogHeader class="print:hidden">
          <DialogTitle>Tiket Dapur {{ kitchenTicketOrder?.kodeOrder }}</DialogTitle>
          <DialogDescription class="sr-only">
            Daftar item pesanan tanpa harga, siap dicetak untuk dapur.
          </DialogDescription>
        </DialogHeader>
        <!-- No prices anywhere on purpose — dapur cuma perlu tahu apa yang
        harus dibuat, bukan berapa harganya. Font jauh lebih besar dari
        struk customer: ini dibaca sambil masak dari jarak, bukan
        dipegang dari dekat. -->
        <div v-if="kitchenTicketOrder" class="space-y-3">
          <div class="border-b border-dashed pb-2 text-center">
            <p class="text-xl font-bold">{{ kitchenTicketOrder.kodeOrder }}</p>
            <p class="text-base font-semibold">
              {{
                kitchenTicketOrder.nomorMeja
                  ? `Meja ${kitchenTicketOrder.nomorMeja}`
                  : `Bawa Pulang${kitchenTicketOrder.customerName ? ` (${kitchenTicketOrder.customerName})` : ''}`
              }}
            </p>
            <p class="text-xs text-muted-foreground">
              {{ formatDateTime(kitchenTicketOrder.createdAt) }}
            </p>
          </div>
          <ul class="space-y-2.5">
            <li
              v-for="(item, idx) in kitchenTicketOrder.items"
              :key="idx"
              class="text-lg font-semibold leading-tight"
            >
              {{ item.qty }}x {{ item.nama }}
              <p
                v-if="item.variants?.length"
                class="text-sm font-normal text-muted-foreground"
              >
                {{ item.variants.map((v) => v.namaOption).join(', ') }}
              </p>
              <p
                v-if="item.catatan"
                class="text-sm font-normal italic text-muted-foreground"
              >
                "{{ item.catatan }}"
              </p>
            </li>
          </ul>
          <p
            v-if="kitchenTicketOrder.catatan"
            class="border-t border-dashed pt-2 text-sm italic text-muted-foreground"
          >
            Catatan: {{ kitchenTicketOrder.catatan }}
          </p>
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
