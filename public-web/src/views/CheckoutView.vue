<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { useTableStore } from '@/stores/table'
import { useCartStore } from '@/stores/cart'
import { useMenuStore } from '@/stores/menu'
import { api, formatApiError } from '@/lib/api'
import { formatRupiah } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ArrowLeftIcon, TriangleAlertIcon, LoaderCircleIcon, QrCodeIcon, BanknoteIcon, CreditCardIcon } from '@lucide/vue'

const table = useTableStore()
const cart = useCartStore()
const menu = useMenuStore()
const router = useRouter()

const METHODS = [
  { value: 'qris', label: 'QRIS', description: 'Scan QRIS, bayar lewat e-wallet/m-banking apa pun', icon: QrCodeIcon },
  { value: 'tunai', label: 'Tunai', description: 'Bayar cash ke kasir pakai kode order', icon: BanknoteIcon },
  { value: 'debit', label: 'Debit', description: 'Bayar kartu debit ke kasir pakai kode order', icon: CreditCardIcon },
]

const metode = ref('qris')
const catatan = ref('')
const summary = ref(null)
const loadingSummary = ref(false)
const submitting = ref(false)

onMounted(async () => {
  if (!menu.loaded) await menu.fetchMenu()
  if (cart.isEmpty) {
    router.replace({ name: 'menu' })
    return
  }
  loadingSummary.value = true
  try {
    summary.value = await api.post('/public/cart/total', {
      items: cart.items.map((i) => ({ productId: i.productId, qty: i.qty, variantOptionIds: i.variantOptionIds })),
    })
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    loadingSummary.value = false
  }
})

const hasIssues = computed(() => (summary.value?.issues?.length ?? 0) > 0)

async function onSubmit() {
  submitting.value = true
  try {
    const { order } = await api.post('/public/orders', {
      token: table.token,
      metode: metode.value,
      catatan: catatan.value || undefined,
      items: cart.items.map((i) => ({
        productId: i.productId,
        qty: i.qty,
        variantOptionIds: i.variantOptionIds,
        catatan: i.catatan || undefined,
      })),
    })
    cart.clear()
    router.replace({ name: 'order', params: { kodeOrder: order.kodeOrder } })
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div v-if="!table.isVerified" class="flex min-h-svh items-center justify-center px-6 text-center text-sm text-muted-foreground">
    Scan QR di meja kamu dulu ya.
  </div>

  <div v-else class="min-h-svh pb-28">
    <header class="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-3 py-3 backdrop-blur">
      <button
        type="button"
        class="flex size-11 shrink-0 items-center justify-center rounded-full active:bg-accent"
        aria-label="Kembali ke keranjang"
        @click="router.push({ name: 'cart' })"
      >
        <ArrowLeftIcon class="size-5" />
      </button>
      <h1 class="text-base font-semibold">Checkout</h1>
    </header>

    <main class="space-y-6 px-4 py-4">
      <Alert v-if="hasIssues" variant="destructive">
        <TriangleAlertIcon class="size-4" />
        <AlertTitle>Keranjang perlu diperbarui</AlertTitle>
        <AlertDescription>
          Ada item di keranjang yang bermasalah (stok/ketersediaan). Kembali ke keranjang untuk memperbaikinya.
        </AlertDescription>
      </Alert>

      <section>
        <h2 class="mb-3 text-sm font-semibold text-muted-foreground">Metode Pembayaran</h2>
        <div class="space-y-2">
          <button
            v-for="m in METHODS"
            :key="m.value"
            type="button"
            class="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors"
            :class="metode === m.value ? 'border-primary bg-primary/5' : 'border-input'"
            @click="metode = m.value"
          >
            <component :is="m.icon" class="size-5 shrink-0" :class="metode === m.value ? 'text-primary' : 'text-muted-foreground'" />
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium">{{ m.label }}</span>
              <span class="block text-xs text-muted-foreground">{{ m.description }}</span>
            </span>
            <span
              class="size-5 shrink-0 rounded-full border-2"
              :class="metode === m.value ? 'border-primary bg-primary' : 'border-input'"
            />
          </button>
        </div>
      </section>

      <section>
        <h2 class="mb-2 text-sm font-semibold text-muted-foreground">Catatan untuk Pesanan (opsional)</h2>
        <textarea
          v-model="catatan"
          rows="2"
          maxlength="200"
          placeholder="Misal: tolong dibungkus terpisah"
          class="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </section>

      <section>
        <h2 class="mb-2 text-sm font-semibold text-muted-foreground">Ringkasan</h2>
        <div class="space-y-1 rounded-lg border p-3 text-sm">
          <div v-for="item in summary?.items ?? []" :key="item.productId" class="flex justify-between text-muted-foreground">
            <span>{{ item.qty }}x {{ item.nama }}</span>
            <span>{{ formatRupiah(item.subtotal) }}</span>
          </div>
          <div class="mt-2 flex justify-between border-t pt-2 font-semibold">
            <span>Total</span>
            <span class="flex items-center gap-2">
              <LoaderCircleIcon v-if="loadingSummary" class="size-3.5 animate-spin text-muted-foreground" />
              {{ formatRupiah(summary?.total ?? 0) }}
            </span>
          </div>
        </div>
      </section>
    </main>

    <div class="fixed inset-x-0 bottom-0 border-t bg-background p-3">
      <Button size="lg" class="h-12 w-full" :disabled="submitting || hasIssues || loadingSummary" @click="onSubmit">
        <LoaderCircleIcon v-if="submitting" class="size-4 animate-spin" />
        Pesan Sekarang
      </Button>
    </div>
  </div>
</template>
