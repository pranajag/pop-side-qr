<script setup>
import { MinusIcon, PlusIcon } from '@lucide/vue'

defineProps({
  qty: { type: Number, required: true },
  max: { type: Number, default: null },
})
const emit = defineEmits(['update:qty'])
</script>

<template>
  <div class="flex items-center gap-3">
    <button
      type="button"
      class="flex size-11 shrink-0 items-center justify-center rounded-full border border-input active:bg-accent"
      aria-label="Kurangi jumlah"
      @click="emit('update:qty', qty - 1)"
    >
      <MinusIcon class="size-4" />
    </button>
    <span class="w-4 text-center text-sm font-medium tabular-nums">{{ qty }}</span>
    <button
      type="button"
      class="flex size-11 shrink-0 items-center justify-center rounded-full border border-input active:bg-accent disabled:pointer-events-none disabled:opacity-40"
      aria-label="Tambah jumlah"
      :disabled="max !== null && qty >= max"
      @click="emit('update:qty', qty + 1)"
    >
      <PlusIcon class="size-4" />
    </button>
  </div>
</template>
