<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useCartStore } from '@/stores/cart'
import { formatRupiah } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import QtyStepper from '@/components/QtyStepper.vue'

const props = defineProps({
  open: { type: Boolean, required: true },
  product: { type: Object, default: null },
})
const emit = defineEmits(['update:open'])

const cart = useCartStore()

// groupId -> array of selected option ids. Reset fresh every time a new
// product opens, not pre-loaded from any existing matching cart line —
// each open of this dialog represents one new "add to cart" action.
const selections = reactive({})
const qty = ref(1)
const catatan = ref('')

watch(
  () => props.product,
  (product) => {
    for (const key of Object.keys(selections)) delete selections[key]
    if (product) {
      for (const group of product.variantGroups) selections[group.id] = []
    }
    qty.value = 1
    catatan.value = ''
  },
  { immediate: true }
)

function isSelected(group, optionId) {
  return (selections[group.id] ?? []).includes(optionId)
}

function toggleOption(group, optionId) {
  if (group.multiple) {
    const current = selections[group.id] ?? []
    selections[group.id] = current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId]
  } else {
    selections[group.id] = [optionId]
  }
}

const missingRequired = computed(() => {
  if (!props.product) return []
  return props.product.variantGroups.filter((g) => g.required && (selections[g.id]?.length ?? 0) === 0)
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

function onConfirm() {
  if (!canConfirm.value) return
  const existingQty = cart.qtyFor(props.product.id, selectedOptionIds.value)
  cart.setQty(props.product.id, selectedOptionIds.value, existingQty + qty.value)
  if (catatan.value) cart.setNote(props.product.id, selectedOptionIds.value, catatan.value)
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => emit('update:open', v)">
    <DialogContent v-if="product" class="max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ product.nama }}</DialogTitle>
      </DialogHeader>

      <div class="space-y-5">
        <section v-for="group in product.variantGroups" :key="group.id" class="space-y-2">
          <div class="flex items-center gap-2">
            <h3 class="text-sm font-semibold">{{ group.nama }}</h3>
            <span v-if="group.required" class="text-xs text-destructive">Wajib pilih</span>
          </div>

          <div v-if="group.multiple" class="space-y-2">
            <label
              v-for="option in group.options"
              :key="option.id"
              class="flex items-center gap-3 rounded-lg border px-3 py-2.5"
            >
              <Checkbox :model-value="isSelected(group, option.id)" @update:model-value="toggleOption(group, option.id)" />
              <span class="flex-1 text-sm">{{ option.nama }}</span>
              <span v-if="Number(option.hargaTambahan) !== 0" class="text-xs text-muted-foreground">
                {{ Number(option.hargaTambahan) > 0 ? '+' : '' }}{{ formatRupiah(option.hargaTambahan) }}
              </span>
            </label>
          </div>
          <div v-else class="space-y-2">
            <label
              v-for="option in group.options"
              :key="option.id"
              class="flex items-center gap-3 rounded-lg border px-3 py-2.5"
            >
              <input
                type="radio"
                class="size-4 accent-brand-cta"
                :name="`group-${group.id}`"
                :checked="isSelected(group, option.id)"
                @change="toggleOption(group, option.id)"
              />
              <span class="flex-1 text-sm">{{ option.nama }}</span>
              <span v-if="Number(option.hargaTambahan) !== 0" class="text-xs text-muted-foreground">
                {{ Number(option.hargaTambahan) > 0 ? '+' : '' }}{{ formatRupiah(option.hargaTambahan) }}
              </span>
            </label>
          </div>
        </section>

        <section class="flex items-center justify-between border-t pt-4">
          <span class="text-sm font-medium">Jumlah</span>
          <QtyStepper :qty="qty" @update:qty="(q) => (qty = Math.max(1, q))" />
        </section>
      </div>

      <DialogFooter>
        <Button class="h-11 w-full bg-brand-cta text-heading hover:bg-brand-cta/90" :disabled="!canConfirm" @click="onConfirm">
          Tambah &middot; {{ formatRupiah(unitPrice * qty) }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
