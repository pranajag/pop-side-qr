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
import { normalisasiTelepon, statusTelepon } from '@/lib/phone'
import { hapusDraft, muatDraft, simpanDraft } from '@/lib/checkoutDraft'
import ReservasiNotice from '@/components/ReservasiNotice.vue'
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
  ShieldCheckIcon,
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
// mean retyping it from scratch. metode is deliberately left out — it's a
// single tap to redo, not worth persisting. Why the draft is tied to the
// table: lib/checkoutDraft.js.
watch([catatan, customerPhone], ([c, p]) => {
  simpanDraft(table.id, { catatan: c, customerPhone: p })
})
const clearCheckoutDraft = hapusDraft

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
  const draft = muatDraft(table.id)
  if (draft) {
    catatan.value = draft.catatan ?? ''
    customerPhone.value = draft.customerPhone ?? ''
  }
  cafeStatus.fetch()
  // Titik terakhir sebelum pesanan dikirim — kalau meja ini baru saja masuk
  // jendela reservasi selagi customer memilih menu, di sinilah dia tahu.
  table.perbaruiReservasi()
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

// Only a complete, valid number is worth asking the server about. Half a
// number can never match anyone, and every partial lookup would burn a slot
// of the member-lookup rate limit for no result. Sent in its baku form
// (lib/phone.js) — the same key the server stores it under, so "0812 3456"
// typed today finds the member "0812-3456" created last week.
const statusNomor = computed(() => statusTelepon(customerPhone.value))
const lookupPhone = computed(() =>
  statusNomor.value === 'valid' ? normalisasiTelepon(customerPhone.value) : undefined
)
// Kolomnya opsional, tapi kalau diisi harus benar: nomor setengah jadi
// atau salah ketik yang tetap dikirim akan ditolak server, dan diam-diam
// membuangnya berarti poin customer hilang tanpa dia tahu.
const teleponBermasalah = computed(
  () => statusNomor.value === 'belum-lengkap' || statusNomor.value === 'tidak-valid'
)

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

// ---------- Verifikasi OTP nomor member ----------
// Diskon member baru berlaku setelah kode yang dikirim ke nomor itu
// dimasukkan di sini — tahu nomor HP member lain tidak cukup untuk memakai
// diskonnya. Server tidak memberi tahu apakah sebuah nomor member atau
// bukan sebelum itu (api memberOtp.service.js), jadi layar ini pun tidak.
// Tanda "sudah terverifikasi" disimpan server sebagai cookie httpOnly —
// tidak ada apa pun yang disimpan di browser dari sini.
const verifikasi = computed(() => summary.value?.verifikasiMember ?? { tersedia: false, terverifikasi: false })
const otp = ref({ terkirim: false, kode: '', mengirim: false, memeriksa: false, error: '', tungguDetik: 0 })
let otpTimer = null

function resetOtp() {
  clearInterval(otpTimer)
  otp.value = { terkirim: false, kode: '', mengirim: false, memeriksa: false, error: '', tungguDetik: 0 }
}
watch(lookupPhone, resetOtp)
onUnmounted(() => clearInterval(otpTimer))

function mulaiTunggu(detik) {
  clearInterval(otpTimer)
  otp.value.tungguDetik = detik
  otpTimer = setInterval(() => {
    otp.value.tungguDetik -= 1
    if (otp.value.tungguDetik <= 0) clearInterval(otpTimer)
  }, 1000)
}

async function kirimKodeOtp() {
  if (!lookupPhone.value || otp.value.mengirim || otp.value.tungguDetik > 0) return
  otp.value.mengirim = true
  otp.value.error = ''
  try {
    await api.post('/public/member/otp', { token: table.token, customerPhone: lookupPhone.value })
    otp.value.terkirim = true
    otp.value.kode = ''
    mulaiTunggu(60)
  } catch (err) {
    otp.value.error = formatApiError(err)
  } finally {
    otp.value.mengirim = false
  }
}

async function verifikasiKodeOtp() {
  const kode = otp.value.kode.replace(/\D/g, '')
  if (kode.length !== 6 || otp.value.memeriksa) return
  otp.value.memeriksa = true
  otp.value.error = ''
  try {
    await api.post('/public/member/otp/verifikasi', { token: table.token, customerPhone: lookupPhone.value, kode })
    resetOtp()
    await refreshSummary()
  } catch (err) {
    otp.value.error = formatApiError(err)
    otp.value.kode = ''
  } finally {
    otp.value.memeriksa = false
  }
}

const hasIssues = computed(() => (summary.value?.issues?.length ?? 0) > 0)
const confirmOpen = ref(false)
const selectedMethod = computed(() =>
  METHODS.value.find((m) => m.value === metode.value)
)

async function onSubmit() {
  // Status bisa berubah selagi dialog konfirmasi terbuka — tombol yang
  // membukanya sudah dimatikan, ini penjaga untuk jeda di antaranya.
  if (tutup.value || teleponBermasalah.value) return
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
    customerPhone: lookupPhone.value,
  }
  try {
    const { order } = await api.post('/public/orders', payload)
    cart.clear()
    clearCheckoutDraft()
    recentOrders.add(order.kodeOrder, order.createdAt)
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
      // The cafe can close while the customer is still filling this form —
      // cafeStatus is only fetched when the page loads, so until now the
      // button stayed enabled and every further tap failed the same way,
      // burning a createOrder rate-limit slot until the error turned into a
      // misleading "too many attempts". Reflect the refusal locally so the
      // screen locks itself, exactly as if they had arrived after closing.
      if (err?.code === 'CAFE_CLOSED') cafeStatus.sedangBuka = false
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

  <div v-else class="mx-auto min-h-svh max-w-md pb-28 sm:max-w-xl lg:max-w-2xl">
    <header
      class="sticky top-0 z-10 flex items-center gap-2 border-b bg-background/95 px-3 py-3 backdrop-blur"
    >
      <button
        type="button"
        class="flex size-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-accent active:bg-accent"
        :aria-label="locale.t('kembaliKeKeranjangLabel')"
        @click="router.push({ name: 'cart' })"
      >
        <ArrowLeftIcon class="size-5" />
      </button>
      <h1 class="text-base font-semibold">{{ locale.t('checkoutTitle') }}</h1>
    </header>

    <main class="space-y-6 px-4 py-4">
      <ReservasiNotice />
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
            class="flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"
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
                metode === m.value ? 'text-primary-strong' : 'text-muted-foreground'
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
          class="w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </section>

      <!-- Hidden entirely while the store has loyalty switched off: asking
      for a phone number that earns nothing would be collecting personal
      data for no reason. The server ignores one sent anyway. -->
      <section v-if="cafeStatus.memberEnabled">
        <h2 class="mb-2 text-sm font-semibold text-muted-foreground">
          {{ locale.t('memberLabel') }}
        </h2>
        <input
          v-model="customerPhone"
          type="tel"
          inputmode="numeric"
          maxlength="20"
          :placeholder="locale.t('memberPlaceholder')"
          class="w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <p
          v-if="statusNomor === 'tidak-valid'"
          class="mt-1.5 text-xs font-medium text-destructive"
        >
          {{ locale.t('teleponTidakValid') }}
        </p>
        <p
          v-else-if="statusNomor === 'belum-lengkap'"
          class="mt-1.5 text-xs text-muted-foreground"
        >
          {{ locale.t('teleponBelumLengkap') }}
        </p>
        <p v-else class="mt-1.5 text-xs text-muted-foreground">
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
          class="mt-2 rounded-2xl border p-3.5"
          :class="
            memberTier
              ? 'border-primary bg-primary/10'
              : 'border-border bg-muted/40'
          "
        >
          <p class="flex items-center gap-1.5 text-xs font-medium">
            <BadgeCheckIcon class="size-3.5 shrink-0" />
            {{ verifikasi.terverifikasi ? locale.t('memberTerverifikasi') : locale.t('memberDikenali') }}
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
            {{
              summary?.nextTier
                ? locale.t('memberKurangPoin', {
                    n: summary.nextTier.kurangPoin,
                    percent: summary.nextTier.discountPercent,
                  })
                : locale.t('memberBelumCukupPoin')
            }}
          </p>
          <p
            v-if="memberTier && summary?.nextTier"
            class="mt-1 text-xs text-muted-foreground"
          >
            {{
              locale.t('memberKurangPoinNaik', {
                n: summary.nextTier.kurangPoin,
                percent: summary.nextTier.discountPercent,
              })
            }}
          </p>
          <p
            v-if="summary?.pointsToEarn > 0"
            class="mt-1 text-xs text-muted-foreground"
          >
            {{ locale.t('memberAkanDapatPoin', { n: summary.pointsToEarn }) }}
          </p>
        </div>

        <!-- Nomor valid, belum diverifikasi: poinnya tetap masuk ke nomor
        itu; diskonnya menunggu verifikasi OTP. Sama persis untuk nomor apa
        pun — member atau bukan. -->
        <div
          v-else-if="lookupPhone && summary"
          class="mt-2 space-y-2 rounded-2xl border border-border bg-muted/40 p-3.5 text-xs"
        >
          <p class="text-muted-foreground">
            {{ locale.t('memberPoinKeNomor') }}
            <template v-if="summary.pointsToEarn > 0">
              {{ locale.t('memberAkanDapatPoin', { n: summary.pointsToEarn }) }}
            </template>
          </p>
          <template v-if="verifikasi.tersedia">
            <p class="font-medium text-foreground">{{ locale.t('memberVerifikasiAjak') }}</p>
            <p v-if="otp.terkirim" class="text-muted-foreground">{{ locale.t('memberKodeTerkirim') }}</p>
            <form v-if="otp.terkirim" class="flex gap-2" @submit.prevent="verifikasiKodeOtp">
              <label class="sr-only" for="kode-otp">{{ locale.t('memberKodeLabel') }}</label>
              <input
                id="kode-otp"
                v-model="otp.kode"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="6"
                placeholder="000000"
                class="w-28 rounded-xl border border-input bg-card px-3 py-2 text-center font-mono text-sm tracking-widest outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <Button type="submit" size="sm" :disabled="otp.memeriksa || otp.kode.replace(/\D/g, '').length !== 6">
                <LoaderCircleIcon v-if="otp.memeriksa" class="size-3.5 animate-spin" />
                {{ locale.t('memberVerifikasiTombol') }}
              </Button>
            </form>
            <p v-if="otp.error" class="font-medium text-destructive">{{ otp.error }}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              :disabled="otp.mengirim || otp.tungguDetik > 0"
              @click="kirimKodeOtp"
            >
              <LoaderCircleIcon v-if="otp.mengirim" class="size-3.5 animate-spin" />
              <ShieldCheckIcon v-else class="size-3.5" />
              {{
                otp.tungguDetik > 0
                  ? locale.t('memberKirimUlangDalam', { n: otp.tungguDetik })
                  : otp.terkirim
                    ? locale.t('memberKirimUlang')
                    : locale.t('memberKirimKode')
              }}
            </Button>
          </template>
          <p v-else class="text-muted-foreground">{{ locale.t('memberVerifikasiTidakTersedia') }}</p>
        </div>
      </section>

      <section>
        <h2 class="mb-2 text-sm font-semibold text-muted-foreground">
          {{ locale.t('ringkasan') }}
        </h2>
        <div class="space-y-1 rounded-2xl bg-card shadow-[0_1px_2px_rgba(13,15,20,0.04)] p-3.5 text-sm">
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
              class="flex justify-between gap-2 font-medium text-primary-strong"
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
      class="fixed inset-x-0 bottom-0 z-10 mx-auto max-w-md border-t bg-background p-3 sm:max-w-xl lg:max-w-2xl"
    >
      <p
        v-if="tutup"
        class="mb-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive"
      >
        {{ locale.t('kafeTutup') }} — {{ locale.t('kafeTutupDesc') }}
      </p>
      <Button
        size="lg"
        class="h-12 w-full"
        :disabled="submitting || hasIssues || loadingSummary || tutup || teleponBermasalah"
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
            <span v-if="table.reservasi" class="mt-2 block font-medium text-foreground">
              {{ locale.t('reservasiKonfirmasi', { meja: table.nomorMeja }) }}
            </span>
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
