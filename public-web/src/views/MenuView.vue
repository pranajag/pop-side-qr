<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useTableStore } from '@/stores/table'
import { useMenuStore } from '@/stores/menu'
import { useCartStore } from '@/stores/cart'
import { formatRupiah } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import QtyStepper from '@/components/QtyStepper.vue'
import VariantPickerDialog from '@/components/VariantPickerDialog.vue'
import CallStaffDialog from '@/components/CallStaffDialog.vue'
import { ImageOffIcon, ChevronRightIcon, QrCodeIcon, BellIcon } from '@lucide/vue'
import { API_URL } from '@/lib/api'
import logoUrl from '@/assets/pop-side-logo.jpg'

const table = useTableStore()
const menu = useMenuStore()
const cart = useCartStore()
const router = useRouter()

const pickerOpen = ref(false)
const pickerProduct = ref(null)
const callStaffOpen = ref(false)

function onTambahClick(product) {
  if (product.variantGroups.length > 0) {
    pickerProduct.value = product
    pickerOpen.value = true
  } else {
    cart.setQty(product.id, [], 1)
  }
}

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
    if (!product) return sum
    const extra = product.variantGroups
      .flatMap((g) => g.options)
      .filter((o) => item.variantOptionIds.includes(o.id))
      .reduce((s, o) => s + Number(o.hargaTambahan), 0)
    return sum + (Number(product.harga) + extra) * item.qty
  }, 0)
)
</script>

<template>
  <div v-if="!table.isVerified" class="flex min-h-svh flex-col items-center justify-center gap-6 px-6 text-center">
    <img :src="logoUrl" alt="Popside" class="size-16 rounded-2xl shadow-lg shadow-black/10" />
    <QrCodeIcon class="size-10 text-muted-foreground" />
    <div class="space-y-1">
      <h1 class="text-lg font-semibold">Scan QR di meja kamu</h1>
      <p class="text-sm text-muted-foreground">Menu cuma bisa dibuka lewat QR yang ditempel di meja.</p>
    </div>
  </div>

  <div v-else class="min-h-svh pb-24">
    <header class="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur">
      <img :src="logoUrl" alt="Popside" class="size-10 shrink-0 rounded-lg" />
      <div class="flex items-center gap-2">
        <span class="rounded-full bg-brand-secondary px-3 py-1.5 text-xs font-semibold text-body">
          Meja {{ table.nomorMeja }}
        </span>
        <button
          type="button"
          aria-label="Panggil Staff"
          class="flex size-9 shrink-0 items-center justify-center rounded-full border active:bg-accent"
          @click="callStaffOpen = true"
        >
          <BellIcon class="size-4" />
        </button>
      </div>
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
          <h2 class="mb-3 flex items-center gap-2 text-base font-bold text-body">
            <span class="h-4 w-1.5 shrink-0 rounded-full bg-brand-cta"></span>
            {{ category.nama }}
          </h2>
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
                    v-if="product.variantGroups.length > 0 || cart.qtyFor(product.id, []) === 0"
                    size="sm"
                    variant="outline"
                    class="h-9"
                    @click="onTambahClick(product)"
                  >
                    {{ product.variantGroups.length > 0 ? 'Pilih' : 'Tambah' }}
                  </Button>
                  <QtyStepper
                    v-else
                    :qty="cart.qtyFor(product.id, [])"
                    :max="maxQty(product)"
                    @update:qty="(q) => cart.setQty(product.id, [], q)"
                  />
                </div>
              </div>
            </li>
          </ul>
        </section>
      </div>
    </main>

    <div v-if="!cart.isEmpty" class="fixed inset-x-0 bottom-0 z-10 px-3 pb-3">
      <button
        type="button"
        class="flex w-full items-center gap-3 rounded-2xl bg-brand-cta p-3 pr-4 shadow-lg shadow-black/15 transition-transform active:scale-[0.99]"
        @click="router.push({ name: 'cart' })"
      >
        <span class="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-primary text-sm font-bold text-body">
          {{ cart.totalQty }}
        </span>
        <span class="min-w-0 flex-1 text-left">
          <span class="block text-[11px] font-medium text-brand-secondary">Total Pesanan</span>
          <span class="block truncate text-base font-semibold text-heading">{{ formatRupiah(estimatedTotal) }}</span>
        </span>
        <span class="flex shrink-0 items-center gap-0.5 text-sm font-semibold text-heading">
          Checkout
          <ChevronRightIcon class="size-4" />
        </span>
      </button>
    </div>

    <VariantPickerDialog :open="pickerOpen" :product="pickerProduct" @update:open="pickerOpen = $event" />
    <CallStaffDialog :open="callStaffOpen" @update:open="callStaffOpen = $event" />
  </div>
</template>
