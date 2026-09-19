<script setup>
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { useTableStore } from '@/stores/table'
import { useLocaleStore } from '@/stores/locale'
import { api, formatApiError } from '@/lib/api'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  GlassWaterIcon,
  UtensilsCrossedIcon,
  MessageCircleQuestionIcon,
  HandIcon,
} from '@lucide/vue'

const props = defineProps({ open: { type: Boolean, required: true } })
const emit = defineEmits(['update:open'])

const table = useTableStore()
const locale = useLocaleStore()
const submitting = ref(false)

const REASONS = computed(() => [
  {
    label: locale.t('mintaAirPutih'),
    icon: GlassWaterIcon,
    catatan: 'Minta air putih',
  },
  {
    label: locale.t('sendokGarpu'),
    icon: UtensilsCrossedIcon,
    catatan: 'Minta sendok/garpu',
  },
  {
    label: locale.t('tanyaSesuatu'),
    icon: MessageCircleQuestionIcon,
    catatan: 'Tanya sesuatu',
  },
  { label: locale.t('lainnya'), icon: HandIcon, catatan: undefined },
])

async function call(reason) {
  if (submitting.value) return
  submitting.value = true
  try {
    await api.post('/public/call-staff', {
      token: table.token,
      catatan: reason.catatan,
    })
    toast.success(locale.t('staffSegeraKeMeja'))
    emit('update:open', false)
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog :open="props.open" @update:open="(v) => emit('update:open', v)">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ locale.t('panggilStaffTitle') }}</DialogTitle>
      </DialogHeader>
      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="reason in REASONS"
          :key="reason.label"
          type="button"
          :disabled="submitting"
          class="flex flex-col items-center gap-2 rounded-lg border p-4 text-center text-sm font-medium transition-colors active:bg-accent disabled:opacity-50"
          @click="call(reason)"
        >
          <component :is="reason.icon" class="size-5 text-brand-cta" />
          {{ reason.label }}
        </button>
      </div>
    </DialogContent>
  </Dialog>
</template>
