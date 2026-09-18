<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { useOrdersStore } from '@/stores/orders'
import { useProductsStore } from '@/stores/products'
import { useCategoriesStore } from '@/stores/categories'
import { formatApiError } from '@/lib/api'
import { formatRupiah } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import ManualOrderVariantDialog from '@/components/ManualOrderVariantDialog.vue'
import { ArrowLeftIcon, PlusIcon, Trash2Icon, LoaderCircleIcon } from '@lucide/vue'

const router = useRouter()
const store = useOrdersStore()
const productsStore = useProductsStore()
const categoriesStore = useCategoriesStore()

const customerName = ref('')
const metode = ref('tunai')
const catatan = ref('')
const submitting = ref(false)

// { productId, nama, unitPrice, variantOptionIds, variantLabel, qty }
const lines = ref([])

const pickerOpen = ref(false)
const pickerProduct = ref(null)

onMounted(() => {
  if (productsStore.items.length === 0) productsStore.fetchAll()
  if (categoriesStore.items.length === 0) categoriesStore.fetchAll()
})

const availableProducts = computed(() => productsStore.items.filter((p) => p.isAvailable))
function categoryName(id) {
  return categoriesStore.items.find((c) => c.id === id)?.nama || ''
}

function lineKey(productId, variantOptionIds) {
  return `${productId}:${[...variantOptionIds].sort((a, b) => a - b).join(',')}`
}

function onAddProduct(product) {
  if (product.variantGroups.length > 0) {
    pickerProduct.value = product
    pickerOpen.value = true
  } else {
    addLine({ product, variantOptionIds: [], variantLabel: '', qty: 1, unitPrice: Number(product.harga) })
  }
}

function addLine({ product, variantOptionIds, variantLabel, qty, unitPrice }) {
  const key = lineKey(product.id, variantOptionIds)
  const existing = lines.value.find((l) => lineKey(l.productId, l.variantOptionIds) === key)
  if (existing) {
    existing.qty += qty
  } else {
    lines.value.push({ productId: product.id, nama: product.nama, unitPrice, variantOptionIds, variantLabel, qty })
  }
}

function removeLine(idx) {
  lines.value.splice(idx, 1)
}
function incLine(idx, delta) {
  const next = lines.value[idx].qty + delta
  if (next <= 0) removeLine(idx)
  else lines.value[idx].qty = next
}

const total = computed(() => lines.value.reduce((sum, l) => sum + l.unitPrice * l.qty, 0))

async function onSubmit() {
  if (lines.value.length === 0) {
    toast.error('Tambahkan produk dulu')
    return
  }
  submitting.value = true
  try {
    const order = await store.createManual({
      customerName: customerName.value || undefined,
      metode: metode.value,
      catatan: catatan.value || undefined,
      items: lines.value.map((l) => ({ productId: l.productId, qty: l.qty, variantOptionIds: l.variantOptionIds })),
    })
    toast.success(`Pesanan ${order.kodeOrder} dibuat`)
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
      <Button variant="ghost" size="icon" @click="router.push({ name: 'pesanan' })">
        <ArrowLeftIcon class="size-4" />
      </Button>
      <div>
        <h1 class="text-lg font-semibold tracking-tight">Pesanan Manual</h1>
        <p class="text-sm text-muted-foreground">Untuk customer bawa pulang / takeaway — tanpa scan QR meja.</p>
      </div>
    </div>

    <div class="grid gap-6 sm:grid-cols-2">
      <div class="space-y-2">
        <Label for="customerName">Nama Customer (opsional)</Label>
        <Input id="customerName" v-model="customerName" maxlength="100" placeholder="Mis. Budi" />
      </div>
      <div class="space-y-2">
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

    <div class="space-y-2">
      <Label for="catatan">Catatan (opsional)</Label>
      <Input id="catatan" v-model="catatan" maxlength="200" placeholder="Mis. tolong dibungkus terpisah" />
    </div>

    <div class="space-y-3">
      <h2 class="text-sm font-semibold text-muted-foreground">Pilih Produk</h2>
      <div class="grid max-h-72 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">
        <button
          v-for="p in availableProducts"
          :key="p.id"
          type="button"
          class="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
          @click="onAddProduct(p)"
        >
          <span class="min-w-0">
            <span class="block truncate font-medium">{{ p.nama }}</span>
            <span class="block text-xs text-muted-foreground">{{ categoryName(p.categoryId) }}</span>
          </span>
          <span class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            {{ formatRupiah(p.harga) }}
            <PlusIcon class="size-3.5" />
          </span>
        </button>
      </div>
    </div>

    <div class="space-y-3">
      <h2 class="text-sm font-semibold text-muted-foreground">Keranjang</h2>
      <p v-if="lines.length === 0" class="text-sm text-muted-foreground">Belum ada produk ditambahkan.</p>
      <div v-else class="space-y-2 rounded-lg border p-3">
        <div v-for="(line, idx) in lines" :key="idx" class="flex items-center justify-between gap-3 border-b pb-2 last:border-0 last:pb-0">
          <div class="min-w-0">
            <p class="truncate text-sm font-medium">{{ line.nama }}</p>
            <p v-if="line.variantLabel" class="text-xs text-muted-foreground">{{ line.variantLabel }}</p>
            <p class="text-xs text-muted-foreground">{{ formatRupiah(line.unitPrice) }}</p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="icon" class="size-7" @click="incLine(idx, -1)">-</Button>
            <span class="w-4 text-center text-sm tabular-nums">{{ line.qty }}</span>
            <Button variant="outline" size="icon" class="size-7" @click="incLine(idx, 1)">+</Button>
            <Button variant="ghost" size="icon" class="size-7" @click="removeLine(idx)">
              <Trash2Icon class="size-3.5" />
            </Button>
          </div>
        </div>
        <div class="flex items-center justify-between pt-1 text-sm font-semibold">
          <span>Total</span>
          <span>{{ formatRupiah(total) }}</span>
        </div>
      </div>
    </div>

    <Button size="lg" class="h-12 w-full" :disabled="submitting || lines.length === 0" @click="onSubmit">
      <LoaderCircleIcon v-if="submitting" class="size-4 animate-spin" />
      Buat Pesanan
    </Button>

    <ManualOrderVariantDialog :open="pickerOpen" :product="pickerProduct" @update:open="pickerOpen = $event" @confirm="addLine" />
  </div>
</template>
