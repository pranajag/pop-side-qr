<script setup>
import { useRouter } from 'vue-router'
import { useRecentOrdersStore } from '@/stores/recentOrders'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ChevronRightIcon, ReceiptIcon } from '@lucide/vue'

const props = defineProps({ open: { type: Boolean, required: true } })
const emit = defineEmits(['update:open'])

const recentOrders = useRecentOrdersStore()
const router = useRouter()

function openOrder(kodeOrder) {
  emit('update:open', false)
  router.push({ name: 'order', params: { kodeOrder } })
}
</script>

<template>
  <Dialog :open="props.open" @update:open="(v) => emit('update:open', v)">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Pesanan Saya</DialogTitle>
      </DialogHeader>
      <p v-if="recentOrders.items.length === 0" class="py-4 text-center text-sm text-muted-foreground">
        Belum ada pesanan di perangkat ini.
      </p>
      <div v-else class="space-y-1.5">
        <button
          v-for="kodeOrder in recentOrders.items"
          :key="kodeOrder"
          type="button"
          class="flex w-full items-center gap-2.5 rounded-lg border p-3 text-left text-sm font-medium transition-colors active:bg-accent"
          @click="openOrder(kodeOrder)"
        >
          <ReceiptIcon class="size-4 shrink-0 text-brand-cta" />
          <span class="min-w-0 flex-1 truncate font-mono">{{ kodeOrder }}</span>
          <ChevronRightIcon class="size-4 shrink-0 text-muted-foreground" />
        </button>
      </div>
    </DialogContent>
  </Dialog>
</template>
