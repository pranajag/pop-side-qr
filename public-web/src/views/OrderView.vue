<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { api, formatApiError, API_URL } from '@/lib/api'
import { formatRupiah } from '@/lib/format'
import { Button } from '@/components/ui/button'
import {
  LoaderCircleIcon,
  CircleCheckIcon,
  ClockIcon,
  TriangleAlertIcon,
  CopyIcon,
  UtensilsIcon,
} from '@lucide/vue'

const route = useRoute()
const router = useRouter()

const order = ref(null)
const notFound = ref(false)
const loading = ref(true)
const confirming = ref(false)
const qrisImage = ref(null)

const STATUS_LABEL = {
  pending: 'Menunggu Pembayaran',
  waiting_verif: 'Menunggu Verifikasi Kasir',
  confirmed: 'Dikonfirmasi',
  cooking: 'Sedang Dibuat',
  ready: 'Siap Diambil',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
}
const STATUS_COLOR = {
  pending: 'bg-status-pending',
  waiting_verif: 'bg-status-waiting-verif',
  confirmed: 'bg-status-confirmed',
  cooking: 'bg-status-cooking',
  ready: 'bg-status-ready',
  completed: 'bg-status-completed',
  cancelled: 'bg-status-cancelled',
}

const statusLabel = computed(() => STATUS_LABEL[order.value?.status] ?? order.value?.status)
const statusColor = computed(() => STATUS_COLOR[order.value?.status] ?? 'bg-muted-foreground')
const needsQrisPayment = computed(() => order.value?.status === 'pending' && order.value?.metode === 'qris')
const isWaitingKasir = computed(() => order.value?.status === 'pending' && order.value?.metode !== 'qris')

async function load() {
  loading.value = true
  notFound.value = false
  try {
    const data = await api.get(`/public/orders/${route.params.kodeOrder}`)
    order.value = data.order
  } catch (err) {
    if (err.status === 404) {
      notFound.value = true
    } else {
      toast.error(formatApiError(err))
    }
  } finally {
    loading.value = false
  }
}

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
})

async function onConfirmBayar() {
  confirming.value = true
  try {
    await api.post(`/public/orders/${route.params.kodeOrder}/bayar`)
    toast.success('Terima kasih! Menunggu verifikasi kasir.')
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
    toast.success('Kode order disalin')
  } catch {
    toast.error('Gagal menyalin kode')
  }
}
</script>

<template>
  <div class="flex min-h-svh flex-col items-center justify-center gap-3 px-6 text-center" v-if="loading">
    <LoaderCircleIcon class="size-8 animate-spin text-muted-foreground" />
  </div>

  <div v-else-if="notFound" class="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center">
    <TriangleAlertIcon class="size-10 text-destructive" />
    <div class="space-y-1">
      <h1 class="text-lg font-semibold">Order tidak ditemukan</h1>
      <p class="text-sm text-muted-foreground">Kode order salah, atau sudah kedaluwarsa.</p>
    </div>
    <Button variant="outline" @click="router.push({ name: 'menu' })">Kembali ke Menu</Button>
  </div>

  <div v-else class="min-h-svh px-4 py-6">
    <div class="mx-auto max-w-md space-y-6">
      <div class="space-y-2 text-center">
        <span class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-white" :class="statusColor">
          <span class="size-1.5 rounded-full bg-white" />
          {{ statusLabel }}
        </span>
        <button type="button" class="flex items-center justify-center gap-1.5 text-xl font-bold tracking-wide" @click="copyKode">
          {{ order.kodeOrder }}
          <CopyIcon class="size-4 text-muted-foreground" />
        </button>
        <p class="text-xs text-muted-foreground">Meja {{ order.nomorMeja }}</p>
      </div>

      <div v-if="needsQrisPayment" class="space-y-3 rounded-lg border p-4 text-center">
        <p class="text-sm font-medium">Scan QRIS untuk bayar {{ formatRupiah(order.totalHarga) }}</p>
        <img
          v-if="qrisImage"
          :src="`${API_URL}/public/settings/qris-photo/${qrisImage}`"
          alt="QRIS"
          class="mx-auto max-h-64 rounded-lg border"
        />
        <p v-else class="text-xs text-muted-foreground">QRIS belum tersedia — panggil staff untuk bantuan.</p>
        <Button size="lg" class="h-12 w-full" :disabled="confirming" @click="onConfirmBayar">
          <LoaderCircleIcon v-if="confirming" class="size-4 animate-spin" />
          Saya Sudah Bayar
        </Button>
      </div>

      <div v-else-if="isWaitingKasir" class="space-y-1 rounded-lg border p-4 text-center">
        <ClockIcon class="mx-auto size-6 text-muted-foreground" />
        <p class="text-sm font-medium">Sebutkan kode order ini ke kasir</p>
        <p class="text-xs text-muted-foreground">
          Bayar {{ order.metode === 'tunai' ? 'tunai' : 'debit' }} {{ formatRupiah(order.totalHarga) }} langsung ke kasir.
        </p>
      </div>

      <div v-else-if="order.status === 'waiting_verif'" class="space-y-1 rounded-lg border p-4 text-center">
        <LoaderCircleIcon class="mx-auto size-6 animate-spin text-muted-foreground" />
        <p class="text-sm font-medium">Menunggu kasir verifikasi pembayaran</p>
      </div>

      <div v-else-if="order.status === 'completed'" class="space-y-1 rounded-lg border p-4 text-center">
        <CircleCheckIcon class="mx-auto size-6 text-status-completed" />
        <p class="text-sm font-medium">Pesanan selesai. Terima kasih!</p>
      </div>

      <div v-else class="rounded-lg border p-4 text-center">
        <UtensilsIcon class="mx-auto size-6 text-muted-foreground" />
        <p class="mt-1 text-sm font-medium">Pesanan sedang diproses dapur.</p>
      </div>

      <div class="space-y-2 rounded-lg border p-4">
        <h2 class="text-sm font-semibold text-muted-foreground">Detail Pesanan</h2>
        <div v-for="(item, idx) in order.items" :key="idx" class="flex justify-between text-sm">
          <span>{{ item.qty }}x {{ item.nama }}</span>
          <span>{{ formatRupiah(item.harga * item.qty) }}</span>
        </div>
        <div class="flex justify-between border-t pt-2 text-sm font-semibold">
          <span>Total</span>
          <span>{{ formatRupiah(order.totalHarga) }}</span>
        </div>
        <p v-if="order.catatan" class="border-t pt-2 text-xs text-muted-foreground">Catatan: {{ order.catatan }}</p>
      </div>

      <Button variant="outline" class="w-full" @click="router.push({ name: 'menu' })">Kembali ke Menu</Button>
    </div>
  </div>
</template>
