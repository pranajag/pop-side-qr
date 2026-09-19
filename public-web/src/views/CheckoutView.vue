<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { useTableStore } from '@/stores/table'
import { useCartStore } from '@/stores/cart'
import { useMenuStore } from '@/stores/menu'
import { useRecentOrdersStore } from '@/stores/recentOrders'
import { useLocaleStore } from '@/stores/locale'
import { api, formatApiError } from '@/lib/api'
import { formatRupiah } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
  ArrowLeftIcon,
  TriangleAlertIcon,
  LoaderCircleIcon,
  QrCodeIcon,
  BanknoteIcon,
  CreditCardIcon,
} from '@lucide/vue'

const table = useTableStore()
const cart = useCartStore()
const menu = useMenuStore()
const recentOrders = useRecentOrdersStore()
const locale = useLocaleStore()
const router = useRouter()

const METHODS = computed(() => [
  {
    value: 'qris',
    label: locale.t('metodeQris'),
    description: locale.t('metodeQrisDesc'),
    icon: QrCodeIcon,
  },
  {
    value: 'tunai',
    label: locale.t('metodeTunai'),
    description: locale.t('metodeTunaiDesc'),
    icon: BanknoteIcon,
  },
  {
    value: 'debit',
    label: locale.t('metodeDebit'),
    description: locale.t('metodeDebitDesc'),
    icon: CreditCardIcon,
  },
])

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
      items: cart.items.map((i) => ({
        productId: i.productId,
        qty: i.qty,
        variantOptionIds: i.variantOptionIds,
      })),
    })
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    loadingSummary.value = false
  }
})

const hasIssues = computed(() => (summary.value?.issues?.length ?? 0) > 0)
const confirmOpen = ref(false)
const selectedMethod = computed(() =>
  METHODS.value.find((m) => m.value === metode.value)
)

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
    recentOrders.add(order.kodeOrder)
    router.replace({ name: 'order', params: { kodeOrder: order.kodeOrder } })
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div
    v-if="!table.isVerified"
    class="flex min-h-svh items-center justify-center px-6 text-center text-sm text-muted-foreground"
  >
    {{ locale.t('scanQrDulu') }}
  </div>

  <div v-else class="mx-auto min-h-svh max-w-md pb-28 sm:max-w-lg md:max-w-xl">
    <header
      class="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-3 py-3 backdrop-blur"
    >
      <button
        type="button"
        class="flex size-11 shrink-0 items-center justify-center rounded-full active:bg-accent"
        :aria-label="locale.t('kembaliKeKeranjangLabel')"
        @click="router.push({ name: 'cart' })"
      >
        <ArrowLeftIcon class="size-5" />
      </button>
      <h1 class="text-base font-semibold">{{ locale.t('checkoutTitle') }}</h1>
    </header>

    <main class="space-y-6 px-4 py-4">
      <Alert v-if="hasIssues" variant="destructive">
        <TriangleAlertIcon class="size-4" />
        <AlertTitle>{{ locale.t('keranjangPerluDiperbarui') }}</AlertTitle>
        <AlertDescription>
          {{ locale.t('keranjangPerluDiperbaruiDesc') }}
        </AlertDescription>
      </Alert>

      <section>
        <h2 class="mb-3 text-sm font-semibold text-muted-foreground">
          {{ locale.t('metodePembayaran') }}
        </h2>
        <div class="space-y-2">
          <button
            v-for="m in METHODS"
            :key="m.value"
            type="button"
            class="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors"
            :class="
              metode === m.value
                ? 'border-primary bg-primary/5'
                : 'border-input'
            "
            @click="metode = m.value"
          >
            <component
              :is="m.icon"
              class="size-5 shrink-0"
              :class="
                metode === m.value ? 'text-primary' : 'text-muted-foreground'
              "
            />
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium">{{ m.label }}</span>
              <span class="block text-xs text-muted-foreground">{{
                m.description
              }}</span>
            </span>
            <span
              class="size-5 shrink-0 rounded-full border-2"
              :class="
                metode === m.value
                  ? 'border-primary bg-primary'
                  : 'border-input'
              "
            />
          </button>
        </div>
      </section>

      <section>
        <h2 class="mb-2 text-sm font-semibold text-muted-foreground">
          {{ locale.t('catatanPesanan') }}
        </h2>
        <textarea
          v-model="catatan"
          rows="2"
          maxlength="200"
          :placeholder="locale.t('catatanPesananPlaceholder')"
          class="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </section>

      <section>
        <h2 class="mb-2 text-sm font-semibold text-muted-foreground">
          {{ locale.t('ringkasan') }}
        </h2>
        <div class="space-y-1 rounded-lg border p-3 text-sm">
          <div
            v-for="item in summary?.items ?? []"
            :key="item.productId"
            class="flex justify-between text-muted-foreground"
          >
            <span>{{ item.qty }}x {{ item.nama }}</span>
            <span>{{ formatRupiah(item.subtotal) }}</span>
          </div>
          <div class="mt-2 flex justify-between border-t pt-2 font-semibold">
            <span>{{ locale.t('total') }}</span>
            <span class="flex items-center gap-2">
              <LoaderCircleIcon
                v-if="loadingSummary"
                class="size-3.5 animate-spin text-muted-foreground"
              />
              {{ formatRupiah(summary?.total ?? 0) }}
            </span>
          </div>
        </div>
      </section>
    </main>

    <div
      class="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-md border-t bg-background p-3 sm:max-w-lg md:max-w-xl"
    >
      <Button
        size="lg"
        class="h-12 w-full"
        :disabled="submitting || hasIssues || loadingSummary"
        @click="confirmOpen = true"
      >
        <LoaderCircleIcon v-if="submitting" class="size-4 animate-spin" />
        {{ locale.t('pesanSekarang') }}
      </Button>
    </div>

    <AlertDialog :open="confirmOpen" @update:open="(v) => (confirmOpen = v)">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ locale.t('kirimPesananIni') }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{
              locale.t('kirimPesananIniDesc', {
                total: formatRupiah(summary?.total ?? 0),
                metode: selectedMethod?.label,
              })
            }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ locale.t('cekLagi') }}</AlertDialogCancel>
          <AlertDialogAction :disabled="submitting" @click="onSubmit">
            <LoaderCircleIcon v-if="submitting" class="size-4 animate-spin" />
            {{ locale.t('yaPesanSekarang') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
