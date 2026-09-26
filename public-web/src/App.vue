<script setup>
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { Toaster } from '@/components/ui/sonner'
import { useNetworkStore } from '@/stores/network'
import { useRecentOrdersStore } from '@/stores/recentOrders'
import { useLocaleStore } from '@/stores/locale'
import { useCafeStatusStore } from '@/stores/cafeStatus'
import { retryPendingOrder } from '@/lib/offlineQueue'
import { formatApiError } from '@/lib/api'
import { WifiOffIcon } from '@lucide/vue'

const network = useNetworkStore()
const recentOrders = useRecentOrdersStore()
const locale = useLocaleStore()
const cafeStatus = useCafeStatusStore()
const router = useRouter()

function retryQueue() {
  retryPendingOrder({
    onSuccess: (order) => {
      recentOrders.add(order.kodeOrder, order.createdAt)
      toast.success(locale.t('offlineOrderSent'))
      router.push({ name: 'order', params: { kodeOrder: order.kodeOrder } })
    },
    onServerRejected: (err) => {
      toast.error(locale.t('offlineOrderFailed', { error: formatApiError(err) }))
    },
  })
}

onMounted(() => {
  network.init()
  // Covers both "still on the checkout page when WiFi returns" and "closed
  // the app while offline, reopened later already connected" — the queue
  // itself (offlineQueue.js) is a no-op when there's nothing pending.
  retryQueue()
  window.addEventListener('online', retryQueue)
  // Buka/tutupnya kafe bisa berubah kapan saja (staff mulai atau akhiri
  // shift) — dicek ulang berkala supaya menu tidak terus bilang "tutup"
  // padahal sudah bisa pesan, atau sebaliknya.
  cafeStatus.pantau()
})
</script>

<template>
  <div
    v-if="!network.isOnline"
    class="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-destructive px-4 py-1.5 text-xs font-medium text-destructive-foreground"
  >
    <WifiOffIcon class="size-3.5" />
    {{ locale.t('offlineBanner') }}
  </div>
  <router-view />
  <Toaster position="top-center" rich-colors close-button />
</template>
