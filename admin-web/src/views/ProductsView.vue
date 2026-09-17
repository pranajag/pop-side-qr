<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { toast } from 'vue-sonner'
import { useProductsStore } from '@/stores/products'
import { useCategoriesStore } from '@/stores/categories'
import { formatApiError, API_URL } from '@/lib/api'
import { formatRupiah } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
import { PlusIcon, PencilIcon, Trash2Icon, LoaderCircleIcon, ImageOffIcon } from '@lucide/vue'

const store = useProductsStore()
const categoriesStore = useCategoriesStore()

const formOpen = ref(false)
const editingId = ref(null)
const submitting = ref(false)
const deleteTarget = ref(null)
const deleting = ref(false)
// Input.vue is a closed <script setup> component — `ref` on it resolves to
// the component instance, not the native <input>, so it can't be cleared
// via `.value = ''`. Bumping this key remounts it instead, which resets
// the native file picker's displayed filename.
const fileInputKey = ref(0)
const localPreviewUrl = ref(null)

const form = reactive({
  categoryId: null,
  nama: '',
  harga: 0,
  stok: 0,
  trackStock: false,
  isAvailable: true,
  foto: undefined,
})

onMounted(() => {
  store.fetchAll()
  categoriesStore.fetchAll()
})
onBeforeUnmount(clearLocalPreview)

function categoryName(id) {
  return categoriesStore.items.find((c) => c.id === id)?.nama || '—'
}

function photoUrl(filename) {
  return `${API_URL}/public/products/photo/${filename}`
}

function clearLocalPreview() {
  if (localPreviewUrl.value) URL.revokeObjectURL(localPreviewUrl.value)
  localPreviewUrl.value = null
}

const previewUrl = computed(() => {
  if (localPreviewUrl.value) return localPreviewUrl.value
  if (editingId.value) {
    const current = store.items.find((p) => p.id === editingId.value)
    if (current?.foto) return photoUrl(current.foto)
  }
  return null
})

function onFileChange(e) {
  const file = e.target.files?.[0]
  clearLocalPreview()
  if (file) {
    form.foto = file
    localPreviewUrl.value = URL.createObjectURL(file)
  } else {
    form.foto = undefined
  }
}

function resetForm() {
  form.categoryId = categoriesStore.items[0]?.id ?? null
  form.nama = ''
  form.harga = 0
  form.stok = 0
  form.trackStock = false
  form.isAvailable = true
  form.foto = undefined
  clearLocalPreview()
  fileInputKey.value++
}

function openCreate() {
  editingId.value = null
  resetForm()
  formOpen.value = true
}

function openEdit(product) {
  editingId.value = product.id
  form.categoryId = product.categoryId
  form.nama = product.nama
  form.harga = Number(product.harga)
  form.stok = product.stok
  form.trackStock = product.trackStock
  form.isAvailable = product.isAvailable
  form.foto = undefined
  clearLocalPreview()
  fileInputKey.value++
  formOpen.value = true
}

async function onSubmit() {
  submitting.value = true
  try {
    if (editingId.value) {
      await store.update(editingId.value, { ...form })
      toast.success('Produk diperbarui')
    } else {
      await store.create({ ...form })
      toast.success('Produk ditambahkan')
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
    toast.success('Produk dihapus')
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
        <h1 class="text-lg font-semibold tracking-tight">Produk</h1>
        <p class="text-sm text-muted-foreground">Kelola menu, harga, dan stok.</p>
      </div>
      <Button class="gap-2" :disabled="categoriesStore.items.length === 0" @click="openCreate">
        <PlusIcon class="size-4" />
        Tambah Produk
      </Button>
    </div>
    <p v-if="categoriesStore.items.length === 0" class="text-sm text-muted-foreground">
      Tambahkan kategori dulu sebelum bisa membuat produk.
    </p>

    <div class="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-14"></TableHead>
            <TableHead>Nama</TableHead>
            <TableHead>Kategori</TableHead>
            <TableHead>Harga</TableHead>
            <TableHead>Stok</TableHead>
            <TableHead class="w-28">Status</TableHead>
            <TableHead class="w-28 text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableEmpty v-if="!store.loading && store.items.length === 0" :colspan="7">
            Belum ada produk.
          </TableEmpty>
          <TableRow v-for="p in store.items" :key="p.id">
            <TableCell>
              <img
                v-if="p.foto"
                :src="photoUrl(p.foto)"
                :alt="p.nama"
                class="size-10 rounded-md border object-cover"
              />
              <div v-else class="flex size-10 items-center justify-center rounded-md border bg-muted">
                <ImageOffIcon class="size-4 text-muted-foreground" />
              </div>
            </TableCell>
            <TableCell class="font-medium">{{ p.nama }}</TableCell>
            <TableCell class="text-muted-foreground">{{ categoryName(p.categoryId) }}</TableCell>
            <TableCell>{{ formatRupiah(p.harga) }}</TableCell>
            <TableCell>{{ p.trackStock ? p.stok : '—' }}</TableCell>
            <TableCell>
              <Badge :variant="p.isAvailable ? 'default' : 'secondary'">
                {{ p.isAvailable ? 'Tersedia' : 'Nonaktif' }}
              </Badge>
            </TableCell>
            <TableCell class="text-right">
              <Button variant="ghost" size="icon" @click="openEdit(p)">
                <PencilIcon class="size-4" />
              </Button>
              <Button variant="ghost" size="icon" @click="deleteTarget = p">
                <Trash2Icon class="size-4" />
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <Dialog v-model:open="formOpen">
      <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{{ editingId ? 'Ubah Produk' : 'Tambah Produk' }}</DialogTitle>
        </DialogHeader>
        <form id="product-form" class="space-y-4" @submit.prevent="onSubmit">
          <div class="space-y-2">
            <Label for="kategori">Kategori</Label>
            <Select v-model="form.categoryId">
              <SelectTrigger id="kategori" class="w-full">
                <SelectValue placeholder="Pilih kategori" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="c in categoriesStore.items" :key="c.id" :value="c.id">
                  {{ c.nama }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="space-y-2">
            <Label for="nama">Nama Produk</Label>
            <Input id="nama" v-model="form.nama" required maxlength="150" />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-2">
              <Label for="harga">Harga (Rp)</Label>
              <Input id="harga" v-model.number="form.harga" type="number" min="0" step="1" required />
            </div>
            <div class="space-y-2">
              <Label for="stok">Stok</Label>
              <Input id="stok" v-model.number="form.stok" type="number" min="0" step="1" :disabled="!form.trackStock" />
            </div>
          </div>

          <div class="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <Label for="trackStock">Lacak stok</Label>
              <p class="text-xs text-muted-foreground">Aktifkan untuk produk dengan stok fisik terbatas.</p>
            </div>
            <Switch id="trackStock" v-model="form.trackStock" />
          </div>

          <div class="flex items-center justify-between rounded-md border px-3 py-2">
            <Label for="isAvailable">Tersedia</Label>
            <Switch id="isAvailable" v-model="form.isAvailable" />
          </div>

          <div class="space-y-2">
            <Label for="foto">Foto Produk</Label>
            <div class="flex items-center gap-3">
              <img v-if="previewUrl" :src="previewUrl" alt="Preview" class="size-16 rounded-md border object-cover" />
              <div v-else class="flex size-16 items-center justify-center rounded-md border bg-muted">
                <ImageOffIcon class="size-5 text-muted-foreground" />
              </div>
              <input
                :key="fileInputKey"
                id="foto"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                class="min-w-0 flex-1 text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-2.5 file:py-1 file:text-sm file:font-medium file:text-foreground"
                @change="onFileChange"
              />
            </div>
            <p class="text-xs text-muted-foreground">JPEG, PNG, atau WebP. Maks 2MB. Opsional.</p>
          </div>
        </form>
        <DialogFooter>
          <Button type="submit" form="product-form" :disabled="submitting">
            <LoaderCircleIcon v-if="submitting" class="size-4 animate-spin" />
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog :open="!!deleteTarget" @update:open="(v) => !v && (deleteTarget = null)">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hapus produk "{{ deleteTarget?.nama }}"?</AlertDialogTitle>
          <AlertDialogDescription>
            Tindakan ini tidak bisa dibatalkan. Produk yang sudah pernah dipesan tidak bisa dihapus — nonaktifkan
            saja lewat status "Tersedia".
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
