<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { useSettingsStore } from '@/stores/settings'
import { api, formatApiError, API_URL } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
import {
  ImageOffIcon,
  LoaderCircleIcon,
  KeyIcon,
  WebhookIcon,
  CopyIcon,
  Trash2Icon,
  PlusIcon,
} from '@lucide/vue'

const store = useSettingsStore()

// --- API Keys & Webhooks ("API & Integrasi") ---
const apiKeys = ref([])
const newApiKeyName = ref('')
const creatingApiKey = ref(false)
// Shown exactly once, right after creation — never retrievable again after
// this, same as the backend never stores anything but its hash.
const justCreatedKey = ref(null)

const webhooks = ref([])
const availableEvents = ref([])
const newWebhookUrl = ref('')
const newWebhookEvents = ref([])
const creatingWebhook = ref(false)
const justCreatedWebhookSecret = ref(null)

const EVENT_LABEL = {
  'order.created': 'Order baru dibuat',
  'order.status_changed': 'Status order berubah',
}

async function loadIntegrations() {
  try {
    const [keysData, webhooksData] = await Promise.all([
      api.get('/admin/api-keys'),
      api.get('/admin/webhooks'),
    ])
    apiKeys.value = keysData.apiKeys
    webhooks.value = webhooksData.webhooks
    availableEvents.value = webhooksData.availableEvents
  } catch (err) {
    toast.error(formatApiError(err))
  }
}

async function createApiKey() {
  if (!newApiKeyName.value.trim()) return
  creatingApiKey.value = true
  try {
    const data = await api.post('/admin/api-keys', { nama: newApiKeyName.value.trim() })
    justCreatedKey.value = data.apiKey
    newApiKeyName.value = ''
    await loadIntegrations()
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    creatingApiKey.value = false
  }
}

async function revokeApiKey(key) {
  try {
    await api.post(`/admin/api-keys/${key.id}/revoke`)
    toast.success(`API key "${key.nama}" dicabut`)
    await loadIntegrations()
  } catch (err) {
    toast.error(formatApiError(err))
  }
}

function toggleEvent(event) {
  const idx = newWebhookEvents.value.indexOf(event)
  if (idx === -1) newWebhookEvents.value.push(event)
  else newWebhookEvents.value.splice(idx, 1)
}

async function createWebhook() {
  if (!newWebhookUrl.value.trim() || newWebhookEvents.value.length === 0) {
    toast.error('Isi URL dan pilih minimal 1 event')
    return
  }
  creatingWebhook.value = true
  try {
    const data = await api.post('/admin/webhooks', {
      url: newWebhookUrl.value.trim(),
      events: newWebhookEvents.value,
    })
    justCreatedWebhookSecret.value = data.webhook.secret
    newWebhookUrl.value = ''
    newWebhookEvents.value = []
    await loadIntegrations()
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    creatingWebhook.value = false
  }
}

async function deleteWebhook(webhook) {
  try {
    await api.del(`/admin/webhooks/${webhook.id}`)
    toast.success('Webhook dihapus')
    await loadIntegrations()
  } catch (err) {
    toast.error(formatApiError(err))
  }
}

async function toggleWebhookActive(webhook) {
  try {
    await api.put(`/admin/webhooks/${webhook.id}`, { isActive: !webhook.isActive })
    await loadIntegrations()
  } catch (err) {
    toast.error(formatApiError(err))
  }
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('Disalin')
  } catch {
    toast.error('Gagal menyalin — salin manual')
  }
}

const fileInputKey = ref(0)
const selectedFile = ref(null)
const localPreviewUrl = ref(null)
const submitting = ref(false)
const saveConfirmOpen = ref(false)

onMounted(() => {
  store.fetchSettings()
  loadIntegrations()
})
onBeforeUnmount(clearLocalPreview)

function clearLocalPreview() {
  if (localPreviewUrl.value) URL.revokeObjectURL(localPreviewUrl.value)
  localPreviewUrl.value = null
}

function qrisUrl(filename) {
  return `${API_URL}/public/settings/qris-photo/${filename}`
}

const previewUrl = computed(
  () =>
    localPreviewUrl.value || (store.qrisImage ? qrisUrl(store.qrisImage) : null)
)

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
  <div class="max-w-2xl space-y-6">
    <div>
      <h1 class="text-lg font-semibold tracking-tight">Pengaturan</h1>
      <p class="text-sm text-muted-foreground">
        Gambar QRIS statis yang ditampilkan ke customer saat checkout.
      </p>
    </div>

    <div class="space-y-4 rounded-lg border bg-card p-6">
      <div class="flex items-center justify-center">
        <img
          v-if="previewUrl"
          :src="previewUrl"
          alt="QRIS"
          class="max-h-64 rounded-lg border object-contain"
        />
        <div
          v-else
          class="flex h-48 w-48 items-center justify-center rounded-lg border bg-muted"
        >
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
        <p class="text-xs text-muted-foreground">
          JPEG, PNG, atau WebP. Maks 2MB.
        </p>
      </div>

      <Button
        :disabled="!selectedFile || submitting"
        @click="saveConfirmOpen = true"
      >
        <LoaderCircleIcon v-if="submitting" class="size-4 animate-spin" />
        Simpan
      </Button>
    </div>

    <div class="space-y-4 rounded-lg border bg-card p-6">
      <div>
        <h2 class="flex items-center gap-2 text-sm font-semibold">
          <KeyIcon class="size-4" />
          API Keys
        </h2>
        <p class="mt-1 text-xs text-muted-foreground">
          Untuk tool eksternal (akuntansi, inventory, dll) membaca data toko lewat
          <code class="rounded bg-muted px-1 py-0.5">GET /api/external/v1/orders</code> dan
          <code class="rounded bg-muted px-1 py-0.5">/products</code>, header
          <code class="rounded bg-muted px-1 py-0.5">Authorization: Bearer &lt;key&gt;</code>.
        </p>
      </div>

      <div v-if="justCreatedKey" class="space-y-2 rounded-md border border-status-completed bg-status-completed/10 p-3">
        <p class="text-xs font-medium text-status-completed">
          Simpan key ini sekarang — tidak akan ditampilkan lagi setelah ini ditutup.
        </p>
        <div class="flex items-center gap-2">
          <code class="flex-1 overflow-x-auto rounded bg-background px-2 py-1.5 text-xs">{{ justCreatedKey.rawKey }}</code>
          <Button variant="outline" size="icon" class="size-8 shrink-0" @click="copyToClipboard(justCreatedKey.rawKey)">
            <CopyIcon class="size-3.5" />
          </Button>
        </div>
        <Button variant="ghost" size="sm" @click="justCreatedKey = null">Tutup</Button>
      </div>

      <div class="space-y-2">
        <div v-for="k in apiKeys" :key="k.id" class="flex items-center justify-between rounded-md border p-2.5 text-sm">
          <div>
            <p class="font-medium">
              {{ k.nama }}
              <span class="font-mono text-xs text-muted-foreground">...{{ k.keySuffix }}</span>
            </p>
            <p class="text-xs text-muted-foreground">
              {{ k.revokedAt ? 'Dicabut' : k.lastUsedAt ? `Terakhir dipakai ${new Date(k.lastUsedAt).toLocaleString('id-ID')}` : 'Belum pernah dipakai' }}
            </p>
          </div>
          <Badge v-if="k.revokedAt" variant="secondary">Dicabut</Badge>
          <Button v-else variant="ghost" size="sm" class="text-destructive" @click="revokeApiKey(k)">Cabut</Button>
        </div>
        <p v-if="apiKeys.length === 0" class="text-sm text-muted-foreground">Belum ada API key.</p>
      </div>

      <div class="flex gap-2">
        <Input v-model="newApiKeyName" placeholder="Nama integrasi, mis. Aplikasi Akuntansi" maxlength="100" />
        <Button :disabled="creatingApiKey || !newApiKeyName.trim()" class="shrink-0 gap-1.5" @click="createApiKey">
          <LoaderCircleIcon v-if="creatingApiKey" class="size-4 animate-spin" />
          <PlusIcon v-else class="size-4" />
          Buat
        </Button>
      </div>
    </div>

    <div class="space-y-4 rounded-lg border bg-card p-6">
      <div>
        <h2 class="flex items-center gap-2 text-sm font-semibold">
          <WebhookIcon class="size-4" />
          Webhook
        </h2>
        <p class="mt-1 text-xs text-muted-foreground">
          Kirim notifikasi otomatis ke URL eksternal saat order baru dibuat atau status berubah. URL harus https://.
        </p>
      </div>

      <div v-if="justCreatedWebhookSecret" class="space-y-2 rounded-md border border-status-completed bg-status-completed/10 p-3">
        <p class="text-xs font-medium text-status-completed">
          Simpan secret ini sekarang — dipakai untuk verifikasi signature (header X-Popside-Signature), tidak ditampilkan lagi.
        </p>
        <div class="flex items-center gap-2">
          <code class="flex-1 overflow-x-auto rounded bg-background px-2 py-1.5 text-xs">{{ justCreatedWebhookSecret }}</code>
          <Button variant="outline" size="icon" class="size-8 shrink-0" @click="copyToClipboard(justCreatedWebhookSecret)">
            <CopyIcon class="size-3.5" />
          </Button>
        </div>
        <Button variant="ghost" size="sm" @click="justCreatedWebhookSecret = null">Tutup</Button>
      </div>

      <div class="space-y-2">
        <div v-for="w in webhooks" :key="w.id" class="flex items-center justify-between gap-2 rounded-md border p-2.5 text-sm">
          <div class="min-w-0">
            <p class="truncate font-mono text-xs font-medium">{{ w.url }}</p>
            <p class="text-xs text-muted-foreground">{{ w.events.map((e) => EVENT_LABEL[e] || e).join(', ') }}</p>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <Badge :variant="w.isActive ? 'default' : 'secondary'" class="cursor-pointer" @click="toggleWebhookActive(w)">
              {{ w.isActive ? 'Aktif' : 'Nonaktif' }}
            </Badge>
            <Button variant="ghost" size="icon" class="size-7 text-destructive" @click="deleteWebhook(w)">
              <Trash2Icon class="size-3.5" />
            </Button>
          </div>
        </div>
        <p v-if="webhooks.length === 0" class="text-sm text-muted-foreground">Belum ada webhook.</p>
      </div>

      <div class="space-y-2 border-t pt-3">
        <Input v-model="newWebhookUrl" placeholder="https://example.com/webhook" maxlength="500" />
        <div class="flex flex-wrap gap-3">
          <label v-for="e in availableEvents" :key="e" class="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              :checked="newWebhookEvents.includes(e)"
              class="size-4 rounded border-input"
              @change="toggleEvent(e)"
            />
            {{ EVENT_LABEL[e] || e }}
          </label>
        </div>
        <Button :disabled="creatingWebhook" size="sm" class="gap-1.5" @click="createWebhook">
          <LoaderCircleIcon v-if="creatingWebhook" class="size-4 animate-spin" />
          <PlusIcon v-else class="size-4" />
          Tambah Webhook
        </Button>
      </div>
    </div>

    <AlertDialog
      :open="saveConfirmOpen"
      @update:open="(v) => (saveConfirmOpen = v)"
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ganti gambar QRIS?</AlertDialogTitle>
          <AlertDialogDescription>
            Gambar ini akan langsung tampil ke SEMUA customer yang checkout QRIS
            mulai sekarang. Pastikan ini QRIS yang benar sebelum menyimpan.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction :disabled="submitting" @click="onSave"
            >Ya, Simpan</AlertDialogAction
          >
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
