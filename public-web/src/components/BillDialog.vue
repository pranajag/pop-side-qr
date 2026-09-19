<script setup>
import { ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { useTableStore } from '@/stores/table'
import { useLocaleStore } from '@/stores/locale'
import { api, formatApiError } from '@/lib/api'
import { formatRupiah, formatTime } from '@/lib/format'
import { STATUS_LABEL_KEY, STATUS_COLOR } from '@/lib/orderStatus'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { LoaderCircleIcon, ReceiptTextIcon } from '@lucide/vue'

const props = defineProps({ open: { type: Boolean, required: true } })
const emit = defineEmits(['update:open'])

const table = useTableStore()
const locale = useLocaleStore()
const loading = ref(false)
const bill = ref(null)

async function load() {
  loading.value = true
  try {
    const data = await api.get(
      `/public/tables/${encodeURIComponent(table.token)}/bill`
    )
    bill.value = data.bill
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    loading.value = false
  }
}

// Re-fetch every time the dialog opens rather than once on mount — a new
// order placed after the dialog's first open must show up next time it's
// reopened, and this dialog has no other refresh trigger of its own.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) load()
  }
)
</script>

<template>
  <Dialog :open="props.open" @update:open="(v) => emit('update:open', v)">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{
          locale.t('billTitle', { meja: table.nomorMeja })
        }}</DialogTitle>
      </DialogHeader>

      <p class="-mt-2 text-xs text-muted-foreground">
        {{ locale.t('billScopeNote') }}
      </p>

      <div v-if="loading" class="flex justify-center py-8">
        <LoaderCircleIcon class="size-6 animate-spin text-muted-foreground" />
      </div>

      <p
        v-else-if="!bill || bill.orders.length === 0"
        class="py-6 text-center text-sm text-muted-foreground"
      >
        {{ locale.t('billKosong') }}
      </p>

      <div v-else class="space-y-3">
        <p class="text-xs text-muted-foreground">
          {{ locale.t('billJumlahPesanan', { n: bill.orders.length }) }}
        </p>
        <div class="max-h-80 space-y-3 overflow-y-auto pr-1">
          <div
            v-for="order in bill.orders"
            :key="order.kodeOrder"
            class="space-y-1.5 rounded-lg border p-3"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="font-mono text-xs font-semibold">{{
                order.kodeOrder
              }}</span>
              <span
                class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                :class="STATUS_COLOR[order.status]"
              >
                {{ locale.t(STATUS_LABEL_KEY[order.status]) }}
              </span>
            </div>
            <ul class="space-y-0.5 text-xs text-muted-foreground">
              <li v-for="(item, idx) in order.items" :key="idx">
                {{ item.qty }}x {{ item.nama }}
              </li>
            </ul>
            <div
              class="flex items-center justify-between border-t pt-1.5 text-xs"
            >
              <span class="text-muted-foreground">{{
                formatTime(order.createdAt)
              }}</span>
              <span class="font-semibold">{{
                formatRupiah(order.totalHarga)
              }}</span>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between rounded-lg bg-muted p-3">
          <span class="flex items-center gap-1.5 text-sm font-semibold">
            <ReceiptTextIcon class="size-4" />
            {{ locale.t('billTotalKeseluruhan') }}
          </span>
          <span class="text-base font-bold">{{
            formatRupiah(bill.total)
          }}</span>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
