<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { useOrdersStore } from '@/stores/orders'
import { useProductsStore } from '@/stores/products'
import { useCategoriesStore } from '@/stores/categories'
import { formatApiError } from '@/lib/api'
import { formatRupiah } from '@/lib/format'
import { stockStatus } from '@/lib/stock'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import ManualOrderVariantDialog from '@/components/ManualOrderVariantDialog.vue'
import {
  ArrowLeftIcon,
  PlusIcon,
  Trash2Icon,
  LoaderCircleIcon,
  UsersIcon,
  XIcon,
} from '@lucide/vue'

const router = useRouter()
const store = useOrdersStore()
const productsStore = useProductsStore()
const categoriesStore = useCategoriesStore()

const customerName = ref('')
const customerPhone = ref('')
const metode = ref('tunai')
const catatan = ref('')
const submitting = ref(false)

// Staff-entered discount only — never exposed on the public checkout flow,
// which would let a customer set their own price. Only meaningful outside
// split mode: splitting a single discount fairly across several separate
// orders has no one obviously-correct answer, so rather than guess, the
// two features are kept mutually exclusive in this UI.
// Input is a percentage, not a rupiah amount (store owner's explicit
// request — easier to reason about "10% off" than compute the rupiah
// figure by hand) — discountNumber below derives the actual rupiah amount
// from it, which is still what's actually sent to the server (the API's
// discountAmount field never changed shape; only this form's own input
// method did).
const discountPercent = ref('')
const discountReason = ref('')
const discountPercentNumber = computed(() => {
  const raw = discountPercent.value
  if (raw === '' || raw === null || raw === undefined) return 0
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 0
})
const discountNumber = computed(() =>
  Math.round(subtotal.value * (discountPercentNumber.value / 100))
)

// { productId, nama, unitPrice, variantOptionIds, variantLabel, qty, group }
// `group` is only meaningful once splitMode is on — every line starts in
// group 0 either way, so turning split mode off just means "everything is
// group 0 again" without needing to touch the lines themselves.
const lines = ref([])

// Split bill: one table/cart, several people paying their own portion
// separately — each with its own method. Off by default (today's single-
// payer behavior, unchanged); turning it on reveals per-line group
// assignment plus one payment-method picker per group instead of one for
// the whole cart. Submitting fires one createManualOrder per non-empty
// group rather than trying to teach the Order model itself "one order,
// several payments" — same end result (each person's portion becomes its
// own real order, paid its own way), none of the risk of touching the
// Payment/shift-reconciliation model every other feature already relies on.
const splitMode = ref(false)
const splitGroups = ref([
  { label: 'Bagian 1', metode: 'tunai' },
  { label: 'Bagian 2', metode: 'tunai' },
])

function toggleSplitMode() {
  splitMode.value = !splitMode.value
  if (!splitMode.value) {
    for (const line of lines.value) line.group = 0
  } else {
    // Mutually exclusive with discount and loyalty (see their own fields'
    // comments) — turning split mode on clears both rather than silently
    // ignoring whatever was already entered at submit time.
    discountPercent.value = ''
    discountReason.value = ''
    customerPhone.value = ''
  }
}

function addSplitGroup() {
  splitGroups.value.push({ label: `Bagian ${splitGroups.value.length + 1}`, metode: 'tunai' })
}

function removeSplitGroup(idx) {
  if (splitGroups.value.length <= 2) return
  splitGroups.value.splice(idx, 1)
  // Lines pointed at the removed group (or anything after it, since indexes
  // shift down) fall back to group 0 rather than silently pointing at a
  // group that no longer exists.
  for (const line of lines.value) {
    if (line.group >= splitGroups.value.length) line.group = 0
  }
}

const splitSubtotal = computed(() => (groupIdx) =>
  lines.value
    .filter((l) => l.group === groupIdx)
    .reduce((sum, l) => sum + l.unitPrice * l.qty, 0)
)

const pickerOpen = ref(false)
const pickerProduct = ref(null)

// A kasir mid-order who gets pulled away (a customer question, a staff-call
// notification, an accidental back-navigation) shouldn't lose a half-built
// cart — same sessionStorage-draft pattern ReservationsView.vue already
// established. Split-mode's own group assignments are deliberately left
// out: restoring a stale multi-way split alongside a plain cart is more
// likely to confuse than help, and split orders are rare/short-lived
// enough that losing just that part on an interruption is an acceptable
// trade for keeping this simple.
const DRAFT_KEY = 'popside.manualOrderDraft'
let restoringDraft = false

function loadDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
function saveDraft() {
  try {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        customerName: customerName.value,
        customerPhone: customerPhone.value,
        metode: metode.value,
        catatan: catatan.value,
        discountPercent: discountPercent.value,
        discountReason: discountReason.value,
        lines: lines.value,
      })
    )
  } catch {
    // Storage unavailable (private mode, quota, disabled) — draft just
    // won't survive a close; nothing else depends on it persisting.
  }
}
function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    // Nothing to clean up if storage was never reachable in the first place.
  }
}

watch(
  [customerName, customerPhone, metode, catatan, discountPercent, discountReason, lines],
  () => {
    if (restoringDraft) return
    saveDraft()
  },
  { deep: true }
)

onMounted(() => {
  if (productsStore.items.length === 0) productsStore.fetchAll()
  if (categoriesStore.items.length === 0) categoriesStore.fetchAll()

  const draft = loadDraft()
  if (draft && (draft.lines?.length > 0 || draft.customerName || draft.catatan)) {
    restoringDraft = true
    customerName.value = draft.customerName ?? ''
    customerPhone.value = draft.customerPhone ?? ''
    metode.value = draft.metode ?? 'tunai'
    catatan.value = draft.catatan ?? ''
    discountPercent.value = draft.discountPercent ?? ''
    discountReason.value = draft.discountReason ?? ''
    lines.value = draft.lines ?? []
    restoringDraft = false
    toast.info('Draf pesanan yang belum tersimpan dipulihkan')
  }
})

const availableProducts = computed(() =>
  productsStore.items.filter((p) => p.isAvailable)
)
function categoryName(id) {
  return categoriesStore.items.find((c) => c.id === id)?.nama || ''
}

function lineKey(productId, variantOptionIds) {
  return `${productId}:${[...variantOptionIds].sort((a, b) => a - b).join(',')}`
}

function onAddProduct(product) {
  if (stockStatus(product) === 'habis') return
  if (product.variantGroups.length > 0) {
    pickerProduct.value = product
    pickerOpen.value = true
  } else {
    addLine({
      product,
      variantOptionIds: [],
      variantLabel: '',
      qty: 1,
      unitPrice: Number(product.harga),
    })
  }
}

function addLine({ product, variantOptionIds, variantLabel, qty, unitPrice }) {
  const key = lineKey(product.id, variantOptionIds)
  const existing = lines.value.find(
    (l) => lineKey(l.productId, l.variantOptionIds) === key
  )
  if (existing) {
    existing.qty += qty
  } else {
    lines.value.push({
      productId: product.id,
      nama: product.nama,
      unitPrice,
      variantOptionIds,
      variantLabel,
      qty,
      group: 0,
    })
  }
}

function removeLine(idx) {
  lines.value.splice(idx, 1)
}
// 99 matches order.validator.js's orderItemsSchema qty cap — clamping here
// too means a fat-fingered/stuck "+" fails obviously (button stops doing
// anything) instead of building a cart that only errors at final submit.
const MAX_QTY = 99
function incLine(idx, delta) {
  const next = lines.value[idx].qty + delta
  if (next <= 0) removeLine(idx)
  else lines.value[idx].qty = Math.min(next, MAX_QTY)
}

const subtotal = computed(() =>
  lines.value.reduce((sum, l) => sum + l.unitPrice * l.qty, 0)
)
const total = computed(() => Math.max(0, subtotal.value - discountNumber.value))

function itemsFor(groupLines) {
  return groupLines.map((l) => ({
    productId: l.productId,
    qty: l.qty,
    variantOptionIds: l.variantOptionIds,
  }))
}

async function onSubmit() {
  if (lines.value.length === 0) {
    toast.error('Tambahkan produk dulu')
    return
  }

  if (splitMode.value) {
    const nonEmptyGroups = splitGroups.value
      .map((g, idx) => ({ ...g, idx, lines: lines.value.filter((l) => l.group === idx) }))
      .filter((g) => g.lines.length > 0)
    if (nonEmptyGroups.length < 2) {
      toast.error('Isi produk di minimal 2 bagian untuk split, atau matikan mode split')
      return
    }
    submitting.value = true
    try {
      // Sequential, not Promise.all — if one fails partway, the toast below
      // names exactly which orders already went through so nothing has to
      // be guessed from the order list afterward.
      const created = []
      for (const g of nonEmptyGroups) {
        const order = await store.createManual({
          customerName: [customerName.value, g.label].filter(Boolean).join(' - ') || g.label,
          metode: g.metode,
          catatan: catatan.value || undefined,
          items: itemsFor(g.lines),
        })
        created.push(order.kodeOrder)
      }
      toast.success(`${created.length} pesanan dibuat: ${created.join(', ')}`)
      clearDraft()
      router.push({ name: 'pesanan' })
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      submitting.value = false
    }
    return
  }

  if (discountNumber.value > 0 && !discountReason.value.trim()) {
    toast.error('Isi alasan diskon dulu')
    return
  }

  submitting.value = true
  try {
    const order = await store.createManual({
      customerName: customerName.value || undefined,
      customerPhone: customerPhone.value.trim() || undefined,
      metode: metode.value,
      catatan: catatan.value || undefined,
      items: itemsFor(lines.value),
      discountAmount: discountNumber.value || undefined,
      discountReason: discountNumber.value > 0 ? discountReason.value.trim() : undefined,
    })
    toast.success(
      order.pointsEarned > 0
        ? `Pesanan ${order.kodeOrder} dibuat — +${order.pointsEarned} poin`
        : `Pesanan ${order.kodeOrder} dibuat`
    )
    clearDraft()
    router.push({ name: 'pesanan' })
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="max-w-3xl space-y-6">
    <div class="flex items-center gap-3">
      <Button
        variant="ghost"
        size="icon"
        @click="router.push({ name: 'pesanan' })"
      >
        <ArrowLeftIcon class="size-4" />
      </Button>
      <div>
        <h1 class="text-lg font-semibold tracking-tight">Pesanan Manual</h1>
        <p class="text-sm text-muted-foreground">
          Untuk customer bawa pulang / takeaway — tanpa scan QR meja.
        </p>
      </div>
    </div>

    <div class="grid gap-6 sm:grid-cols-2">
      <div class="space-y-2">
        <Label for="customerName">Nama Customer (opsional)</Label>
        <Input
          id="customerName"
          v-model="customerName"
          maxlength="100"
          placeholder="Mis. Budi"
        />
      </div>
      <div v-if="!splitMode" class="space-y-2">
        <Label for="metode">Metode Pembayaran</Label>
        <Select v-model="metode">
          <SelectTrigger id="metode" class="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tunai">Tunai</SelectItem>
            <SelectItem value="qris">QRIS</SelectItem>
            <SelectItem value="debit">Debit</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

    <div v-if="!splitMode" class="space-y-2">
      <Label for="customerPhone"
        >No. HP Member (opsional) <span class="font-normal text-muted-foreground">— untuk poin loyalitas</span></Label
      >
      <Input
        id="customerPhone"
        v-model="customerPhone"
        maxlength="20"
        placeholder="Mis. 08123456789"
      />
      <p v-if="customerPhone.trim()" class="text-xs text-muted-foreground">
        Member baru otomatis terdaftar kalau nomor ini belum ada. +{{ Math.floor(total / 1000) }} poin dari pesanan ini.
      </p>
    </div>

    <div class="space-y-2">
      <Label for="catatan">Catatan (opsional)</Label>
      <Input
        id="catatan"
        v-model="catatan"
        maxlength="200"
        placeholder="Mis. tolong dibungkus terpisah"
      />
    </div>

    <div v-if="!splitMode" class="space-y-3 rounded-lg border p-3">
      <h2 class="text-sm font-medium">Diskon (opsional)</h2>
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="space-y-2">
          <Label for="discountPercent">Diskon (%)</Label>
          <Input
            id="discountPercent"
            v-model="discountPercent"
            type="number"
            min="0"
            max="100"
            step="1"
            placeholder="0"
          />
          <p v-if="discountPercentNumber > 0" class="text-xs text-muted-foreground">
            = {{ formatRupiah(discountNumber) }}
          </p>
        </div>
        <div class="space-y-2">
          <Label for="discountReason">Alasan</Label>
          <Input
            id="discountReason"
            v-model="discountReason"
            maxlength="200"
            :required="discountNumber > 0"
            placeholder="Mis. langganan, komplain, promo"
          />
        </div>
      </div>
    </div>

    <div class="rounded-lg border p-3">
      <button
        type="button"
        class="flex w-full items-center justify-between gap-2 text-left text-sm font-medium"
        @click="toggleSplitMode"
      >
        <span class="flex items-center gap-2">
          <UsersIcon class="size-4 text-muted-foreground" />
          Bagi Pembayaran
        </span>
        <span
          class="flex h-5 w-9 shrink-0 items-center rounded-full border px-0.5 transition-colors"
          :class="splitMode ? 'justify-end border-primary bg-primary' : 'justify-start bg-muted'"
        >
          <span class="size-3.5 rounded-full bg-white"></span>
        </span>
      </button>
      <p class="mt-1 text-xs text-muted-foreground">
        Satu pesanan dipecah jadi beberapa pesanan terpisah, tiap bagian bisa bayar dengan metode sendiri-sendiri.
      </p>

      <div v-if="splitMode" class="mt-3 space-y-2 border-t pt-3">
        <div
          v-for="(g, idx) in splitGroups"
          :key="idx"
          class="flex items-center gap-2"
        >
          <Input v-model="g.label" class="flex-1" maxlength="50" />
          <Select v-model="g.metode">
            <SelectTrigger class="w-28 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tunai">Tunai</SelectItem>
              <SelectItem value="qris">QRIS</SelectItem>
              <SelectItem value="debit">Debit</SelectItem>
            </SelectContent>
          </Select>
          <span class="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {{ formatRupiah(splitSubtotal(idx)) }}
          </span>
          <Button
            variant="ghost"
            size="icon"
            class="size-7 shrink-0"
            :disabled="splitGroups.length <= 2"
            @click="removeSplitGroup(idx)"
          >
            <XIcon class="size-3.5" />
          </Button>
        </div>
        <Button variant="outline" size="sm" class="gap-1.5" @click="addSplitGroup">
          <PlusIcon class="size-3.5" />
          Tambah Bagian
        </Button>
      </div>
    </div>

    <div class="space-y-3">
      <h2 class="text-sm font-semibold text-muted-foreground">Pilih Produk</h2>
      <div
        class="grid max-h-72 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2"
      >
        <button
          v-for="p in availableProducts"
          :key="p.id"
          type="button"
          :disabled="stockStatus(p) === 'habis'"
          class="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
          @click="onAddProduct(p)"
        >
          <span class="min-w-0">
            <span class="block truncate font-medium">{{ p.nama }}</span>
            <span class="block text-xs text-muted-foreground">
              {{ categoryName(p.categoryId) }}
              <span v-if="stockStatus(p) === 'habis'" class="font-semibold text-destructive">· Habis</span>
              <span v-else-if="stockStatus(p) === 'menipis'" class="font-semibold text-amber-600 dark:text-amber-400"
                >· Sisa {{ p.stok }}</span
              >
            </span>
          </span>
          <span
            class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
          >
            {{ formatRupiah(p.harga) }}
            <PlusIcon class="size-3.5" />
          </span>
        </button>
      </div>
    </div>

    <div class="space-y-3">
      <h2 class="text-sm font-semibold text-muted-foreground">Keranjang</h2>
      <p v-if="lines.length === 0" class="text-sm text-muted-foreground">
        Belum ada produk ditambahkan.
      </p>
      <div v-else class="space-y-2 rounded-lg border p-3">
        <div
          v-for="(line, idx) in lines"
          :key="idx"
          class="flex items-center justify-between gap-3 border-b pb-2 last:border-0 last:pb-0"
        >
          <div class="min-w-0">
            <p class="truncate text-sm font-medium">{{ line.nama }}</p>
            <p v-if="line.variantLabel" class="text-xs text-muted-foreground">
              {{ line.variantLabel }}
            </p>
            <p class="text-xs text-muted-foreground">
              {{ formatRupiah(line.unitPrice) }}
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <Select v-if="splitMode" :model-value="String(line.group)" @update:model-value="(v) => (line.group = Number(v))">
              <SelectTrigger class="h-8 w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="(g, gIdx) in splitGroups" :key="gIdx" :value="String(gIdx)">
                  {{ g.label }}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              class="size-7"
              @click="incLine(idx, -1)"
              >-</Button
            >
            <span class="w-4 text-center text-sm tabular-nums">{{
              line.qty
            }}</span>
            <Button
              variant="outline"
              size="icon"
              class="size-7"
              @click="incLine(idx, 1)"
              >+</Button
            >
            <Button
              variant="ghost"
              size="icon"
              class="size-7"
              @click="removeLine(idx)"
            >
              <Trash2Icon class="size-3.5" />
            </Button>
          </div>
        </div>
        <template v-if="!splitMode && discountNumber > 0">
          <div class="flex items-center justify-between pt-1 text-sm text-muted-foreground">
            <span>Subtotal</span>
            <span>{{ formatRupiah(subtotal) }}</span>
          </div>
          <div class="flex items-center justify-between text-sm text-destructive">
            <span>Diskon ({{ discountPercentNumber }}%)</span>
            <span>-{{ formatRupiah(discountNumber) }}</span>
          </div>
        </template>
        <div
          class="flex items-center justify-between pt-1 text-sm font-semibold"
        >
          <span>Total</span>
          <span>{{ formatRupiah(total) }}</span>
        </div>
      </div>
    </div>

    <Button
      size="lg"
      class="h-12 w-full"
      :disabled="submitting || lines.length === 0"
      @click="onSubmit"
    >
      <LoaderCircleIcon v-if="submitting" class="size-4 animate-spin" />
      Buat Pesanan
    </Button>

    <ManualOrderVariantDialog
      :open="pickerOpen"
      :product="pickerProduct"
      @update:open="pickerOpen = $event"
      @confirm="addLine"
    />
  </div>
</template>
