<script setup>
import { computed } from 'vue'
import { useTableStore } from '@/stores/table'
import { useLocaleStore } from '@/stores/locale'
import { teksReservasi } from '@/lib/reservasi'
import { CalendarClockIcon } from '@lucide/vue'

// Meja yang sedang (atau sebentar lagi) dipakai reservasi. Sejak 1 Oktober
// (permintaan client), reservasi TERKONFIRMASI mengunci QR meja yang
// tertempel: customer lain hanya bisa melihat menu, rombongannya memesan
// lewat QR rombongan dari kasir (api reservation.service.js aksesMejaPublik).
// Reservasi yang belum dikonfirmasi tetap sekadar pemberitahuan.
const table = useTableStore()
const locale = useLocaleStore()

const info = computed(() => teksReservasi(locale, table.nomorMeja, table.reservasi))
</script>

<template>
  <div
    v-if="info"
    role="status"
    class="flex gap-3 rounded-xl border p-3.5"
    :class="{
      'border-destructive/40 bg-destructive/10': info.jenis === 'terkunci',
      'border-status-completed/50 bg-status-completed/10': info.jenis === 'rombongan',
      'border-status-waiting-verif/50 bg-status-waiting-verif/10': info.jenis === 'info',
    }"
  >
    <CalendarClockIcon
      class="mt-0.5 size-4 shrink-0"
      :class="{
        'text-destructive': info.jenis === 'terkunci',
        'text-status-completed': info.jenis === 'rombongan',
        'text-status-waiting-verif': info.jenis === 'info',
      }"
    />
    <div class="min-w-0">
      <p class="text-sm font-semibold">{{ info.judul }}</p>
      <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
        {{ info.isi }}
      </p>
    </div>
  </div>
</template>
