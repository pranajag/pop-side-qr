<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { useTableStore } from '@/stores/table'
import { useCartStore } from '@/stores/cart'
import { useMenuStore } from '@/stores/menu'
import { useRecentOrdersStore } from '@/stores/recentOrders'
import { useLocaleStore } from '@/stores/locale'
import { useCafeStatusStore } from '@/stores/cafeStatus'
import { api, formatApiError } from '@/lib/api'
import { formatRupiah } from '@/lib/format'
import { savePendingOrder } from '@/lib/offlineQueue'
import { loadJSON, saveJSON } from '@/lib/persist'
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
  BadgeCheckIcon,
  StarIcon,
} from '@lucide/vue'

const table = useTableStore()
const cart = useCartStore()
const menu = useMenuStore()
const recentOrders = useRecentOrdersStore()
const locale = useLocaleStore()
const cafeStatus = useCafeStatusStore()
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

// crypto.randomUUID() needs a secure context (HTTPS/localhost) — falls back
// to crypto.getRandomValues (works everywhere) so an odd in-app browser on
// a customer's phone can't break checkout entirely over a dedup key that
// doesn't need to be unguessable, just unique-enough per tap.
function generateIdempotencyKey() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const metode = ref('qris')
const catatan = ref('')
// Member auto-join — entirely optional, earning-only (redeeming points
// stays staff-mediated in Pesanan Manual; see order.validator.js's
// customerPhone comment for why). Omitted from the payload below when
// blank, same as catatan, so a customer who skips this sees zero change
// from before this field existed.
const customerPhone = ref('')

// Cart items already survive navigation (cart.js persists to localStorage)
// — this covers the two free-text fields on THIS page that don't: losing a
// typed note or member phone number to an accidental back-tap/reload would
// mean retyping it from scratch. sessionStorage (not localStorage, unlike
// the cart) since this is this-visit-only scratch state, not something
// that should still be sitting there a week later. metode is deliberately
// left out — it's a single tap to redo, not worth persisting.
const DRAFT_KEY = 'popside.checkoutDraft'
watch([catatan, customerPhone], ([c, p]) => {
  saveJSON(sessionStorage, DRAFT_KEY, { catatan: c, customerPhone: p })
})
function clearCheckoutDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    // Nothing to clean up if storage was never reachable in the first place.
  }
}

// Cafe closed = no staff on shift. Server refuses the order either way
// (order.service.js); this just stops the customer filling in a whole
// checkout before finding out.
const tutup = computed(() => cafeStatus.loaded && !cafeStatus.sedangBuka)

const summary = ref(null)
const loadingSummary = ref(false)
// null whenever the number is blank, unknown, or the server hasn't answered
// yet — the template branches on exactly that.
const member = computed(() => summary.value?.member ?? null)
const memberTier = computed(() => member.value?.tier ?? null)
const hasPriceBreakdown = computed(
  () =>
    (summary.value?.discountAmount ?? 0) > 0 ||
    (summary.value?.taxAmount ?? 0) > 0 ||
    (summary.value?.serviceChargeAmount ?? 0) > 0
)
const submitting = ref(false)
// Generated once per checkout visit, reused across every retry of the same
// tap (a dropped connection, timeout, or double-click) — never regenerated
// inside onSubmit — so the backend can recognize a retry and return the
// order that attempt actually created instead of making a second one.
const idempotencyKey = generateIdempotencyKey()

onMounted(async () => {
  if (!menu.loaded) await menu.fetchMenu()
  if (cart.isEmpty) {
    router.replace({ name: 'menu' })
    return
  }
  const draft = loadJSON(sessionStorage, DRAFT_KEY, null)
  if (draft) {
    catatan.value = draft.catatan ?? ''
    customerPhone.value = draft.customerPhone ?? ''
  }
  cafeStatus.fetch()
  await refreshSummary()
})

// The summary is recomputed server-side rather than adjusted in the browser
// because the member discount depends on points only the server knows, and
// the total quoted here has to be the exact one createOrder will charge.
async function refreshSummary() {
  loadingSummary.value = true
  try {
    summary.value = await api.post('/public/cart/total', {
      items: cart.items.map((i) => ({
        productId: i.productId,
        qty: i.qty,
        variantOptionIds: i.variantOptionIds,
      })),
      customerPhone: lookupPhone.value,
      // Not part of the price — it scopes the member-lookup rate limit to
      // this table instead of the cafe's shared IP (api rateLimit.js).
      token: table.token ?? undefined,
    })
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    loadingSummary.value = false
  }
}

// Only a plausibly-complete number is worth asking the server about. Half
// a number can never match anyone, and every partial lookup would burn a
// slot of the member-lookup rate limit for no result.
const MIN_PHONE_DIGITS = 9
const lookupPhone = computed(() => {
  const trimmed = customerPhone.value.trim()
  const digits = trimmed.replace(/\D/g, '')
  return digits.length >= MIN_PHONE_DIGITS ? trimmed : undefined
})

// Debounced: a phone number is typed a digit at a time, and only the
// finished number is worth a lookup. Short enough that the discount still
// appears while the customer is looking at the field.
const checkingMember = ref(false)
let memberDebounce = null
watch(lookupPhone, () => {
  clearTimeout(memberDebounce)
  checkingMember.value = true
  memberDebounce = setTimeout(async () => {
    await refreshSummary()
    checkingMember.value = false
  }, 500)
})
onUnmounted(() => clearTimeout(memberDebounce))

const hasIssues = computed(() => (summary.value?.issues?.length ?? 0) > 0)
const confirmOpen = ref(false)
const selectedMethod = computed(() =>
  METHODS.value.find((m) => m.value === metode.value)
)

async function onSubmit() {
  submitting.value = true
  const payload = {
    token: table.token,
    metode: metode.value,
    catatan: catatan.value || undefined,
    items: cart.items.map((i) => ({
      productId: i.productId,
      qty: i.qty,
      variantOptionIds: i.variantOptionIds,
      catatan: i.catatan || undefined,
    })),
    idempotencyKey,
    customerPhone: customerPhone.value.trim() || undefined,
  }
  try {
    const { order } = await api.post('/public/orders', payload)
    cart.clear()
    clearCheckoutDraft()
    recentOrders.add(order.kodeOrder)
    router.replace({ name: 'order', params: { kodeOrder: order.kodeOrder } })
  } catch (err) {
    // err.status is only ever set once a real HTTP response came back
    // (lib/api.js) — its absence means fetch() itself failed, i.e. no
    // connectivity right now rather than the server rejecting the order.
    // Queue it instead of just failing: cart.clear() never ran, so the
    // customer would otherwise be stuck re-submitting the same order by
    // hand every time they notice the WiFi is back.
    if (err?.status === undefined) {
      savePendingOrder(payload)
      cart.clear()
      clearCheckoutDraft()
      toast.warning(locale.t('checkoutOfflineQueued'))
      router.replace({ name: 'menu' })
    } else {
      toast.error(formatApiError(err))
    }
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
          {{ locale.t('memberLabel') }}
        </h2>
        <input
          v-model="customerPhone"
          type="tel"
          inputmode="numeric"
          maxlength="20"
          :placeholder="locale.t('memberPlaceholder')"
          class="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <p class="mt-1.5 text-xs text-muted-foreground">
          {{ locale.t('memberDesc') }}
        </p>

        <p
          v-if="checkingMember && lookupPhone"
          class="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <LoaderCircleIcon class="size-3 animate-spin" />
          {{ locale.t('memberMengecek') }}
        </p>

        <div
          v-else-if="member"
          class="mt-2 rounded-lg border p-3"
          :class="
            memberTier
              ? 'border-brand-primary/50 bg-brand-primary/10'
              : 'border-border bg-muted/40'
          "
        >
          <p class="flex items-center gap-1.5 text-xs font-medium">
            <BadgeCheckIcon class="size-3.5 shrink-0" />
            {{ locale.t('memberDikenali') }}
          </p>
          <p class="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <StarIcon class="size-3 shrink-0 fill-current" />
            {{ locale.t('memberPoinKamu', { n: member.points }) }}
          </p>

          <template v-if="memberTier">
            <p class="mt-2 text-sm font-semibold">
              {{ locale.t('memberDiskonAktif', { percent: memberTier.discountPercent }) }}
              <span class="font-normal text-muted-foreground">
                {{ locale.t('memberDiskonSyarat', { n: memberTier.minPoints }) }}
              </span>
            </p>
            <p class="text-lg font-bold">
              &minus;{{ formatRupiah(summary?.discountAmount ?? 0) }}
            </p>
            <!-- The one thing a customer is most likely to get wrong: a
            tier is a threshold, not a balance being spent. Saying so here
            is cheaper than answering it at the counter. -->
            <p class="mt-1 text-xs text-muted-foreground">
              {{ locale.t('memberPoinTidakDipotong') }}
            </p>
          </template>
          <p v-else class="mt-2 text-xs text-muted-foreground">
            {{ locale.t('memberBelumCukupPoin') }}
          </p>
          <p
            v-if="summary?.pointsToEarn > 0"
            class="mt-1 text-xs text-muted-foreground"
          >
            {{ locale.t('memberAkanDapatPoin', { n: summary.pointsToEarn }) }}
          </p>
        </div>

        <p
          v-else-if="lookupPhone && summary"
          class="mt-2 text-xs text-muted-foreground"
        >
          {{ locale.t('memberTidakDitemukan') }}
        </p>
      </section>

      <section>
        <h2 class="mb-2 text-sm font-semibold text-muted-foreground">
          {{ locale.t('ringkasan') }}
        </h2>
        <div class="space-y-1 rounded-lg border p-3 text-sm">
          <div
            v-for="(item, idx) in summary?.items ?? []"
            :key="idx"
            class="flex justify-between gap-2 text-muted-foreground"
          >
            <span>
              {{ item.qty }}x {{ item.nama }}
              <span v-if="item.variants?.length" class="text-xs">
                ({{ item.variants.map((v) => v.namaOption).join(', ') }})
              </span>
            </span>
            <span class="shrink-0">{{ formatRupiah(item.subtotal) }}</span>
          </div>
          <!-- Only shown once something actually splits the subtotal from
          the total — a plain order with no discount or tax keeps the single
          Total line it always had. -->
          <template v-if="hasPriceBreakdown">
            <div class="mt-2 flex justify-between gap-2 border-t pt-2 text-muted-foreground">
              <span>{{ locale.t('subtotal') }}</span>
              <span class="shrink-0">{{ formatRupiah(summary?.subtotal ?? 0) }}</span>
            </div>
            <div
              v-if="summary?.discountAmount > 0"
              class="flex justify-between gap-2 font-medium text-brand-cta"
            >
              <span>
                {{ locale.t('diskon') }}
                <span v-if="memberTier" class="text-xs font-normal">
                  ({{ memberTier.discountPercent }}%)
                </span>
              </span>
              <span class="shrink-0">&minus;{{ formatRupiah(summary.discountAmount) }}</span>
            </div>
            <div
              v-if="summary?.taxAmount > 0"
              class="flex justify-between gap-2 text-muted-foreground"
            >
              <span>{{ locale.t('pajak') }}</span>
              <span class="shrink-0">{{ formatRupiah(summary.taxAmount) }}</span>
            </div>
            <div
              v-if="summary?.serviceChargeAmount > 0"
              class="flex justify-between gap-2 text-muted-foreground"
            >
              <span>{{ locale.t('serviceCharge') }}</span>
              <span class="shrink-0">{{ formatRupiah(summary.serviceChargeAmount) }}</span>
            </div>
          </template>
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
      <p
        v-if="tutup"
        class="mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive"
      >
        {{ locale.t('kafeTutup') }} — {{ locale.t('kafeTutupDesc') }}
      </p>
      <Button
        size="lg"
        class="h-12 w-full"
        :disabled="submitting || hasIssues || loadingSummary || tutup"
        @click="confirmOpen = true"
      >
        <LoaderCircleIcon v-if="submitting" class="size-4 animate-spin" />
        {{ tutup ? locale.t('kafeTutupTombol') : locale.t('pesanSekarang') }}
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
