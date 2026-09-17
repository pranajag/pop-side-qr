<script setup>
import { onMounted, reactive, ref } from 'vue'
import { toast } from 'vue-sonner'
import { useTablesStore } from '@/stores/tables'
import { formatApiError, API_URL } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
import { PlusIcon, PencilIcon, Trash2Icon, LoaderCircleIcon, QrCodeIcon, CopyIcon, RefreshCwIcon, PrinterIcon } from '@lucide/vue'

const store = useTablesStore()

const formOpen = ref(false)
const editingId = ref(null)
const submitting = ref(false)
const deleteTarget = ref(null)
const deleting = ref(false)
const qrTarget = ref(null)
const resetting = ref(false)

const form = reactive({ nomorMeja: '', isActive: true })

onMounted(() => store.fetchAll())

function qrImageUrl(table) {
  // qrToken in the query string busts the browser cache after a reset —
  // same path, new token, must not reuse the stale cached PNG.
  return `${API_URL}/admin/tables/${table.id}/qr?v=${table.qrToken}`
}

function openCreate() {
  editingId.value = null
  form.nomorMeja = ''
  form.isActive = true
  formOpen.value = true
}

function openEdit(table) {
  editingId.value = table.id
  form.nomorMeja = table.nomorMeja
  form.isActive = table.isActive
  formOpen.value = true
}

async function onSubmit() {
  submitting.value = true
  try {
    if (editingId.value) {
      await store.update(editingId.value, { ...form })
      toast.success('Meja diperbarui')
    } else {
      await store.create({ ...form })
      toast.success('Meja ditambahkan')
    }
    formOpen.value = false
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    submitting.value = false
  }
}

// AlertDialogAction closes the dialog itself on click, which fires our
// @update:open handler and nulls deleteTarget — *before* the @click
// handler below gets its turn, not just racing it. A plain (non-reactive)
// variable set on open and read on confirm sidesteps that entirely,
// since nothing but this file's own code ever touches it.
let pendingDelete = null

function openDelete(table) {
  deleteTarget.value = table
  pendingDelete = table
}

async function onDeleteConfirm() {
  const target = pendingDelete
  if (!target) return

  deleting.value = true
  try {
    await store.remove(target.id)
    toast.success('Meja dihapus')
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    pendingDelete = null
    deleting.value = false
  }
}

async function onResetToken(table) {
  resetting.value = true
  try {
    await store.resetToken(table.id)
    qrTarget.value = store.items.find((t) => t.id === table.id)
    toast.success('QR meja diperbarui. QR lama tidak berlaku lagi.')
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    resetting.value = false
  }
}

async function copyLink(table) {
  try {
    await navigator.clipboard.writeText(table.url)
    toast.success('Link disalin')
  } catch {
    toast.error('Gagal menyalin link')
  }
}

function printQr() {
  window.print()
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-lg font-semibold tracking-tight">Meja</h1>
        <p class="text-sm text-muted-foreground">Kelola meja dan QR code untuk dicetak.</p>
      </div>
      <Button class="gap-2" @click="openCreate">
        <PlusIcon class="size-4" />
        Tambah Meja
      </Button>
    </div>

    <div class="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nomor Meja</TableHead>
            <TableHead class="w-28">Status</TableHead>
            <TableHead class="w-40">QR Code</TableHead>
            <TableHead class="w-36 text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableEmpty v-if="!store.loading && store.items.length === 0" :colspan="4">
            Belum ada meja.
          </TableEmpty>
          <TableRow v-for="t in store.items" :key="t.id">
            <TableCell class="font-medium">{{ t.nomorMeja }}</TableCell>
            <TableCell>
              <Badge :variant="t.isActive ? 'default' : 'secondary'">
                {{ t.isActive ? 'Aktif' : 'Nonaktif' }}
              </Badge>
            </TableCell>
            <TableCell>
              <button
                type="button"
                class="flex items-center gap-2 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
                @click="qrTarget = t"
              >
                <QrCodeIcon class="size-4" />
                Lihat / Cetak
              </button>
            </TableCell>
            <TableCell class="text-right">
              <Button variant="ghost" size="icon" @click="openEdit(t)">
                <PencilIcon class="size-4" />
              </Button>
              <Button variant="ghost" size="icon" @click="openDelete(t)">
                <Trash2Icon class="size-4" />
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <Dialog v-model:open="formOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ editingId ? 'Ubah Meja' : 'Tambah Meja' }}</DialogTitle>
        </DialogHeader>
        <form id="table-form" class="space-y-4" @submit.prevent="onSubmit">
          <div class="space-y-2">
            <Label for="nomorMeja">Nomor Meja</Label>
            <Input id="nomorMeja" v-model="form.nomorMeja" required maxlength="20" />
          </div>
          <div class="flex items-center justify-between rounded-md border px-3 py-2">
            <Label for="isActive">Aktif</Label>
            <Switch id="isActive" v-model="form.isActive" />
          </div>
        </form>
        <DialogFooter>
          <Button type="submit" form="table-form" :disabled="submitting">
            <LoaderCircleIcon v-if="submitting" class="size-4 animate-spin" />
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog :open="!!qrTarget" @update:open="(v) => !v && (qrTarget = null)">
      <DialogContent class="print:border-0 print:shadow-none">
        <DialogHeader>
          <DialogTitle>QR Meja {{ qrTarget?.nomorMeja }}</DialogTitle>
        </DialogHeader>
        <div v-if="qrTarget" class="flex flex-col items-center gap-4 py-2">
          <img :src="qrImageUrl(qrTarget)" :alt="`QR meja ${qrTarget.nomorMeja}`" class="size-64" />
          <p class="break-all text-center text-xs text-muted-foreground">{{ qrTarget.url }}</p>
        </div>
        <DialogFooter class="print:hidden">
          <Button variant="outline" class="gap-2" @click="copyLink(qrTarget)">
            <CopyIcon class="size-4" />
            Salin Link
          </Button>
          <Button variant="outline" class="gap-2" :disabled="resetting" @click="onResetToken(qrTarget)">
            <RefreshCwIcon class="size-4" :class="{ 'animate-spin': resetting }" />
            Reset QR
          </Button>
          <Button class="gap-2" @click="printQr">
            <PrinterIcon class="size-4" />
            Cetak
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog :open="!!deleteTarget" @update:open="(v) => !v && (deleteTarget = null)">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hapus meja "{{ deleteTarget?.nomorMeja }}"?</AlertDialogTitle>
          <AlertDialogDescription>
            Tindakan ini tidak bisa dibatalkan. Meja yang sudah punya riwayat order tidak bisa dihapus — nonaktifkan
            saja.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction :disabled="deleting" @click="onDeleteConfirm">Hapus</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
