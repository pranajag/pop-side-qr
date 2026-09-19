<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useTableStore } from '@/stores/table'
import { useMenuStore } from '@/stores/menu'
import { useCartStore } from '@/stores/cart'
import { useRecentOrdersStore } from '@/stores/recentOrders'
import { useLocaleStore } from '@/stores/locale'
import { formatRupiah } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import QtyStepper from '@/components/QtyStepper.vue'
import VariantPickerDialog from '@/components/VariantPickerDialog.vue'
import CallStaffDialog from '@/components/CallStaffDialog.vue'
import RecentOrdersDialog from '@/components/RecentOrdersDialog.vue'
import { ImageOffIcon, ChevronRightIcon, QrCodeIcon, BellIcon, SearchIcon, ReceiptIcon } from '@lucide/vue'
import { API_URL } from '@/lib/api'
import logoUrl from '@/assets/pop-side-logo.jpg'

const table = useTableStore()
const menu = useMenuStore()
const cart = useCartStore()
const recentOrders = useRecentOrdersStore()
const locale = useLocaleStore()
const router = useRouter()

const pickerOpen = ref(false)
const pickerProduct = ref(null)
const callStaffOpen = ref(false)
const recentOrdersOpen = ref(false)

// null = "Semua" (no filter). Display-only — menu.categories itself stays
// untouched so cart/findProduct lookups elsewhere never see a filtered view.
const activeCategoryId = ref(null)
const searchQuery = ref('')
const visibleCategories = computed(() => {
  const byCategory =
    activeCategoryId.value === null ? menu.categories : menu.categories.filter((c) => c.id === activeCategoryId.value)
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return byCategory
  return byCategory
    .map((c) => ({ ...c, products: c.products.filter((p) => p.nama.toLowerCase().includes(q)) }))
    .filter((c) => c.products.length > 0)
})

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
      <h1 class="text-lg font-semibold">{{ locale.t('scanQrTitle') }}</h1>
      <p class="text-sm text-muted-foreground">{{ locale.t('scanQrDesc') }}</p>
    </div>
  </div>

  <div v-else class="min-h-svh pb-24">
    <header class="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur">
      <img :src="logoUrl" alt="Popside" class="size-10 shrink-0 rounded-lg" />
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="flex h-9 shrink-0 items-center justify-center rounded-full border px-2.5 text-xs font-semibold active:bg-accent"
          @click="locale.toggle()"
        >
          {{ locale.locale === 'id' ? 'EN' : 'ID' }}
        </button>
        <span class="rounded-full bg-brand-secondary px-3 py-1.5 text-xs font-semibold text-body">
          {{ locale.t('meja') }} {{ table.nomorMeja }}
        </span>
        <button
          v-if="recentOrders.items.length > 0"
          type="button"
          :aria-label="locale.t('pesananSayaLabel')"
          class="flex size-9 shrink-0 items-center justify-center rounded-full border active:bg-accent"
          @click="recentOrdersOpen = true"
        >
          <ReceiptIcon class="size-4" />
        </button>
        <button
          type="button"
          :aria-label="locale.t('panggilStaffLabel')"
          class="flex size-9 shrink-0 items-center justify-center rounded-full border active:bg-accent"
          @click="callStaffOpen = true"
        >
          <BellIcon class="size-4" />
        </button>
      </div>
    </header>

    <div
      v-if="menu.categories.length > 1"
      class="sticky top-[65px] z-10 flex gap-2 overflow-x-auto border-b bg-background/95 px-4 py-2.5 backdrop-blur"
    >
      <button
        type="button"
        class="shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors"
        :class="
          activeCategoryId === null
            ? 'bg-brand-cta text-heading'
            : 'border border-border text-muted-foreground hover:text-body'
        "
        @click="activeCategoryId = null"
      >
        {{ locale.t('semua') }}
      </button>
      <button
        v-for="category in menu.categories"
        :key="category.id"
        type="button"
        class="shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors"
        :class="
          activeCategoryId === category.id
            ? 'bg-brand-cta text-heading'
            : 'border border-border text-muted-foreground hover:text-body'
        "
        @click="activeCategoryId = category.id"
      >
        {{ category.nama }}
      </button>
    </div>

    <main class="px-4 py-4">
      <div v-if="!menu.loading && menu.categories.length > 0" class="relative mb-4">
        <SearchIcon class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="locale.t('cariMenu')"
          class="h-10 w-full rounded-full border border-input bg-transparent pl-9 pr-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

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
        {{ locale.t('menuBelumTersedia') }}
      </p>

      <p v-else-if="visibleCategories.length === 0" class="py-10 text-center text-sm text-muted-foreground">
        {{ locale.t('tidakAdaMenuCocok', { q: searchQuery }) }}
      </p>

      <div v-else class="space-y-6">
        <section v-for="category in visibleCategories" :key="category.id">
          <h2 class="mb-3 flex items-center gap-2 text-base font-bold text-body">
            <span class="h-4 w-1.5 shrink-0 rounded-full bg-brand-cta"></span>
            {{ category.nama }}
          </h2>
          <p v-if="category.products.length === 0" class="text-sm text-muted-foreground">{{ locale.t('belumAdaProduk') }}</p>
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
                <Badge v-if="isSoldOut(product)" variant="secondary" class="mt-1">{{ locale.t('habis') }}</Badge>
                <div v-else class="mt-2">
                  <Button
                    v-if="product.variantGroups.length > 0 || cart.qtyFor(product.id, []) === 0"
                    size="sm"
                    variant="outline"
                    class="h-9"
                    @click="onTambahClick(product)"
                  >
                    {{ product.variantGroups.length > 0 ? locale.t('pilih') : locale.t('tambah') }}
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
          <span class="block text-[11px] font-medium text-brand-secondary">{{ locale.t('totalPesanan') }}</span>
          <span class="block truncate text-base font-semibold text-heading">{{ formatRupiah(estimatedTotal) }}</span>
        </span>
        <span class="flex shrink-0 items-center gap-0.5 text-sm font-semibold text-heading">
          {{ locale.t('checkout') }}
          <ChevronRightIcon class="size-4" />
        </span>
      </button>
    </div>

    <VariantPickerDialog :open="pickerOpen" :product="pickerProduct" @update:open="pickerOpen = $event" />
    <CallStaffDialog :open="callStaffOpen" @update:open="callStaffOpen = $event" />
    <RecentOrdersDialog :open="recentOrdersOpen" @update:open="recentOrdersOpen = $event" />
  </div>
</template>
