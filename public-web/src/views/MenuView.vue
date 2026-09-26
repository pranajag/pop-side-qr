<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { useRouter } from 'vue-router'
import { useTableStore } from '@/stores/table'
import { useMenuStore } from '@/stores/menu'
import { useCartStore } from '@/stores/cart'
import { useRecentOrdersStore } from '@/stores/recentOrders'
import { useLocaleStore } from '@/stores/locale'
import { useThemeStore } from '@/stores/theme'
import { useCafeStatusStore } from '@/stores/cafeStatus'
import { formatRupiah } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import QtyStepper from '@/components/QtyStepper.vue'
import ReservasiNotice from '@/components/ReservasiNotice.vue'
import { teksReservasi } from '@/lib/reservasi'
import VariantPickerDialog from '@/components/VariantPickerDialog.vue'
import CallStaffDialog from '@/components/CallStaffDialog.vue'
import RecentOrdersDialog from '@/components/RecentOrdersDialog.vue'
import BillDialog from '@/components/BillDialog.vue'
import {
  ImageOffIcon,
  ChevronRightIcon,
  QrCodeIcon,
  BellIcon,
  SearchIcon,
  ReceiptIcon,
  ReceiptTextIcon,
  SunIcon,
  MoonIcon,
} from '@lucide/vue'
import { API_URL } from '@/lib/api'
import logoUrl from '@/assets/pop-side-logo.jpg'

const table = useTableStore()
const menu = useMenuStore()
const cart = useCartStore()
const recentOrders = useRecentOrdersStore()
const locale = useLocaleStore()
const theme = useThemeStore()
const cafeStatus = useCafeStatusStore()
const router = useRouter()

const pickerOpen = ref(false)
const pickerProduct = ref(null)
const callStaffOpen = ref(false)
const recentOrdersOpen = ref(false)
const billOpen = ref(false)

// null = "Semua" (no filter). Display-only — menu.categories itself stays
// untouched so cart/findProduct lookups elsewhere never see a filtered view.
const activeCategoryId = ref(null)
const searchQuery = ref('')
const visibleCategories = computed(() => {
  const byCategory =
    activeCategoryId.value === null
      ? menu.categories
      : menu.categories.filter((c) => c.id === activeCategoryId.value)
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return byCategory
  return byCategory
    .map((c) => ({
      ...c,
      products: c.products.filter((p) => p.nama.toLowerCase().includes(q)),
    }))
    .filter((c) => c.products.length > 0)
})

// Saat tutup, menu cuma bisa dilihat: tidak ada yang bisa masuk keranjang.
// Tombolnya sudah dimatikan di template; ini penjaga kalau event tetap
// sampai (mis. status berubah tepat saat tombol ditekan).
const tutup = computed(() => cafeStatus.tutup)

function onTambahClick(product) {
  if (tutup.value) return
  if (product.variantGroups.length > 0) {
    pickerProduct.value = product
    pickerOpen.value = true
  } else {
    cart.setQty(product.id, [], 1)
  }
}

// Notif sekali per reservasi (dan sekali lagi saat berubah dari "sebentar
// lagi" ke "sedang berlangsung") — bannernya tetap ada selama berlaku,
// toast cuma supaya tidak terlewat saat pertama kali muncul.
watch(
  () => table.reservasi,
  (r) => {
    if (!r) return
    const kunci = `${r.waktu}|${r.sudahMulai}`
    if (table.reservasiDiberitahu === kunci) return
    table.reservasiDiberitahu = kunci
    const teks = teksReservasi(locale, table.nomorMeja, r)
    toast.warning(teks.judul, { description: teks.isi, duration: 8000 })
  },
  { immediate: true }
)

onMounted(() => {
  // Setelah scan QR info reservasinya masih segar; setelah reload halaman
  // belum pernah dicek — perbaruiReservasi sendiri yang memutuskan.
  table.perbaruiReservasi()
  if (table.isVerified && !menu.loaded) {
    menu.fetchMenu()
  }
  cafeStatus.fetch()
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
  <div
    v-if="!table.isVerified"
    class="flex min-h-svh flex-col items-center justify-center gap-6 px-6 text-center"
  >
    <img
      :src="logoUrl"
      alt="Popside"
      class="size-16 rounded-2xl shadow-lg shadow-black/10"
    />
    <QrCodeIcon class="size-10 text-muted-foreground" />
    <div class="space-y-1">
      <h1 class="text-lg font-semibold">{{ locale.t('scanQrTitle') }}</h1>
      <p class="text-sm text-muted-foreground">{{ locale.t('scanQrDesc') }}</p>
    </div>
  </div>

  <div v-else class="mx-auto min-h-svh max-w-md pb-28 sm:max-w-2xl lg:max-w-5xl">
    <header
      class="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur"
    >
      <img :src="logoUrl" alt="Popside" class="size-10 shrink-0 rounded-lg" />
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          class="flex h-10 shrink-0 items-center justify-center rounded-full border px-2.5 text-xs font-semibold transition-colors hover:border-primary/50 hover:bg-accent active:bg-accent"
          @click="locale.toggle()"
        >
          {{ locale.locale === 'id' ? 'EN' : 'ID' }}
        </button>
        <button
          type="button"
          :aria-label="locale.t(theme.isDark ? 'temaTerang' : 'temaGelap')"
          class="flex size-10 shrink-0 items-center justify-center rounded-full border transition-colors hover:border-primary/50 hover:bg-accent active:bg-accent"
          @click="theme.toggle()"
        >
          <SunIcon v-if="theme.isDark" class="size-4" />
          <MoonIcon v-else class="size-4" />
        </button>
        <span
          class="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
        >
          {{ locale.t('meja') }} {{ table.nomorMeja }}
        </span>
        <button
          v-if="recentOrders.items.length > 0"
          type="button"
          :aria-label="locale.t('pesananSayaLabel')"
          class="flex size-10 shrink-0 items-center justify-center rounded-full border transition-colors hover:border-primary/50 hover:bg-accent active:bg-accent"
          @click="recentOrdersOpen = true"
        >
          <ReceiptIcon class="size-4" />
        </button>
        <button
          type="button"
          :aria-label="locale.t('panggilStaffLabel')"
          class="flex size-10 shrink-0 items-center justify-center rounded-full border transition-colors hover:border-primary/50 hover:bg-accent active:bg-accent"
          @click="callStaffOpen = true"
        >
          <BellIcon class="size-4" />
        </button>
        <button
          type="button"
          :aria-label="locale.t('billLabel')"
          class="flex size-10 shrink-0 items-center justify-center rounded-full border transition-colors hover:border-primary/50 hover:bg-accent active:bg-accent"
          @click="billOpen = true"
        >
          <ReceiptTextIcon class="size-4" />
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
            ? 'bg-primary text-primary-foreground'
            : 'bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
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
            ? 'bg-primary text-primary-foreground'
            : 'bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
        "
        @click="activeCategoryId = category.id"
      >
        {{ category.nama }}
      </button>
    </div>

    <main class="px-4 py-4">
      <ReservasiNotice class="mb-4" />

      <div
        v-if="tutup"
        class="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 p-3.5"
      >
        <p class="text-sm font-semibold text-destructive">
          {{ locale.t('kafeTutup') }}
        </p>
        <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
          {{ locale.t('kafeTutupDesc') }}
        </p>
      </div>

      <div
        v-if="!menu.loading && menu.categories.length > 0"
        class="relative mb-4"
      >
        <SearchIcon
          class="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="locale.t('cariMenu')"
          class="h-12 w-full rounded-full border border-transparent bg-card pl-10 pr-4 text-sm shadow-[0_1px_2px_rgba(13,15,20,0.04)] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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

      <p
        v-else-if="menu.categories.length === 0"
        class="py-10 text-center text-sm text-muted-foreground"
      >
        {{ locale.t('menuBelumTersedia') }}
      </p>

      <p
        v-else-if="visibleCategories.length === 0"
        class="py-10 text-center text-sm text-muted-foreground"
      >
        {{ locale.t('tidakAdaMenuCocok', { q: searchQuery }) }}
      </p>

      <div v-else class="space-y-5">
        <section
          v-for="category in visibleCategories"
          :key="category.id"
          class="rounded-2xl bg-card p-4 shadow-[0_1px_2px_rgba(13,15,20,0.04)]"
        >
          <h2
            class="mb-3 flex items-center gap-2 text-base font-bold text-foreground"
          >
            <span class="h-4 w-1.5 shrink-0 rounded-full bg-primary"></span>
            {{ category.nama }}
          </h2>
          <p
            v-if="category.products.length === 0"
            class="text-sm text-muted-foreground"
          >
            {{ locale.t('belumAdaProduk') }}
          </p>
          <!-- One column on a phone (a divided list reads fastest with a
          thumb), two or three once there is room — on a laptop a single
          narrow column would leave most of the screen empty. The divider
          only makes sense in list mode, so it is dropped in grid mode. -->
          <ul
            class="divide-y divide-border sm:grid sm:grid-cols-2 sm:gap-3 sm:divide-y-0 lg:grid-cols-3"
          >
            <li
              v-for="product in category.products"
              :key="product.id"
              class="-mx-2 flex gap-3 rounded-2xl px-2 py-3.5 transition-colors first:pt-2 last:pb-2 hover:bg-accent/40 active:bg-accent/60 sm:mx-0 sm:border sm:p-3 sm:py-3 sm:first:pt-3 sm:last:pb-3 sm:hover:border-primary/40"
            >
              <img
                v-if="product.foto"
                :src="photoUrl(product.foto)"
                :alt="product.nama"
                loading="lazy"
                class="size-20 shrink-0 rounded-2xl object-cover"
              />
              <div
                v-else
                class="flex size-20 shrink-0 items-center justify-center rounded-2xl bg-muted"
              >
                <ImageOffIcon class="size-5 text-muted-foreground" />
              </div>

              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{{ product.nama }}</p>
                <p class="text-sm text-muted-foreground">
                  {{ formatRupiah(product.harga) }}
                </p>
                <Badge
                  v-if="isSoldOut(product)"
                  variant="secondary"
                  class="mt-1"
                  >{{ locale.t('habis') }}</Badge
                >
                <div v-else class="mt-2">
                  <Button
                    v-if="
                      product.variantGroups.length > 0 ||
                      cart.qtyFor(product.id, []) === 0
                    "
                    size="sm"
                    variant="outline"
                    class="h-9 active:border-primary/50 active:bg-accent"
                    :disabled="tutup"
                    @click="onTambahClick(product)"
                  >
                    {{
                      product.variantGroups.length > 0
                        ? locale.t('pilih')
                        : locale.t('tambah')
                    }}
                  </Button>
                  <QtyStepper
                    v-else
                    :qty="cart.qtyFor(product.id, [])"
                    :max="tutup ? cart.qtyFor(product.id, []) : maxQty(product)"
                    @update:qty="(q) => cart.setQty(product.id, [], q)"
                  />
                </div>
              </div>
            </li>
          </ul>
        </section>
      </div>
    </main>

    <div
      v-if="!cart.isEmpty"
      class="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-md px-3 pb-3 sm:max-w-2xl lg:max-w-5xl"
    >
      <button
        type="button"
        :disabled="tutup"
        class="flex w-full items-center gap-3 rounded-2xl bg-primary p-3 pr-4 shadow-lg shadow-black/15 transition-all hover:brightness-95 active:scale-[0.99] disabled:cursor-not-allowed disabled:shadow-none disabled:saturate-[0.3] disabled:hover:brightness-100 disabled:active:scale-100"
        @click="router.push({ name: 'cart' })"
      >
        <span
          class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-foreground/10 text-sm font-bold text-primary-foreground"
        >
          {{ cart.totalQty }}
        </span>
        <span class="min-w-0 flex-1 text-left">
          <span class="block text-[11px] font-medium text-primary-foreground/70">{{
            locale.t('totalPesanan')
          }}</span>
          <span class="block truncate text-base font-semibold text-primary-foreground">{{
            formatRupiah(estimatedTotal)
          }}</span>
        </span>
        <!-- Allowed to wrap rather than shrink-0: the closed-cafe label is
        long enough to squeeze the total next to it down to "Rp 40.0…",
        and the one number the customer came here to read must survive. -->
        <span
          class="flex max-w-[45%] items-center gap-0.5 text-right text-sm font-semibold leading-tight text-primary-foreground"
        >
          <template v-if="tutup">
            {{ locale.t('kafeTutupTombol') }}
          </template>
          <template v-else>
            {{ locale.t('checkout') }}
            <ChevronRightIcon class="size-4" />
          </template>
        </span>
      </button>
    </div>

    <VariantPickerDialog
      :open="pickerOpen"
      :product="pickerProduct"
      @update:open="pickerOpen = $event"
    />
    <CallStaffDialog
      :open="callStaffOpen"
      @update:open="callStaffOpen = $event"
    />
    <RecentOrdersDialog
      :open="recentOrdersOpen"
      @update:open="recentOrdersOpen = $event"
    />
    <BillDialog :open="billOpen" @update:open="billOpen = $event" />
  </div>
</template>
