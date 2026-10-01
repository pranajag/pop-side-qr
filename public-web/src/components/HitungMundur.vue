<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'

// Hitung mundur m:ss sampai waktu `sampai`, lalu memancarkan `habis` sekali.
// Komponen kecil sendiri supaya detak tiap detiknya hanya menggambar ulang
// angka ini, bukan seluruh halaman (menu, struk) tempat ia dipasang.
const props = defineProps({ sampai: { type: [String, Date], required: true } })
const emit = defineEmits(['habis'])

const sekarang = ref(Date.now())
const sisaDetik = computed(() =>
  Math.max(0, Math.ceil((new Date(props.sampai).getTime() - sekarang.value) / 1000))
)
const teks = computed(
  () => `${Math.floor(sisaDetik.value / 60)}:${String(sisaDetik.value % 60).padStart(2, '0')}`
)

let timer = null
let sudahHabis = false
function detak() {
  sekarang.value = Date.now()
  if (sisaDetik.value === 0 && !sudahHabis) {
    sudahHabis = true
    clearInterval(timer)
    emit('habis')
  }
}
onMounted(() => {
  detak()
  if (!sudahHabis) timer = setInterval(detak, 1000)
})
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <span class="tabular-nums">{{ teks }}</span>
</template>
