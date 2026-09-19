<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { formatRupiah } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const props = defineProps({
  open: { type: Boolean, required: true },
  product: { type: Object, default: null },
})
const emit = defineEmits(['update:open', 'confirm'])

// groupId -> array of selected option ids, reset fresh each time a new
// product opens — same convention as public-web's VariantPickerDialog.
const selections = reactive({})
const qty = ref(1)
// Matches order.validator.js's orderItemsSchema qty cap.
const MAX_QTY = 99

watch(
  () => props.product,
  (product) => {
    for (const key of Object.keys(selections)) delete selections[key]
    if (product) {
      for (const group of product.variantGroups) selections[group.id] = []
    }
    qty.value = 1
  },
  { immediate: true }
)

function isSelected(group, optionId) {
  return (selections[group.id] ?? []).includes(optionId)
}

function toggleOption(group, optionId) {
  if (group.multiple) {
    const current = selections[group.id] ?? []
    selections[group.id] = current.includes(optionId)
      ? current.filter((id) => id !== optionId)
      : [...current, optionId]
  } else {
    selections[group.id] = [optionId]
  }
}

const missingRequired = computed(() => {
  if (!props.product) return []
  return props.product.variantGroups.filter(
    (g) => g.required && (selections[g.id]?.length ?? 0) === 0
  )
})
const canConfirm = computed(() => missingRequired.value.length === 0)

const selectedOptionIds = computed(() => Object.values(selections).flat())

const unitPrice = computed(() => {
  if (!props.product) return 0
  const extra = props.product.variantGroups
    .flatMap((g) => g.options)
    .filter((o) => selectedOptionIds.value.includes(o.id))
    .reduce((sum, o) => sum + Number(o.hargaTambahan), 0)
  return Number(props.product.harga) + extra
})
const variantLabel = computed(() => {
  if (!props.product) return ''
  return props.product.variantGroups
    .flatMap((g) => g.options)
    .filter((o) => selectedOptionIds.value.includes(o.id))
    .map((o) => o.nama)
    .join(', ')
})

function onConfirm() {
  if (!canConfirm.value) return
  emit('confirm', {
    product: props.product,
    variantOptionIds: selectedOptionIds.value,
    variantLabel: variantLabel.value,
    qty: qty.value,
    unitPrice: unitPrice.value,
  })
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent v-if="product" class="max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ product.nama }}</DialogTitle>
      </DialogHeader>

      <div class="space-y-4">
        <section
          v-for="group in product.variantGroups"
          :key="group.id"
          class="space-y-2"
        >
          <div class="flex items-center gap-2">
            <h3 class="text-sm font-semibold">{{ group.nama }}</h3>
            <span v-if="group.required" class="text-xs text-destructive"
              >Wajib pilih</span
            >
          </div>

          <div class="space-y-1.5">
            <label
              v-for="option in group.options"
              :key="option.id"
              class="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
            >
              <Checkbox
                v-if="group.multiple"
                :model-value="isSelected(group, option.id)"
                @update:model-value="toggleOption(group, option.id)"
              />
              <input
                v-else
                type="radio"
                class="size-4"
                :name="`group-${group.id}`"
                :checked="isSelected(group, option.id)"
                @change="toggleOption(group, option.id)"
              />
              <span class="flex-1">{{ option.nama }}</span>
              <span
                v-if="Number(option.hargaTambahan) !== 0"
                class="text-xs text-muted-foreground"
              >
                {{ Number(option.hargaTambahan) > 0 ? '+' : ''
                }}{{ formatRupiah(option.hargaTambahan) }}
              </span>
            </label>
          </div>
        </section>

        <div class="flex items-center justify-between border-t pt-3">
          <span class="text-sm font-medium">Jumlah</span>
          <div class="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              type="button"
              @click="qty = Math.max(1, qty - 1)"
              >-</Button
            >
            <span class="w-4 text-center text-sm tabular-nums">{{ qty }}</span>
            <Button
              variant="outline"
              size="icon"
              type="button"
              @click="qty = Math.min(MAX_QTY, qty + 1)"
              >+</Button
            >
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button :disabled="!canConfirm" @click="onConfirm">
          Tambah &middot; {{ formatRupiah(unitPrice * qty) }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
