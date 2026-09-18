<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { useSettingsStore } from '@/stores/settings'
import { formatApiError, API_URL } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
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
import { ImageOffIcon, LoaderCircleIcon } from '@lucide/vue'

const store = useSettingsStore()

const fileInputKey = ref(0)
const selectedFile = ref(null)
const localPreviewUrl = ref(null)
const submitting = ref(false)
const saveConfirmOpen = ref(false)

onMounted(() => store.fetchSettings())
onBeforeUnmount(clearLocalPreview)

function clearLocalPreview() {
  if (localPreviewUrl.value) URL.revokeObjectURL(localPreviewUrl.value)
  localPreviewUrl.value = null
}

function qrisUrl(filename) {
  return `${API_URL}/public/settings/qris-photo/${filename}`
}

const previewUrl = computed(() => localPreviewUrl.value || (store.qrisImage ? qrisUrl(store.qrisImage) : null))

function onFileChange(e) {
  const file = e.target.files?.[0]
  clearLocalPreview()
  if (file) {
    selectedFile.value = file
    localPreviewUrl.value = URL.createObjectURL(file)
  } else {
    selectedFile.value = null
  }
}

async function onSave() {
  if (!selectedFile.value) return
  saveConfirmOpen.value = false
  submitting.value = true
  try {
    await store.updateQris(selectedFile.value)
    toast.success('Gambar QRIS diperbarui')
    selectedFile.value = null
    clearLocalPreview()
    fileInputKey.value++
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="max-w-lg space-y-6">
    <div>
      <h1 class="text-lg font-semibold tracking-tight">Pengaturan</h1>
      <p class="text-sm text-muted-foreground">Gambar QRIS statis yang ditampilkan ke customer saat checkout.</p>
    </div>

    <div class="space-y-4 rounded-lg border bg-card p-6">
      <div class="flex items-center justify-center">
        <img
          v-if="previewUrl"
          :src="previewUrl"
          alt="QRIS"
          class="max-h-64 rounded-lg border object-contain"
        />
        <div v-else class="flex h-48 w-48 items-center justify-center rounded-lg border bg-muted">
          <ImageOffIcon class="size-6 text-muted-foreground" />
        </div>
      </div>

      <div class="space-y-2">
        <Label for="qris">Ganti gambar QRIS</Label>
        <input
          :key="fileInputKey"
          id="qris"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          class="w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-2.5 file:py-1 file:text-sm file:font-medium file:text-foreground"
          @change="onFileChange"
        />
        <p class="text-xs text-muted-foreground">JPEG, PNG, atau WebP. Maks 2MB.</p>
      </div>

      <Button :disabled="!selectedFile || submitting" @click="saveConfirmOpen = true">
        <LoaderCircleIcon v-if="submitting" class="size-4 animate-spin" />
        Simpan
      </Button>
    </div>

    <AlertDialog :open="saveConfirmOpen" @update:open="(v) => (saveConfirmOpen = v)">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ganti gambar QRIS?</AlertDialogTitle>
          <AlertDialogDescription>
            Gambar ini akan langsung tampil ke SEMUA customer yang checkout QRIS mulai sekarang. Pastikan ini QRIS
            yang benar sebelum menyimpan.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction :disabled="submitting" @click="onSave">Ya, Simpan</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
