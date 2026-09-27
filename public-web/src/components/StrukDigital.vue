<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { api, formatApiError } from '@/lib/api'
import { formatTime } from '@/lib/format'
import { buatStruk, keBlob, pdfDariCanvas, unduh } from '@/lib/struk'
import { useLocaleStore } from '@/stores/locale'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { FileTextIcon, ImageIcon, LoaderCircleIcon, ReceiptTextIcon } from '@lucide/vue'

// Struk digital yang otomatis muncul begitu pesanan selesai. Bisa diunduh
// sebagai PDF atau PNG sampai strukBerlakuSampai (api order.service.js
// JENDELA_STRUK_MS) — sesudah itu, atau setelah customer menutupnya di sini,
// pesanan ini tidak bisa dibuka lagi dari web publik.
const props = defineProps({ order: { type: Object, required: true } })

const locale = useLocaleStore()
const router = useRouter()

const toko = ref(null)
const pratinjau = ref(null)
const menyiapkan = ref(true)
const gagal = ref(false)
let canvas = null
let png = null

const batasJam = computed(() =>
  props.order.strukBerlakuSampai ? formatTime(props.order.strukBerlakuSampai) : null
)

// Menggambar ulang setiap kali isinya berubah (bahasa, atau waktu selesai
// yang sebelumnya masih perkiraan dari event realtime).
let urutan = 0
async function siapkan() {
  const ini = ++urutan
  menyiapkan.value = true
  gagal.value = false
  try {
    const hasil = await buatStruk({ order: props.order, toko: toko.value, t: locale.t, bahasa: locale.locale })
    const blob = await keBlob(hasil, 'image/png')
    if (ini !== urutan) return
    canvas = hasil
    png = blob
    if (pratinjau.value) URL.revokeObjectURL(pratinjau.value)
    pratinjau.value = URL.createObjectURL(blob)
  } catch {
    if (ini === urutan) gagal.value = true
  } finally {
    if (ini === urutan) menyiapkan.value = false
  }
}

onMounted(async () => {
  try {
    toko.value = (await api.get('/public/settings')).settings
  } catch {
    // Struk tetap dibuat — tanpa alamat & telepon toko.
  }
  await siapkan()
})
watch(() => [locale.locale, props.order.berakhirPada, props.order.strukBerlakuSampai], siapkan)
onUnmounted(() => {
  urutan += 1
  if (pratinjau.value) URL.revokeObjectURL(pratinjau.value)
})

const namaFile = computed(() => `struk-${props.order.kodeOrder}`)

function unduhPng() {
  if (png) unduh(png, `${namaFile.value}.png`)
}

const membuatPdf = ref(false)
async function unduhPdf() {
  if (!canvas) return
  membuatPdf.value = true
  try {
    unduh(await pdfDariCanvas(canvas, { judul: `Struk ${props.order.kodeOrder}` }), `${namaFile.value}.pdf`)
  } catch {
    toast.error(locale.t('gagalMembuatStruk'))
  } finally {
    membuatPdf.value = false
  }
}

const konfirmasiTutup = ref(false)
const menutup = ref(false)
async function tutup() {
  menutup.value = true
  try {
    await api.post(`/public/orders/${encodeURIComponent(props.order.kodeOrder)}/struk/tutup`)
    toast.success(locale.t('strukDitutup'))
    router.replace({ name: 'menu' })
  } catch (err) {
    // Sudah tidak terikat ke HP ini (ditutup di tab lain / kedaluwarsa) —
    // hasil akhirnya sama dengan yang diminta.
    if (err.status === 404 || err.status === 410) {
      router.replace({ name: 'menu' })
      return
    }
    toast.error(formatApiError(err))
  } finally {
    menutup.value = false
  }
}
</script>

<template>
  <div class="space-y-4 rounded-2xl bg-card p-4 shadow-[0_1px_2px_rgba(13,15,20,0.04)]">
    <div class="flex items-start gap-3">
      <ReceiptTextIcon class="mt-0.5 size-5 shrink-0 text-status-completed" />
      <div class="min-w-0 space-y-0.5">
        <h2 class="text-sm font-semibold">{{ locale.t('strukDigitalJudul') }}</h2>
        <p class="text-xs leading-relaxed text-muted-foreground">
          {{ locale.t('strukDigitalDesc', { jam: batasJam ?? '—' }) }}
        </p>
      </div>
    </div>

    <!-- Selalu kertas putih, di tema gelap sekalipun — sama dengan file yang diunduh. -->
    <div class="overflow-hidden rounded-xl border bg-white">
      <img
        v-if="pratinjau"
        :src="pratinjau"
        :alt="locale.t('strukAlt', { kode: order.kodeOrder })"
        class="mx-auto block w-full max-w-[360px]"
      />
      <div v-else-if="menyiapkan" class="flex h-48 items-center justify-center gap-2 text-xs text-neutral-500">
        <LoaderCircleIcon class="size-4 animate-spin" />
        {{ locale.t('menyiapkanStruk') }}
      </div>
      <p v-else-if="gagal" class="p-6 text-center text-xs text-red-600">
        {{ locale.t('gagalMembuatStruk') }}
      </p>
    </div>

    <div class="grid grid-cols-2 gap-2">
      <Button size="lg" class="h-12 gap-2" :disabled="!pratinjau || membuatPdf" @click="unduhPdf">
        <LoaderCircleIcon v-if="membuatPdf" class="size-4 animate-spin" />
        <FileTextIcon v-else class="size-4" />
        {{ locale.t('unduhPdf') }}
      </Button>
      <Button size="lg" variant="outline" class="h-12 gap-2" :disabled="!pratinjau" @click="unduhPng">
        <ImageIcon class="size-4" />
        {{ locale.t('unduhPng') }}
      </Button>
    </div>

    <button
      type="button"
      class="w-full py-1 text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
      @click="konfirmasiTutup = true"
    >
      {{ locale.t('tutupStruk') }}
    </button>

    <AlertDialog :open="konfirmasiTutup" @update:open="(v) => (konfirmasiTutup = v)">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ locale.t('tutupStrukJudul') }}</AlertDialogTitle>
          <AlertDialogDescription>{{ locale.t('tutupStrukDesc') }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ locale.t('nantiDulu') }}</AlertDialogCancel>
          <AlertDialogAction :disabled="menutup" @click="tutup">
            <LoaderCircleIcon v-if="menutup" class="size-4 animate-spin" />
            {{ locale.t('yaTutupStruk') }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
