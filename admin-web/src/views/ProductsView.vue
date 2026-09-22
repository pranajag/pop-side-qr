<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { toast } from 'vue-sonner'
import { useProductsStore } from '@/stores/products'
import { useCategoriesStore } from '@/stores/categories'
import { formatApiError, API_URL } from '@/lib/api'
import { formatRupiah } from '@/lib/format'
import { stockStatus } from '@/lib/stock'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  PlusIcon,
  PencilIcon,
  Trash2Icon,
  LoaderCircleIcon,
  ImageOffIcon,
  SearchIcon,
} from '@lucide/vue'

const store = useProductsStore()
const categoriesStore = useCategoriesStore()

const searchQuery = ref('')
const filteredItems = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return store.items
  return store.items.filter((p) => p.nama.toLowerCase().includes(q))
})

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
  hargaModal: null,
  stok: 0,
  trackStock: false,
  isAvailable: true,
  foto: undefined,
  variantGroups: [],
})

function newVariantOption() {
  return { nama: '', hargaTambahan: 0 }
}
function newVariantGroup() {
  return {
    nama: '',
    required: false,
    multiple: false,
    options: [newVariantOption()],
  }
}
function addVariantGroup() {
  form.variantGroups.push(newVariantGroup())
}
function removeVariantGroup(groupIdx) {
  form.variantGroups.splice(groupIdx, 1)
}
function addVariantOption(groupIdx) {
  form.variantGroups[groupIdx].options.push(newVariantOption())
}
function removeVariantOption(groupIdx, optionIdx) {
  form.variantGroups[groupIdx].options.splice(optionIdx, 1)
}

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
  form.hargaModal = null
  form.stok = 0
  form.trackStock = false
  form.isAvailable = true
  form.foto = undefined
  form.variantGroups = []
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
  form.hargaModal = product.hargaModal === null || product.hargaModal === undefined ? null : Number(product.hargaModal)
  form.stok = product.stok
  form.trackStock = product.trackStock
  form.isAvailable = product.isAvailable
  form.foto = undefined
  // Deep-cloned so editing in the dialog doesn't mutate the store's live
  // data until Simpan actually round-trips through the API.
  form.variantGroups = (product.variantGroups ?? []).map((g) => ({
    nama: g.nama,
    required: g.required,
    multiple: g.multiple,
    options: g.options.map((o) => ({
      nama: o.nama,
      hargaTambahan: Number(o.hargaTambahan),
    })),
  }))
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

// AlertDialogAction closes the dialog itself on click, which fires our
// @update:open handler and nulls deleteTarget — *before* the @click
// handler below gets its turn, not just racing it. A plain (non-reactive)
// variable set on open and read on confirm sidesteps that entirely,
// since nothing but this file's own code ever touches it.
let pendingDelete = null

function openDelete(product) {
  deleteTarget.value = product
  pendingDelete = product
}

async function onDeleteConfirm() {
  const target = pendingDelete
  if (!target) return

  deleting.value = true
  try {
    await store.remove(target.id)
    toast.success('Produk dihapus')
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    pendingDelete = null
    deleting.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-lg font-semibold tracking-tight">Produk</h1>
        <p class="text-sm text-muted-foreground">
          Kelola menu, harga, dan stok.
        </p>
      </div>
      <Button
        class="gap-2"
        :disabled="categoriesStore.items.length === 0"
        @click="openCreate"
      >
        <PlusIcon class="size-4" />
        Tambah Produk
      </Button>
    </div>
    <p
      v-if="categoriesStore.items.length === 0"
      class="text-sm text-muted-foreground"
    >
      Tambahkan kategori dulu sebelum bisa membuat produk.
    </p>

    <div class="relative max-w-xs">
      <SearchIcon
        class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        v-model="searchQuery"
        placeholder="Cari nama produk..."
        class="pl-8"
      />
    </div>

    <div class="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-14"></TableHead>
            <TableHead>Nama</TableHead>
            <TableHead>Kategori</TableHead>
            <TableHead>Harga</TableHead>
            <TableHead>Modal</TableHead>
            <TableHead>Stok</TableHead>
            <TableHead class="w-28">Status</TableHead>
            <TableHead class="w-28 text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableEmpty
            v-if="!store.loading && filteredItems.length === 0"
            :colspan="8"
          >
            {{
              searchQuery ? 'Tidak ada produk yang cocok.' : 'Belum ada produk.'
            }}
          </TableEmpty>
          <TableRow v-for="p in filteredItems" :key="p.id">
            <TableCell data-label="Foto">
              <img
                v-if="p.foto"
                :src="photoUrl(p.foto)"
                :alt="p.nama"
                class="size-10 rounded-md border object-cover"
              />
              <div
                v-else
                class="flex size-10 items-center justify-center rounded-md border bg-muted"
              >
                <ImageOffIcon class="size-4 text-muted-foreground" />
              </div>
            </TableCell>
            <TableCell class="font-medium" data-label="Nama">{{ p.nama }}</TableCell>
            <TableCell class="text-muted-foreground" data-label="Kategori">{{
              categoryName(p.categoryId)
            }}</TableCell>
            <TableCell data-label="Harga">{{ formatRupiah(p.harga) }}</TableCell>
            <TableCell class="text-muted-foreground" data-label="Modal">
              {{ p.hargaModal !== null && p.hargaModal !== undefined ? formatRupiah(p.hargaModal) : '—' }}
            </TableCell>
            <TableCell data-label="Stok">
              <span
                :class="{
                  'font-semibold text-destructive': stockStatus(p) === 'habis',
                  'font-semibold text-amber-600 dark:text-amber-400':
                    stockStatus(p) === 'menipis',
                }"
              >
                {{ p.trackStock ? p.stok : '—' }}
              </span>
              <Badge
                v-if="stockStatus(p) === 'habis'"
                variant="destructive"
                class="ml-1.5"
                >Habis</Badge
              >
              <Badge
                v-else-if="stockStatus(p) === 'menipis'"
                class="ml-1.5 bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-950"
              >
                Menipis
              </Badge>
            </TableCell>
            <TableCell data-label="Status">
              <Badge :variant="p.isAvailable ? 'default' : 'secondary'">
                {{ p.isAvailable ? 'Tersedia' : 'Nonaktif' }}
              </Badge>
            </TableCell>
            <TableCell class="text-right" data-label="Aksi">
              <Button variant="ghost" size="icon" @click="openEdit(p)">
                <PencilIcon class="size-4" />
              </Button>
              <Button variant="ghost" size="icon" @click="openDelete(p)">
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
          <DialogTitle>{{
            editingId ? 'Ubah Produk' : 'Tambah Produk'
          }}</DialogTitle>
          <DialogDescription>
            Stok hanya dipakai untuk produk berjumlah terbatas; minuman yang
            dibuat on-demand tidak perlu dilacak stoknya.
          </DialogDescription>
        </DialogHeader>
        <form id="product-form" class="space-y-4" @submit.prevent="onSubmit">
          <div class="space-y-2">
            <Label for="kategori">Kategori</Label>
            <Select v-model="form.categoryId">
              <SelectTrigger id="kategori" class="w-full">
                <SelectValue placeholder="Pilih kategori" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="c in categoriesStore.items"
                  :key="c.id"
                  :value="c.id"
                >
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
              <Input
                id="harga"
                v-model.number="form.harga"
                type="number"
                min="0"
                step="1"
                required
              />
            </div>
            <div class="space-y-2">
              <Label for="stok">Stok</Label>
              <Input
                id="stok"
                v-model.number="form.stok"
                type="number"
                min="0"
                step="1"
                :disabled="!form.trackStock"
              />
            </div>
          </div>

          <div class="space-y-2">
            <Label for="hargaModal"
              >Harga Modal / HPP (Rp) <span class="font-normal text-muted-foreground">— opsional</span></Label
            >
            <Input
              id="hargaModal"
              v-model.number="form.hargaModal"
              type="number"
              min="0"
              step="1"
              placeholder="Kosongkan jika belum tahu"
            />
            <p class="text-xs text-muted-foreground">
              Dipakai untuk menghitung margin di Laporan — tidak pernah tampil ke kasir/customer.
            </p>
          </div>

          <div
            class="flex items-center justify-between rounded-md border px-3 py-2"
          >
            <div>
              <Label for="trackStock">Lacak stok</Label>
              <p class="text-xs text-muted-foreground">
                Aktifkan untuk produk dengan stok fisik terbatas.
              </p>
            </div>
            <Switch id="trackStock" v-model="form.trackStock" />
          </div>

          <div
            class="flex items-center justify-between rounded-md border px-3 py-2"
          >
            <Label for="isAvailable">Tersedia</Label>
            <Switch id="isAvailable" v-model="form.isAvailable" />
          </div>

          <div class="space-y-2">
            <Label for="foto">Foto Produk</Label>
            <div class="flex items-center gap-3">
              <img
                v-if="previewUrl"
                :src="previewUrl"
                alt="Preview"
                class="size-16 rounded-md border object-cover"
              />
              <div
                v-else
                class="flex size-16 items-center justify-center rounded-md border bg-muted"
              >
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
            <p class="text-xs text-muted-foreground">
              JPEG, PNG, atau WebP. Maks 2MB. Opsional.
            </p>
          </div>

          <div class="space-y-3 rounded-md border p-3">
            <div class="flex items-center justify-between">
              <Label>Varian</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                class="gap-1.5"
                @click="addVariantGroup"
              >
                <PlusIcon class="size-3.5" />
                Grup Varian
              </Button>
            </div>
            <p
              v-if="form.variantGroups.length === 0"
              class="text-xs text-muted-foreground"
            >
              Opsional. Misal grup "Ukuran" (Regular/Large) atau "Topping"
              (Boba/Jelly).
            </p>

            <div
              v-for="(group, gi) in form.variantGroups"
              :key="gi"
              class="space-y-3 rounded-md border bg-muted/40 p-3"
            >
              <div class="flex items-start gap-2">
                <Input
                  v-model="group.nama"
                  placeholder="Nama grup, mis. Ukuran"
                  required
                  maxlength="100"
                  class="flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  @click="removeVariantGroup(gi)"
                >
                  <Trash2Icon class="size-4" />
                </Button>
              </div>
              <div class="flex flex-wrap gap-4 text-sm">
                <label class="flex items-center gap-2">
                  <Switch v-model="group.required" />
                  Wajib pilih
                </label>
                <label class="flex items-center gap-2">
                  <Switch v-model="group.multiple" />
                  Bisa pilih lebih dari satu
                </label>
              </div>

              <div class="space-y-2">
                <div
                  v-for="(option, oi) in group.options"
                  :key="oi"
                  class="flex items-center gap-2"
                >
                  <Input
                    v-model="option.nama"
                    placeholder="Nama opsi, mis. Large"
                    required
                    maxlength="100"
                    class="flex-1"
                  />
                  <Input
                    v-model.number="option.hargaTambahan"
                    type="number"
                    step="1"
                    placeholder="+0"
                    class="w-28"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    :disabled="group.options.length <= 1"
                    @click="removeVariantOption(gi, oi)"
                  >
                    <Trash2Icon class="size-3.5" />
                  </Button>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  class="gap-1.5"
                  @click="addVariantOption(gi)"
                >
                  <PlusIcon class="size-3.5" />
                  Tambah opsi
                </Button>
              </div>
            </div>
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

    <AlertDialog
      :open="!!deleteTarget"
      @update:open="(v) => !v && (deleteTarget = null)"
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle
            >Hapus produk "{{ deleteTarget?.nama }}"?</AlertDialogTitle
          >
          <AlertDialogDescription>
            Tindakan ini tidak bisa dibatalkan. Produk yang sudah pernah dipesan
            tidak bisa dihapus — nonaktifkan saja lewat status "Tersedia".
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction :disabled="deleting" @click="onDeleteConfirm"
            >Hapus</AlertDialogAction
          >
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
