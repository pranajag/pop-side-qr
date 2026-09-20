<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { api, formatApiError, API_URL } from '@/lib/api'
import { formatRupiah } from '@/lib/format'
import { STATUS_LABEL_KEY, STATUS_COLOR } from '@/lib/orderStatus'
import { useLocaleStore } from '@/stores/locale'
import { Button } from '@/components/ui/button'
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
  LoaderCircleIcon,
  CircleCheckIcon,
  CircleIcon,
  ClockIcon,
  TriangleAlertIcon,
  CopyIcon,
  UtensilsIcon,
  PackageCheckIcon,
  XCircleIcon,
} from '@lucide/vue'

const route = useRoute()
const router = useRouter()
const locale = useLocaleStore()

const order = ref(null)
const notFound = ref(false)
const loading = ref(true)
const confirming = ref(false)
const qrisImage = ref(null)
const buktiFile = ref(null)
const buktiPreview = ref(null)

const statusLabel = computed(() => {
  const key = STATUS_LABEL_KEY[order.value?.status]
  return key ? locale.t(key) : order.value?.status
})
const statusColor = computed(
  () => STATUS_COLOR[order.value?.status] ?? 'bg-muted-foreground'
)
const needsQrisPayment = computed(
  () => order.value?.status === 'pending' && order.value?.metode === 'qris'
)
// The exact amount to transfer, not just the menu total — QRIS orders
// carry a small per-order uniqueCode (api's order.service.js) so a kasir
// with no payment gateway can match this oddly-specific figure against a
// real bank/e-wallet mutation instead of trusting an uploaded screenshot
// alone. Falls back to the plain total for every non-QRIS order.
const totalBayar = computed(
  () => (order.value?.totalHarga ?? 0) + (order.value?.uniqueCode ?? 0)
)
const isWaitingKasir = computed(
  () => order.value?.status === 'pending' && order.value?.metode !== 'qris'
)
const isTerminal = computed(
  () =>
    order.value?.status === 'completed' || order.value?.status === 'cancelled'
)

// waiting_verif shares step 0 with pending — both mean "not confirmed yet",
// same grouping the needsQrisPayment/isWaitingKasir panels above already
// use. cancelled has no place on this pipeline (see the dedicated branch in
// the template) so it's just left out of this map.
const PROGRESS_STEPS = [
  { key: 'pending', labelKey: 'statusPending' },
  { key: 'confirmed', labelKey: 'statusConfirmed' },
  { key: 'cooking', labelKey: 'statusCooking' },
  { key: 'ready', labelKey: 'statusReady' },
  { key: 'completed', labelKey: 'statusCompleted' },
]
const STATUS_STEP_INDEX = {
  pending: 0,
  waiting_verif: 0,
  confirmed: 1,
  cooking: 2,
  ready: 3,
  completed: 4,
}
const currentStepIndex = computed(
  () => STATUS_STEP_INDEX[order.value?.status] ?? -1
)
const showStepper = computed(
  () => order.value && order.value.status !== 'cancelled'
)

function stepState(i) {
  if (order.value?.status === 'completed') return 'done'
  if (i < currentStepIndex.value) return 'done'
  if (i === currentStepIndex.value) return 'current'
  return 'upcoming'
}

// Elapsed time since the order's last status change — not a promised ETA
// (this cafe has no per-order kitchen-load data to predict one honestly),
// just an honest "how long has this been sitting" data point.
const now = ref(Date.now())
const elapsedMinutes = computed(() => {
  if (!order.value?.updatedAt) return null
  return Math.max(
    0,
    Math.floor((now.value - new Date(order.value.updatedAt).getTime()) / 60000)
  )
})

async function load({ silent = false } = {}) {
  if (!silent) loading.value = true
  try {
    const data = await api.get(`/public/orders/${route.params.kodeOrder}`)
    order.value = data.order
    notFound.value = false
  } catch (err) {
    // Silent (polling) failures — a rate limit hit, a network blip — just
    // retry next tick and keep showing whatever order data is already on
    // screen, rather than blanking out a page the customer is looking at.
    if (silent) return
    if (err.status === 404) {
      notFound.value = true
    } else {
      toast.error(formatApiError(err))
    }
  } finally {
    if (!silent) loading.value = false
  }
}

let statusTimer = null
let clockTimer = null

onMounted(async () => {
  await load()
  if (needsQrisPayment.value) {
    try {
      const { settings } = await api.get('/public/settings')
      qrisImage.value = settings.qrisImage
    } catch {
      // Non-fatal — the "sudah bayar" button still works without the image loaded.
    }
  }

  // Without this, the page would show a stale status forever until the
  // customer manually reloads — and an elapsed-time readout next to a
  // stale status would actively mislead rather than inform.
  // 20s keeps this comfortably under the 5/min rate limit on this route
  // (guessable kodeOrder, so it's intentionally tight — AGENTS.md) even
  // together with this same mount's own initial load() above.
  statusTimer = setInterval(async () => {
    if (isTerminal.value) {
      clearInterval(statusTimer)
      return
    }
    await load({ silent: true })
  }, 20000)
  clockTimer = setInterval(() => {
    now.value = Date.now()
  }, 30000)
})
onUnmounted(() => {
  clearInterval(statusTimer)
  clearInterval(clockTimer)
  if (buktiPreview.value) URL.revokeObjectURL(buktiPreview.value)
})

function onBuktiChange(e) {
  const file = e.target.files?.[0]
  if (buktiPreview.value) URL.revokeObjectURL(buktiPreview.value)
  buktiFile.value = file || null
  buktiPreview.value = file ? URL.createObjectURL(file) : null
}

const confirmBayarOpen = ref(false)

function onSudahBayarClick() {
  if (!buktiFile.value) {
    toast.error(locale.t('uploadBuktiDulu'))
    return
  }
  confirmBayarOpen.value = true
}

async function onConfirmBayar() {
  confirming.value = true
  try {
    const fd = new FormData()
    fd.append('bukti', buktiFile.value)
    await api.post(`/public/orders/${route.params.kodeOrder}/bayar`, fd, {
      isFormData: true,
    })
    toast.success(locale.t('terimaKasihMenungguVerifikasi'))
    await load()
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    confirming.value = false
  }
}

async function copyKode() {
  try {
    await navigator.clipboard.writeText(order.value.kodeOrder)
    toast.success(locale.t('kodeOrderDisalin'))
  } catch {
    toast.error(locale.t('gagalMenyalinKode'))
  }
}
</script>

<template>
  <div
    class="flex min-h-svh flex-col items-center justify-center gap-3 px-6 text-center"
    v-if="loading"
  >
    <LoaderCircleIcon class="size-8 animate-spin text-muted-foreground" />
  </div>

  <div
    v-else-if="notFound"
    class="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center"
  >
    <TriangleAlertIcon class="size-10 text-destructive" />
    <div class="space-y-1">
      <h1 class="text-lg font-semibold">
        {{ locale.t('orderTidakDitemukan') }}
      </h1>
      <p class="text-sm text-muted-foreground">
        {{ locale.t('orderTidakDitemukanDesc') }}
      </p>
    </div>
    <Button variant="outline" @click="router.push({ name: 'menu' })">{{
      locale.t('kembaliKeMenu')
    }}</Button>
  </div>

  <div
    v-else-if="!order"
    class="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center"
  >
    <TriangleAlertIcon class="size-10 text-muted-foreground" />
    <div class="space-y-1">
      <h1 class="text-lg font-semibold">{{ locale.t('gagalMemuatStatus') }}</h1>
      <p class="text-sm text-muted-foreground">
        {{ locale.t('cobaLagiSebentar') }}
      </p>
    </div>
    <Button variant="outline" @click="load()">{{
      locale.t('cobaLagi')
    }}</Button>
  </div>

  <div v-else class="min-h-svh px-4 py-6">
    <div class="mx-auto max-w-md space-y-6 sm:max-w-lg md:max-w-xl">
      <div class="space-y-2 text-center">
        <span
          class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-white"
          :class="statusColor"
        >
          <span class="size-1.5 rounded-full bg-white" />
          {{ statusLabel }}
        </span>
        <button
          type="button"
          class="flex items-center justify-center gap-1.5 text-xl font-bold tracking-wide"
          @click="copyKode"
        >
          {{ order.kodeOrder }}
          <CopyIcon class="size-4 text-muted-foreground" />
        </button>
        <p class="text-xs text-muted-foreground">
          {{
            order.nomorMeja
              ? `${locale.t('meja')} ${order.nomorMeja}`
              : locale.t('bawaPulang')
          }}
        </p>
      </div>

      <div v-if="showStepper" class="space-y-3 rounded-lg border p-4">
        <h2 class="text-sm font-semibold text-muted-foreground">
          {{ locale.t('progresPesanan') }}
        </h2>
        <div class="space-y-0">
          <div
            v-for="(step, i) in PROGRESS_STEPS"
            :key="step.key"
            class="flex gap-3"
          >
            <div class="flex flex-col items-center">
              <CircleCheckIcon
                v-if="stepState(i) === 'done'"
                class="size-5 shrink-0 text-status-completed"
              />
              <span
                v-else-if="stepState(i) === 'current'"
                class="relative flex size-5 shrink-0 items-center justify-center"
              >
                <span
                  class="absolute size-5 animate-ping rounded-full bg-brand-cta/40"
                />
                <span class="relative size-2.5 rounded-full bg-brand-cta" />
              </span>
              <CircleIcon
                v-else
                class="size-5 shrink-0 text-muted-foreground/40"
              />
              <div
                v-if="i < PROGRESS_STEPS.length - 1"
                class="my-0.5 h-5 w-px"
                :class="
                  stepState(i) === 'done' ? 'bg-status-completed' : 'bg-border'
                "
              />
            </div>
            <p
              class="pb-4 text-sm"
              :class="
                stepState(i) === 'upcoming'
                  ? 'text-muted-foreground/60'
                  : stepState(i) === 'current'
                    ? 'font-medium text-foreground'
                    : 'text-foreground'
              "
            >
              {{ locale.t(step.labelKey) }}
            </p>
          </div>
        </div>
      </div>

      <div
        v-if="needsQrisPayment"
        class="space-y-3 rounded-lg border p-4 text-center"
      >
        <p class="text-sm font-medium">
          {{
            locale.t('scanQrisUntukBayar', {
              total: formatRupiah(totalBayar),
            })
          }}
        </p>
        <p v-if="order.uniqueCode" class="text-xs text-muted-foreground">
          {{ locale.t('kodeUnikDesc', { code: order.uniqueCode }) }}
        </p>
        <img
          v-if="qrisImage"
          :src="`${API_URL}/public/settings/qris-photo/${qrisImage}`"
          alt="QRIS"
          class="mx-auto max-h-64 rounded-lg border"
        />
        <p v-else class="text-xs text-muted-foreground">
          {{ locale.t('qrisBelumTersedia') }}
        </p>

        <div class="space-y-2 text-left">
          <label class="block text-xs font-medium text-muted-foreground">{{
            locale.t('uploadBuktiPembayaran')
          }}</label>
          <div class="flex items-center gap-3">
            <img
              v-if="buktiPreview"
              :src="buktiPreview"
              :alt="locale.t('previewBukti')"
              class="size-14 shrink-0 rounded-md border object-cover"
            />
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              class="min-w-0 flex-1 text-xs text-muted-foreground file:mr-2 file:rounded-md file:border file:border-input file:bg-transparent file:px-2 file:py-1 file:text-xs file:font-medium file:text-foreground"
              @change="onBuktiChange"
            />
          </div>
          <p class="text-[11px] text-muted-foreground">
            {{ locale.t('uploadBuktiDesc') }}
          </p>
        </div>

        <Button
          size="lg"
          class="h-12 w-full"
          :disabled="confirming || !buktiFile"
          @click="onSudahBayarClick"
        >
          <LoaderCircleIcon v-if="confirming" class="size-4 animate-spin" />
          {{ locale.t('sayaSudahBayar') }}
        </Button>
      </div>

      <div
        v-else-if="isWaitingKasir"
        class="space-y-1 rounded-lg border p-4 text-center"
      >
        <ClockIcon class="mx-auto size-6 text-muted-foreground" />
        <p class="text-sm font-medium">{{ locale.t('sebutkanKodeKeKasir') }}</p>
        <p class="text-xs text-muted-foreground">
          {{
            locale.t('bayarMetodeLangsung', {
              metode:
                order.metode === 'tunai'
                  ? locale.t('tunai')
                  : locale.t('debit'),
              total: formatRupiah(order.totalHarga),
            })
          }}
        </p>
      </div>

      <div
        v-else-if="order.status === 'waiting_verif'"
        class="space-y-1 rounded-lg border p-4 text-center"
      >
        <LoaderCircleIcon
          class="mx-auto size-6 animate-spin text-muted-foreground"
        />
        <p class="text-sm font-medium">
          {{ locale.t('menungguVerifikasiKasir') }}
        </p>
        <p v-if="elapsedMinutes" class="text-xs text-muted-foreground">
          {{ locale.t('sudahNMenit', { n: elapsedMinutes }) }}
        </p>
      </div>

      <div
        v-else-if="order.status === 'completed'"
        class="space-y-1 rounded-lg border p-4 text-center"
      >
        <CircleCheckIcon class="mx-auto size-6 text-status-completed" />
        <p class="text-sm font-medium">{{ locale.t('pesananSelesai') }}</p>
      </div>

      <div
        v-else-if="order.status === 'cancelled'"
        class="space-y-1 rounded-lg border p-4 text-center"
      >
        <XCircleIcon class="mx-auto size-6 text-status-cancelled" />
        <p class="text-sm font-medium">
          {{ locale.t('pesananDibatalkanDesc') }}
        </p>
      </div>

      <div
        v-else-if="order.status === 'ready'"
        class="space-y-1 rounded-lg border p-4 text-center"
      >
        <PackageCheckIcon class="mx-auto size-6 text-status-ready" />
        <p class="text-sm font-medium">{{ locale.t('pesananSiapDiambil') }}</p>
        <p class="text-xs text-muted-foreground">
          {{ locale.t('pesananSiapDiambilDesc') }}
        </p>
      </div>

      <div v-else class="rounded-lg border p-4 text-center">
        <UtensilsIcon class="mx-auto size-6 text-muted-foreground" />
        <p class="mt-1 text-sm font-medium">
          {{ locale.t('pesananSedangDiproses') }}
        </p>
        <p v-if="elapsedMinutes" class="text-xs text-muted-foreground">
          {{ locale.t('sudahNMenitSejakUpdate', { n: elapsedMinutes }) }}
        </p>
        <p
          v-if="order.estimasiMenit"
          class="mt-1 text-xs text-muted-foreground"
        >
          {{ locale.t('estimasiSiap', { n: order.estimasiMenit }) }}
        </p>
      </div>

      <AlertDialog
        :open="confirmBayarOpen"
        @update:open="(v) => (confirmBayarOpen = v)"
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{{ locale.t('kirimBuktiIni') }}</AlertDialogTitle>
            <AlertDialogDescription>
              {{
                locale.t('kirimBuktiIniDesc', {
                  total: formatRupiah(totalBayar),
                })
              }}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{{ locale.t('cekLagi') }}</AlertDialogCancel>
            <AlertDialogAction :disabled="confirming" @click="onConfirmBayar">
              <LoaderCircleIcon v-if="confirming" class="size-4 animate-spin" />
              {{ locale.t('yaSudahBayar') }}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div class="space-y-2 rounded-lg border p-4">
        <h2 class="text-sm font-semibold text-muted-foreground">
          {{ locale.t('detailPesanan') }}
        </h2>
        <div
          v-for="(item, idx) in order.items"
          :key="idx"
          class="flex justify-between gap-3 text-sm"
        >
          <span class="min-w-0">
            {{ item.qty }}x {{ item.nama }}
            <span
              v-if="item.variants?.length"
              class="block text-xs text-muted-foreground"
            >
              {{ item.variants.map((v) => v.namaOption).join(', ') }}
            </span>
          </span>
          <span class="shrink-0">{{
            formatRupiah(item.harga * item.qty)
          }}</span>
        </div>
        <div v-if="order.discountAmount > 0" class="flex justify-between border-t pt-2 text-sm text-muted-foreground">
          <span>Subtotal</span>
          <span>{{ formatRupiah(order.totalHarga + order.discountAmount) }}</span>
        </div>
        <div v-if="order.discountAmount > 0" class="flex justify-between text-sm text-status-completed">
          <span>{{ locale.t('diskon') }}{{ order.discountReason ? ` (${order.discountReason})` : '' }}</span>
          <span>-{{ formatRupiah(order.discountAmount) }}</span>
        </div>
        <div
          class="flex justify-between text-sm font-semibold"
          :class="order.discountAmount > 0 ? '' : 'border-t pt-2'"
        >
          <span>{{ locale.t('total') }}</span>
          <span>{{ formatRupiah(order.totalHarga) }}</span>
        </div>
        <p
          v-if="order.catatan"
          class="border-t pt-2 text-xs text-muted-foreground"
        >
          {{ locale.t('catatanLabel', { catatan: order.catatan }) }}
        </p>
      </div>

      <Button
        variant="outline"
        class="w-full"
        @click="router.push({ name: 'menu' })"
        >{{ locale.t('kembaliKeMenu') }}</Button
      >
    </div>
  </div>
</template>
