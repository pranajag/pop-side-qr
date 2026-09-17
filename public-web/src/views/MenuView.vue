<script setup>
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useTableStore } from '@/stores/table'
import { useMenuStore } from '@/stores/menu'
import { useCartStore } from '@/stores/cart'
import { formatRupiah } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import QtyStepper from '@/components/QtyStepper.vue'
import { ImageOffIcon, ShoppingCartIcon, QrCodeIcon } from '@lucide/vue'
import { API_URL } from '@/lib/api'

const table = useTableStore()
const menu = useMenuStore()
const cart = useCartStore()
const router = useRouter()

onMounted(() => {
  if (table.isVerified && !menu.loaded) {
    menu.fetchMenu()
  }
})

function photoUrl(filename) {
  return `${API_URL}/public/products/photo/${filename}`
}

function isSoldOut(product) {
  return product.trackStock && product.stok <= 0
}

function maxQty(product) {
  return product.trackStock ? product.stok : null
}

// Estimated total shown in the sticky bar — from menu prices already
// fetched from the server, purely for display. The authoritative total is
// always recomputed server-side on the cart page (/api/public/cart/total).
const estimatedTotal = computed(() =>
  cart.items.reduce((sum, item) => {
    const product = menu.findProduct(item.productId)
    return sum + (product ? Number(product.harga) * item.qty : 0)
  }, 0)
)
</script>

<template>
  <div v-if="!table.isVerified" class="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center">
    <QrCodeIcon class="size-10 text-muted-foreground" />
    <div class="space-y-1">
      <h1 class="text-lg font-semibold">Scan QR di meja kamu</h1>
      <p class="text-sm text-muted-foreground">Menu cuma bisa dibuka lewat QR yang ditempel di meja.</p>
    </div>
  </div>

  <div v-else class="min-h-svh pb-24">
    <header class="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur">
      <p class="text-xs text-muted-foreground">Meja</p>
      <h1 class="text-base font-semibold">{{ table.nomorMeja }}</h1>
    </header>

    <main class="px-4 py-4">
      <div v-if="menu.loading" class="space-y-6">
        <div v-for="n in 2" :key="n" class="space-y-3">
          <Skeleton class="h-5 w-32" />
          <div v-for="i in 2" :key="i" class="flex gap-3">
            <Skeleton class="size-16 shrink-0 rounded-lg" />
            <div class="flex-1 space-y-2 py-1">
              <Skeleton class="h-4 w-3/4" />
              <Skeleton class="h-4 w-1/3" />
            </div>
          </div>
        </div>
      </div>

      <p v-else-if="menu.categories.length === 0" class="py-10 text-center text-sm text-muted-foreground">
        Menu belum tersedia.
      </p>

      <div v-else class="space-y-6">
        <section v-for="category in menu.categories" :key="category.id">
          <h2 class="mb-3 text-sm font-semibold text-muted-foreground">{{ category.nama }}</h2>
          <p v-if="category.products.length === 0" class="text-sm text-muted-foreground">Belum ada produk.</p>
          <ul class="space-y-4">
            <li v-for="product in category.products" :key="product.id" class="flex gap-3">
              <img
                v-if="product.foto"
                :src="photoUrl(product.foto)"
                :alt="product.nama"
                loading="lazy"
                class="size-16 shrink-0 rounded-lg border object-cover"
              />
              <div v-else class="flex size-16 shrink-0 items-center justify-center rounded-lg border bg-muted">
                <ImageOffIcon class="size-5 text-muted-foreground" />
              </div>

              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{{ product.nama }}</p>
                <p class="text-sm text-muted-foreground">{{ formatRupiah(product.harga) }}</p>
                <Badge v-if="isSoldOut(product)" variant="secondary" class="mt-1">Habis</Badge>
                <div v-else class="mt-2">
                  <Button
                    v-if="cart.qtyFor(product.id) === 0"
                    size="sm"
                    variant="outline"
                    class="h-9"
                    @click="cart.setQty(product.id, 1)"
                  >
                    Tambah
                  </Button>
                  <QtyStepper
                    v-else
                    :qty="cart.qtyFor(product.id)"
                    :max="maxQty(product)"
                    @update:qty="(q) => cart.setQty(product.id, q)"
                  />
                </div>
              </div>
            </li>
          </ul>
        </section>
      </div>
    </main>

    <div v-if="!cart.isEmpty" class="fixed inset-x-0 bottom-0 border-t bg-background p-3">
      <Button size="lg" class="h-12 w-full justify-between px-4" @click="router.push({ name: 'cart' })">
        <span class="flex items-center gap-2">
          <ShoppingCartIcon class="size-4" />
          {{ cart.totalQty }} item
        </span>
        <span>{{ formatRupiah(estimatedTotal) }}</span>
      </Button>
    </div>
  </div>
</template>
