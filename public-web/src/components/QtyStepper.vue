<script setup>
import { MinusIcon, PlusIcon } from '@lucide/vue'
import { useLocaleStore } from '@/stores/locale'

defineProps({
  qty: { type: Number, required: true },
  max: { type: Number, default: null },
})
const emit = defineEmits(['update:qty'])
const locale = useLocaleStore()
</script>

<template>
  <div class="flex items-center gap-3">
    <button
      type="button"
      class="flex size-11 shrink-0 items-center justify-center rounded-full border border-input transition-colors hover:border-primary/50 hover:bg-accent active:bg-accent"
      :aria-label="locale.t('kurangiJumlah')"
      @click="emit('update:qty', qty - 1)"
    >
      <MinusIcon class="size-4" />
    </button>
    <span class="w-4 text-center text-sm font-medium tabular-nums">{{
      qty
    }}</span>
    <button
      type="button"
      class="flex size-11 shrink-0 items-center justify-center rounded-full border border-input transition-colors hover:border-primary/50 hover:bg-accent active:bg-accent disabled:pointer-events-none disabled:opacity-40"
      :aria-label="locale.t('tambahJumlah')"
      :disabled="max !== null && qty >= max"
      @click="emit('update:qty', qty + 1)"
    >
      <PlusIcon class="size-4" />
    </button>
  </div>
</template>
