<script setup>
import { reactiveOmit } from '@vueuse/core'
import { DialogTitle, useForwardProps } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps({
  asChild: { type: Boolean, required: false },
  as: { type: null, required: false },
  class: {
    type: [Boolean, null, String, Object, Array],
    required: false,
    skipCheck: true,
  },
})

const delegatedProps = reactiveOmit(props, 'class')

const forwardedProps = useForwardProps(delegatedProps)
</script>

<!-- pr-6: tombol tutup (X) DialogContent menempel absolut di pojok kanan
atas — judul panjang (nama customer, nomor meja) dulu masuk ke bawahnya di
layar HP. leading-tight supaya judul yang turun baris tetap terbaca. -->
<template>
  <DialogTitle
    data-slot="dialog-title"
    v-bind="forwardedProps"
    :class="
      cn('pr-6 text-base leading-tight font-medium cn-font-heading', props.class)
    "
  >
    <slot />
  </DialogTitle>
</template>
