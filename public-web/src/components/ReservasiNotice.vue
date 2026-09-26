<script setup>
import { computed } from 'vue'
import { useTableStore } from '@/stores/table'
import { useLocaleStore } from '@/stores/locale'
import { teksReservasi } from '@/lib/reservasi'
import { CalendarClockIcon } from '@lucide/vue'

// Meja yang sedang (atau sebentar lagi) dipakai reservasi. Tidak memblokir
// pesanan — rombongan reservasi itu sendiri memesan lewat QR meja yang sama,
// dan sistem tidak bisa membedakan siapa yang scan. Yang bisa dilakukan:
// memastikan customer yang datang langsung tahu sebelum memesan, supaya
// bisa pindah meja atau memanggil staff.
const table = useTableStore()
const locale = useLocaleStore()

const info = computed(() => teksReservasi(locale, table.nomorMeja, table.reservasi))
</script>

<template>
  <div
    v-if="info"
    role="status"
    class="flex gap-3 rounded-xl border border-status-waiting-verif/50 bg-status-waiting-verif/10 p-3.5"
  >
    <CalendarClockIcon class="mt-0.5 size-4 shrink-0 text-status-waiting-verif" />
    <div class="min-w-0">
      <p class="text-sm font-semibold">{{ info.judul }}</p>
      <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
        {{ info.isi }}
      </p>
    </div>
  </div>
</template>
