<script setup>
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { api, formatApiError } from '@/lib/api'
import { useActiveShiftStore } from '@/stores/activeShift'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { LoaderCircleIcon } from '@lucide/vue'

// Dialog "Mulai Shift" — dipakai halaman Shift, dan halaman yang butuh shift
// berjalan sebelum menerima uang (Reservasi: DP), supaya staff bisa mulai
// shift di tempat tanpa kehilangan isian yang sedang dikerjakan.
//
// Mulai shift wajib menghitung kas awal dulu: "seharusnya di laci" saat
// shift diakhiri tidak ada artinya tanpa tahu isi laci di awal. Nama staff =
// orang yang benar-benar shift, terpisah dari akun login (schema.prisma
// Shift.namaStaff) — akun kasir/admin bisa dipakai bergantian.
const props = defineProps({
  open: { type: Boolean, required: true },
  // Kenapa shift dibutuhkan sekarang (mis. DP yang akan dicatat) — tampil di
  // atas penjelasan kas awal. Kosong = dialog Mulai Shift biasa.
  alasan: { type: String, default: '' },
  labelKonfirmasi: { type: String, default: 'Konfirmasi Mulai Shift' },
  // Jalan lain yang opsional (mis. "Simpan tanpa DP"): tombolnya memancarkan
  // `lewati`, dan halaman pemakainya yang menutup dialog.
  labelLewati: { type: String, default: '' },
})
const emit = defineEmits(['update:open', 'dimulai', 'lewati'])

const activeShiftStore = useActiveShiftStore()
const namaStaff = ref('')
const kasAwal = ref('')
const busy = ref(false)

watch(
  () => props.open,
  (terbuka) => {
    if (!terbuka) return
    namaStaff.value = ''
    kasAwal.value = ''
  }
)

// v-model pada input type="number" bisa berisi Number, bukan string (Vue
// mengubahnya otomatis) — jangan anggap selalu string.
const kasAwalAngka = computed(() => {
  const raw = kasAwal.value
  if (raw === '' || raw === null || raw === undefined) return null
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : null
})

function ubahOpen(v) {
  if (!busy.value) emit('update:open', v)
}

async function onMulai() {
  if (kasAwalAngka.value === null) {
    toast.error('Masukkan jumlah kas awal yang valid')
    return
  }
  if (!namaStaff.value.trim()) {
    toast.error('Masukkan nama staff yang sedang shift')
    return
  }
  busy.value = true
  let lanjut = false
  try {
    await api.post('/admin/shifts/start', {
      cashStart: kasAwalAngka.value,
      namaStaff: namaStaff.value.trim(),
    })
    toast.success('Shift dimulai')
    lanjut = true
  } catch (err) {
    // 409 = shift akun ini ternyata sudah berjalan (dimulai di tab atau
    // perangkat lain sejak halaman ini dimuat) — yang dibutuhkan sudah ada.
    if (err.status === 409) {
      toast.info('Shift kamu ternyata sudah berjalan')
      lanjut = true
    } else {
      toast.error(formatApiError(err))
    }
  }
  if (lanjut) await activeShiftStore.fetch().catch(() => {})
  busy.value = false
  if (!lanjut) return
  // Dipancarkan SEBELUM dialog ditutup: halaman pemakainya langsung
  // menjalankan aksi yang tadi menunggu shift.
  emit('dimulai')
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="open" @update:open="ubahOpen">
    <DialogContent class="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Mulai Shift</DialogTitle>
        <DialogDescription>
          <span v-if="alasan" class="mb-2 block font-medium text-foreground">{{ alasan }}</span>
          Hitung uang kas yang ada di laci sekarang, lalu masukkan jumlahnya. Ini
          dipakai sebagai patokan awal saat rekonsiliasi kas di akhir shift nanti.
          Selama ada shift berjalan, web pelanggan berstatus buka.
        </DialogDescription>
      </DialogHeader>
      <form id="mulai-shift-form" class="space-y-4" @submit.prevent="onMulai">
        <div class="space-y-2">
          <Label for="mulai-shift-nama">Nama Staff yang Shift</Label>
          <Input
            id="mulai-shift-nama"
            v-model="namaStaff"
            maxlength="100"
            placeholder="Mis. Budi"
            autofocus
          />
        </div>
        <div class="space-y-2">
          <Label for="mulai-shift-kas">Uang Kas Awal</Label>
          <Input
            id="mulai-shift-kas"
            v-model="kasAwal"
            type="number"
            inputmode="numeric"
            min="0"
            step="500"
            placeholder="0"
          />
        </div>
      </form>
      <DialogFooter>
        <Button variant="outline" :disabled="busy" @click="ubahOpen(false)">Batal</Button>
        <Button v-if="labelLewati" variant="outline" :disabled="busy" @click="emit('lewati')">
          {{ labelLewati }}
        </Button>
        <Button
          type="submit"
          form="mulai-shift-form"
          :disabled="busy || kasAwalAngka === null || !namaStaff.trim()"
        >
          <LoaderCircleIcon v-if="busy" class="size-4 animate-spin" />
          {{ labelKonfirmasi }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
