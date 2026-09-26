<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { api, formatApiError, API_URL } from '@/lib/api'
import { formatRupiah } from '@/lib/format'
import { STATUS_LABEL_KEY, STATUS_COLOR } from '@/lib/orderStatus'
import { useLocaleStore } from '@/stores/locale'
import { playReadySound } from '@/lib/notifySound'
import { lacakOrder, berhentiLacak, dengarkan, realtimeTersambung } from '@/lib/realtime'
import logoUrl from '@/assets/pop-side-logo.jpg'
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
  BellIcon,
} from '@lucide/vue'

const route = useRoute()
const router = useRouter()
const locale = useLocaleStore()

// Opt-in browser push for "pesanan siap" — never requested automatically
// (an unprompted permission dialog on page load is exactly the pattern
// browsers now auto-deny/flag as spammy); only offered once via a small
// dismissible banner, and only while there's still something to wait for.
const notificationSupported = typeof window !== 'undefined' && 'Notification' in window
const notificationPermission = ref(notificationSupported ? Notification.permission : 'unsupported')
const notificationBannerDismissed = ref(false)
const showNotificationBanner = computed(
  () =>
    notificationSupported &&
    notificationPermission.value === 'default' &&
    !notificationBannerDismissed.value &&
    !isTerminal.value
)

async function enableNotifications() {
  if (!notificationSupported) return
  try {
    notificationPermission.value = await Notification.requestPermission()
  } catch {
    // Ignored — the in-page sound/toast below still fires regardless.
  }
}

// Every status worth interrupting the customer for. 'ready' keeps its own
// louder treatment (it's the one that means "get up and walk to the
// counter"); the rest are reassurance that someone is actually acting on
// the order, which is the whole reason a customer keeps this tab open.
// Statuses absent here (pending, waiting_verif) are states the customer
// themselves just caused, so announcing them back is noise.
const STATUS_NOTIFICATION = {
  confirmed: { title: 'notifDikonfirmasi', body: 'notifDikonfirmasiDesc', tone: 'success' },
  cooking: { title: 'notifDimasak', body: 'notifDimasakDesc', tone: 'info' },
  ready: { title: 'pesananSiapDiambil', body: 'pesananSiapDiambilDesc', tone: 'ready' },
  completed: { title: 'notifSelesai', body: 'notifSelesaiDesc', tone: 'success' },
  cancelled: { title: 'notifDibatalkan', body: 'notifDibatalkanDesc', tone: 'error' },
}

function notifyStatus(status) {
  const spec = STATUS_NOTIFICATION[status]
  if (!spec) return

  const title = locale.t(spec.title)
  const body = locale.t(spec.body)

  // Sound only for 'ready' — a chime for every routine step would train
  // the customer to ignore the one that actually needs them to move.
  if (spec.tone === 'ready') playReadySound()

  if (spec.tone === 'error') toast.error(title, { description: body })
  else if (spec.tone === 'info') toast.info(title, { description: body })
  else toast.success(title, { description: body })

  // The OS-level notification is what reaches a customer who has switched
  // away to another app — the toast above only exists while this tab is on
  // screen.
  if (notificationSupported && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, icon: logoUrl, tag: 'popside-order-status' })
    } catch {
      // Construction can throw in some contexts (e.g. iOS Safari PWA) —
      // the sound/toast above already covered notifying the customer.
    }
  }
}

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
// totalHarga already has discount subtracted and tax/service added
// (api's order.service.js computeTaxAndService) — the receipt-style
// breakdown below has to walk that back out to show a real subtotal.
const subtotal = computed(() => {
  if (!order.value) return 0
  return (
    order.value.totalHarga -
    order.value.taxAmount -
    order.value.serviceChargeAmount +
    order.value.discountAmount
  )
})
const hasBreakdown = computed(
  () =>
    order.value &&
    (order.value.discountAmount > 0 || order.value.taxAmount > 0 || order.value.serviceChargeAmount > 0)
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

// Kapan request status terakhir dikirim — polling cadangan melewati tick
// yang datang terlalu cepat setelah event realtime.
let terakhirDimuat = 0
// Naik setiap event realtime diterapkan; respons yang request-nya berangkat
// sebelum event itu bisa sudah basi, jadi dibuang (muat ulang terjadwal di
// terimaStatus yang menyusul).
let versiEvent = 0

async function load({ silent = false } = {}) {
  if (!silent) loading.value = true
  const versi = versiEvent
  try {
    terakhirDimuat = Date.now()
    const data = await api.get(`/public/orders/${route.params.kodeOrder}`)
    if (versi !== versiEvent) return
    const previousStatus = order.value?.status
    order.value = data.order
    notFound.value = false
    // Fires on the TRANSITION, not just "is in this state" — loading a page
    // that's already ready (e.g. a fresh tab reopened later) shouldn't
    // replay the alert; only the moment it actually changes should.
    if (previousStatus && previousStatus !== data.order.status) {
      notifyStatus(data.order.status)
    }
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
    // Tab di latar belakang tidak ikut menembak server — HP yang ditinggal
    // dengan halaman ini terbuka tidak menghabiskan jatah rate limit (dan
    // baterai). Begitu tab terlihat lagi, statusnya langsung disegarkan.
    if (document.visibilityState === 'hidden') return
    // Realtime tersambung: perubahan status datang lewat event seketika
    // (lacakOrder di bawah) — polling cukup sesekali sebagai cadangan.
    if (realtimeTersambung.value && Date.now() - terakhirDimuat < 60000) return
    await load({ silent: true })
  }, 20000)
  lacakOrder(route.params.kodeOrder)
  berhentiDengar = dengarkan('order:status', terimaStatus)
  document.addEventListener('visibilitychange', onVisibilityChange)
  clockTimer = setInterval(() => {
    now.value = Date.now()
  }, 30000)
})
function onVisibilityChange() {
  if (document.visibilityState === 'visible' && !isTerminal.value) load({ silent: true })
}

// Event realtime membawa status barunya — layar langsung berubah tanpa
// menunggu request. Detail lain (poin, waktu) disegarkan menyusul, paling
// sering sekali per JEDA_MUAT_ULANG_MS: staff yang mengubah status beruntun
// (bayar → masak → siap → selesai dalam semenit) tidak membuat halaman ini
// menembus batas 5 request/menit/kode order (AGENTS.md).
const JEDA_MUAT_ULANG_MS = 20000
let timerMuatUlang = null
function terimaStatus(isi) {
  // Satu HP bisa melacak beberapa pesanan di koneksi yang sama.
  if (!order.value || isi?.kodeOrder !== order.value.kodeOrder) return
  if (!isi.status || isi.status === order.value.status || isTerminal.value) return
  versiEvent += 1
  order.value = { ...order.value, status: isi.status, updatedAt: new Date().toISOString() }
  notifyStatus(isi.status)
  if (timerMuatUlang) return
  timerMuatUlang = setTimeout(
    () => {
      timerMuatUlang = null
      load({ silent: true })
    },
    Math.max(0, terakhirDimuat + JEDA_MUAT_ULANG_MS - Date.now())
  )
}

let berhentiDengar = () => {}
onUnmounted(() => {
  berhentiDengar()
  clearTimeout(timerMuatUlang)
  berhentiLacak(route.params.kodeOrder)
  document.removeEventListener('visibilitychange', onVisibilityChange)
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
    <div class="mx-auto max-w-md space-y-6 sm:max-w-xl lg:max-w-2xl">
      <!-- The anchor of this screen. A customer stares at this page while
      they wait, so the status is the largest thing on it and the order
      code — the one thing they have to read out to a kasir — sits right
      under it at a size that survives a glance across a table. -->
      <div
        class="space-y-3 rounded-3xl bg-card px-5 py-6 text-center shadow-[0_1px_2px_rgba(13,15,20,0.04)]"
      >
        <span
          class="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold"
          :class="statusColor"
        >
          <span class="size-1.5 rounded-full bg-current" />
          {{ statusLabel }}
        </span>
        <button
          type="button"
          class="flex w-full items-center justify-center gap-2 rounded-xl py-1 text-2xl font-bold tracking-wide transition-colors hover:bg-accent active:bg-accent"
          @click="copyKode"
        >
          {{ order.kodeOrder }}
          <CopyIcon class="size-4 shrink-0 text-muted-foreground" />
        </button>
        <p
          class="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground"
        >
          {{
            order.nomorMeja
              ? `${locale.t('meja')} ${order.nomorMeja}`
              : locale.t('bawaPulang')
          }}
        </p>
      </div>

      <div
        v-if="showNotificationBanner"
        class="flex items-center gap-3 rounded-2xl bg-card p-3 text-sm shadow-[0_1px_2px_rgba(13,15,20,0.04)]"
      >
        <BellIcon class="size-4 shrink-0 text-muted-foreground" />
        <p class="min-w-0 flex-1 text-xs text-muted-foreground">
          {{ locale.t('aktifkanNotifikasiDesc') }}
        </p>
        <Button size="sm" variant="outline" class="shrink-0" @click="enableNotifications">
          {{ locale.t('aktifkanNotifikasi') }}
        </Button>
        <button
          type="button"
          class="shrink-0 text-xs text-muted-foreground underline transition-colors hover:text-foreground"
          @click="notificationBannerDismissed = true"
        >
          {{ locale.t('nanti') }}
        </button>
      </div>

      <div v-if="showStepper" class="space-y-3 rounded-2xl bg-card p-4 shadow-[0_1px_2px_rgba(13,15,20,0.04)]">
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
                  class="absolute size-5 animate-ping rounded-full bg-primary-strong/40"
                />
                <span class="relative size-2.5 rounded-full bg-primary-strong" />
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
        class="space-y-3 rounded-2xl bg-card p-4 shadow-[0_1px_2px_rgba(13,15,20,0.04)] text-center"
      >
        <p class="text-sm font-medium">
          {{
            locale.t('scanQrisUntukBayar', {
              total: formatRupiah(order.totalHarga),
            })
          }}
        </p>
        <img
          v-if="qrisImage"
          :src="`${API_URL}/public/settings/qris-photo/${qrisImage}`"
          alt="QRIS"
          class="mx-auto max-h-64 rounded-2xl border"
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
        class="space-y-1 rounded-2xl bg-card p-4 shadow-[0_1px_2px_rgba(13,15,20,0.04)] text-center"
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
        class="space-y-1 rounded-2xl bg-card p-4 shadow-[0_1px_2px_rgba(13,15,20,0.04)] text-center"
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
        class="space-y-1 rounded-2xl bg-card p-4 shadow-[0_1px_2px_rgba(13,15,20,0.04)] text-center"
      >
        <CircleCheckIcon class="mx-auto size-6 text-status-completed" />
        <p class="text-sm font-medium">{{ locale.t('pesananSelesai') }}</p>
      </div>

      <div
        v-else-if="order.status === 'cancelled'"
        class="space-y-1 rounded-2xl bg-card p-4 shadow-[0_1px_2px_rgba(13,15,20,0.04)] text-center"
      >
        <XCircleIcon class="mx-auto size-6 text-status-cancelled" />
        <p class="text-sm font-medium">
          {{ locale.t('pesananDibatalkanDesc') }}
        </p>
      </div>

      <div
        v-else-if="order.status === 'ready'"
        class="space-y-1 rounded-2xl bg-card p-4 shadow-[0_1px_2px_rgba(13,15,20,0.04)] text-center"
      >
        <PackageCheckIcon class="mx-auto size-6 text-status-ready" />
        <p class="text-sm font-medium">{{ locale.t('pesananSiapDiambil') }}</p>
        <p class="text-xs text-muted-foreground">
          {{ locale.t('pesananSiapDiambilDesc') }}
        </p>
      </div>

      <div v-else class="rounded-2xl bg-card p-4 shadow-[0_1px_2px_rgba(13,15,20,0.04)] text-center">
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
                  total: formatRupiah(order.totalHarga),
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

      <div class="space-y-2 rounded-2xl bg-card p-4 shadow-[0_1px_2px_rgba(13,15,20,0.04)]">
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
        <div
          v-if="hasBreakdown"
          class="flex justify-between border-t border-dashed pt-2.5 text-sm text-muted-foreground"
        >
          <span>Subtotal</span>
          <span>{{ formatRupiah(subtotal) }}</span>
        </div>
        <div v-if="order.discountAmount > 0" class="flex justify-between text-sm text-status-completed">
          <span>{{ locale.t('diskon') }}{{ order.discountReason ? ` (${order.discountReason})` : '' }}</span>
          <span>-{{ formatRupiah(order.discountAmount) }}</span>
        </div>
        <div v-if="order.taxAmount > 0" class="flex justify-between text-sm text-muted-foreground">
          <span>Pajak</span>
          <span>{{ formatRupiah(order.taxAmount) }}</span>
        </div>
        <div v-if="order.serviceChargeAmount > 0" class="flex justify-between text-sm text-muted-foreground">
          <span>Service Charge</span>
          <span>{{ formatRupiah(order.serviceChargeAmount) }}</span>
        </div>
        <div
          class="flex items-baseline justify-between gap-3 border-t border-dashed pt-3"
          :class="hasBreakdown ? 'mt-1' : ''"
        >
          <span class="text-sm font-semibold">{{ locale.t('total') }}</span>
          <span class="text-lg font-bold">{{
            formatRupiah(order.totalHarga)
          }}</span>
        </div>
        <p
          v-if="order.pointsEarned > 0 && !['pending', 'waiting_verif', 'cancelled'].includes(order.status)"
          class="border-t border-dashed pt-2.5 text-xs text-primary-strong"
        >
          {{ locale.t('poinDidapat', { n: order.pointsEarned }) }}
        </p>
        <p
          v-if="order.catatan"
          class="border-t border-dashed pt-2.5 text-xs text-muted-foreground"
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
