<script setup>
import { onMounted, reactive, ref } from 'vue'
import { toast } from 'vue-sonner'
import { useCategoriesStore } from '@/stores/categories'
import { formatApiError } from '@/lib/api'
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
import { PlusIcon, PencilIcon, Trash2Icon, LoaderCircleIcon } from '@lucide/vue'

const store = useCategoriesStore()

const formOpen = ref(false)
const editingId = ref(null)
const submitting = ref(false)
const deleteTarget = ref(null)
const deleting = ref(false)

const form = reactive({ nama: '', urutan: 0, isActive: true })

onMounted(() => store.fetchAll())

function openCreate() {
  editingId.value = null
  form.nama = ''
  form.urutan = store.items.length
  form.isActive = true
  formOpen.value = true
}

function openEdit(category) {
  editingId.value = category.id
  form.nama = category.nama
  form.urutan = category.urutan
  form.isActive = category.isActive
  formOpen.value = true
}

async function onSubmit() {
  submitting.value = true
  try {
    if (editingId.value) {
      await store.update(editingId.value, { ...form })
      toast.success('Kategori diperbarui')
    } else {
      await store.create({ ...form })
      toast.success('Kategori ditambahkan')
    }
    formOpen.value = false
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    submitting.value = false
  }
}

async function onDeleteConfirm() {
  deleting.value = true
  try {
    await store.remove(deleteTarget.value.id)
    toast.success('Kategori dihapus')
    deleteTarget.value = null
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-lg font-semibold tracking-tight">Kategori</h1>
        <p class="text-sm text-muted-foreground">Kelola kategori menu.</p>
      </div>
      <Button class="gap-2" @click="openCreate">
        <PlusIcon class="size-4" />
        Tambah Kategori
      </Button>
    </div>

    <div class="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nama</TableHead>
            <TableHead class="w-24">Urutan</TableHead>
            <TableHead class="w-28">Status</TableHead>
            <TableHead class="w-28 text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableEmpty v-if="!store.loading && store.items.length === 0" :colspan="4">
            Belum ada kategori.
          </TableEmpty>
          <TableRow v-for="cat in store.items" :key="cat.id">
            <TableCell class="font-medium">{{ cat.nama }}</TableCell>
            <TableCell>{{ cat.urutan }}</TableCell>
            <TableCell>
              <Badge :variant="cat.isActive ? 'default' : 'secondary'">
                {{ cat.isActive ? 'Aktif' : 'Nonaktif' }}
              </Badge>
            </TableCell>
            <TableCell class="text-right">
              <Button variant="ghost" size="icon" @click="openEdit(cat)">
                <PencilIcon class="size-4" />
              </Button>
              <Button variant="ghost" size="icon" @click="deleteTarget = cat">
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
          <DialogTitle>{{ editingId ? 'Ubah Kategori' : 'Tambah Kategori' }}</DialogTitle>
        </DialogHeader>
        <form id="category-form" class="space-y-4" @submit.prevent="onSubmit">
          <div class="space-y-2">
            <Label for="nama">Nama</Label>
            <Input id="nama" v-model="form.nama" required maxlength="100" />
          </div>
          <div class="space-y-2">
            <Label for="urutan">Urutan tampil</Label>
            <Input id="urutan" v-model.number="form.urutan" type="number" min="0" required />
          </div>
          <div class="flex items-center justify-between rounded-md border px-3 py-2">
            <Label for="isActive">Aktif</Label>
            <Switch id="isActive" v-model="form.isActive" />
          </div>
        </form>
        <DialogFooter>
          <Button type="submit" form="category-form" :disabled="submitting">
            <LoaderCircleIcon v-if="submitting" class="size-4 animate-spin" />
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog :open="!!deleteTarget" @update:open="(v) => !v && (deleteTarget = null)">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hapus kategori "{{ deleteTarget?.nama }}"?</AlertDialogTitle>
          <AlertDialogDescription>
            Tindakan ini tidak bisa dibatalkan. Kategori yang masih punya produk tidak bisa dihapus.
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
