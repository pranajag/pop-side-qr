<script setup>
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { useTableStore } from '@/stores/table'
import { useCartStore } from '@/stores/cart'
import { useMenuStore } from '@/stores/menu'
import { api, formatApiError, API_URL } from '@/lib/api'
import { formatRupiah } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import QtyStepper from '@/components/QtyStepper.vue'
import { ArrowLeftIcon, ImageOffIcon, TriangleAlertIcon, LoaderCircleIcon } from '@lucide/vue'

const table = useTableStore()
const cart = useCartStore()
const menu = useMenuStore()
const router = useRouter()

const summary = ref(null) // last server response: { items, total, issues }
const loading = ref(false)

let debounceTimer = null
function refreshTotal() {
  clearTimeout(debounceTimer)
  if (cart.isEmpty) {
    summary.value = { items: [], total: 0, issues: [] }
    return
  }
  debounceTimer = setTimeout(async () => {
    loading.value = true
    try {
      summary.value = await api.post('/public/cart/total', {
        items: cart.items.map((i) => ({ productId: i.productId, qty: i.qty })),
      })
    } catch (err) {
      toast.error(formatApiError(err))
    } finally {
      loading.value = false
    }
  }, 250)
}

onMounted(() => {
  if (!menu.loaded) menu.fetchMenu()
  refreshTotal()
})
watch(() => cart.items, refreshTotal, { deep: true })

function photoUrl(filename) {
  return filename ? `${API_URL}/public/products/photo/${filename}` : null
}

function onCheckout() {
  router.push({ name: 'checkout' })
}
</script>

<template>
  <div v-if="!table.isVerified" class="flex min-h-svh items-center justify-center px-6 text-center text-sm text-muted-foreground">
    Scan QR di meja kamu dulu ya.
  </div>

  <div v-else class="min-h-svh pb-32">
    <header class="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-3 py-3 backdrop-blur">
      <button
        type="button"
        class="flex size-11 shrink-0 items-center justify-center rounded-full active:bg-accent"
        aria-label="Kembali ke menu"
        @click="router.push({ name: 'menu' })"
      >
        <ArrowLeftIcon class="size-5" />
      </button>
      <h1 class="text-base font-semibold">Keranjang</h1>
    </header>

    <main class="px-4 py-4">
      <p v-if="cart.isEmpty" class="py-10 text-center text-sm text-muted-foreground">Keranjang kamu masih kosong.</p>

      <ul v-else class="space-y-4">
        <li v-for="item in cart.items" :key="item.productId" class="flex gap-3 border-b pb-4 last:border-0">
          <img
            v-if="photoUrl(menu.findProduct(item.productId)?.foto)"
            :src="photoUrl(menu.findProduct(item.productId)?.foto)"
            :alt="menu.findProduct(item.productId)?.nama"
            class="size-16 shrink-0 rounded-lg border object-cover"
          />
          <div v-else class="flex size-16 shrink-0 items-center justify-center rounded-lg border bg-muted">
            <ImageOffIcon class="size-5 text-muted-foreground" />
          </div>

          <div class="min-w-0 flex-1 space-y-2">
            <div>
              <p class="truncate text-sm font-medium">{{ menu.findProduct(item.productId)?.nama ?? 'Produk' }}</p>
              <p class="text-sm text-muted-foreground">
                {{ menu.findProduct(item.productId) ? formatRupiah(menu.findProduct(item.productId).harga) : '' }}
              </p>
            </div>
            <Input
              :model-value="item.catatan"
              placeholder="Catatan (opsional), misal: less ice"
              class="h-9"
              @update:model-value="(v) => cart.setNote(item.productId, v)"
            />
            <QtyStepper :qty="item.qty" @update:qty="(q) => cart.setQty(item.productId, q)" />
          </div>
        </li>
      </ul>

      <Alert v-for="issue in summary?.issues ?? []" :key="issue.productId" variant="destructive" class="mt-4">
        <TriangleAlertIcon class="size-4" />
        <AlertTitle>Perlu diperbarui</AlertTitle>
        <AlertDescription>{{ issue.message }}</AlertDescription>
      </Alert>
    </main>

    <div v-if="!cart.isEmpty" class="fixed inset-x-0 bottom-0 space-y-3 border-t bg-background p-3">
      <div class="flex items-center justify-between px-1 text-sm">
        <span class="text-muted-foreground">Total</span>
        <span class="flex items-center gap-2 font-semibold">
          <LoaderCircleIcon v-if="loading" class="size-3.5 animate-spin text-muted-foreground" />
          {{ formatRupiah(summary?.total ?? 0) }}
        </span>
      </div>
      <Button size="lg" class="h-12 w-full" :disabled="(summary?.issues?.length ?? 0) > 0" @click="onCheckout">
        Lanjut ke Pembayaran
      </Button>
    </div>
  </div>
</template>
