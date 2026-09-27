<script setup>
import { watch } from 'vue'
import { useRouter } from 'vue-router'
import { useRecentOrdersStore } from '@/stores/recentOrders'
import { useLocaleStore } from '@/stores/locale'
import { STATUS_LABEL_KEY, STATUS_COLOR } from '@/lib/orderStatus'
import { formatRupiah } from '@/lib/format'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ChevronRightIcon, ReceiptIcon } from '@lucide/vue'

const props = defineProps({ open: { type: Boolean, required: true } })
const emit = defineEmits(['update:open'])

const recentOrders = useRecentOrdersStore()
const locale = useLocaleStore()
const router = useRouter()

// Status terbaru setiap kali daftar dibuka.
watch(
  () => props.open,
  (terbuka) => {
    if (terbuka) recentOrders.muat()
  }
)

function jam(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString(locale.locale === 'en' ? 'en-GB' : 'id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function openOrder(kodeOrder) {
  emit('update:open', false)
  router.push({ name: 'order', params: { kodeOrder } })
}
</script>

<template>
  <Dialog :open="props.open" @update:open="(v) => emit('update:open', v)">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ locale.t('pesananSayaLabel') }}</DialogTitle>
      </DialogHeader>
      <p
        v-if="recentOrders.daftar.length === 0"
        class="py-4 text-center text-sm text-muted-foreground"
      >
        {{ locale.t('belumAdaPesananDiPerangkat') }}
      </p>
      <div v-else class="max-h-[60vh] space-y-1.5 overflow-y-auto">
        <button
          v-for="order in recentOrders.daftar"
          :key="order.kodeOrder"
          type="button"
          class="flex w-full items-center gap-2.5 rounded-2xl border p-3.5 text-left text-sm transition-colors hover:border-primary/50 hover:bg-accent active:bg-accent"
          @click="openOrder(order.kodeOrder)"
        >
          <ReceiptIcon class="size-4 shrink-0 text-primary-strong" />
          <span class="min-w-0 flex-1 space-y-0.5">
            <span class="flex flex-wrap items-center gap-1.5">
              <span class="truncate font-mono font-medium">{{ order.kodeOrder }}</span>
              <span
                v-if="order.status"
                class="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                :class="STATUS_COLOR[order.status]"
              >
                {{ locale.t(STATUS_LABEL_KEY[order.status]) }}
              </span>
            </span>
            <span v-if="order.ringkasan" class="block truncate text-xs text-muted-foreground">
              {{ order.ringkasan }}
            </span>
            <span v-if="order.createdAt" class="block text-xs text-muted-foreground">
              {{ jam(order.createdAt) }}
              <template v-if="order.totalHarga !== undefined"> · {{ formatRupiah(order.totalHarga) }}</template>
            </span>
          </span>
          <ChevronRightIcon class="size-4 shrink-0 text-muted-foreground" />
        </button>
      </div>
    </DialogContent>
  </Dialog>
</template>
