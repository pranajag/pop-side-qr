<script setup>
import { onMounted, reactive, ref } from 'vue'
import { toast } from 'vue-sonner'
import { useCustomersStore } from '@/stores/customers'
import { useLoyaltyTiersStore } from '@/stores/loyaltyTiers'
import { useAuthStore } from '@/stores/auth'
import { formatApiError } from '@/lib/api'
import { formatRupiah, formatDateTime } from '@/lib/format'
import { STATUS_LABEL, STATUS_BADGE_CLASS } from '@/lib/orderStatus'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  LoaderCircleIcon,
  SearchIcon,
  StarIcon,
  PlusIcon,
  PencilIcon,
  Trash2Icon,
} from '@lucide/vue'

const store = useCustomersStore()
const auth = useAuthStore()
const searchQuery = ref('')

let searchDebounce = null
function onSearchInput() {
  clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => store.fetchAll(searchQuery.value.trim() || undefined), 250)
}

onMounted(() => {
  store.fetchAll()
  tiersStore.fetchAll()
})

const detailId = ref(null)
const detailData = ref(null)
const detailLoading = ref(false)

async function openDetail(customer) {
  detailId.value = customer.id
  detailData.value = null
  detailLoading.value = true
  try {
    detailData.value = await store.get(customer.id)
  } catch (err) {
    toast.error(formatApiError(err))
    detailId.value = null
  } finally {
    detailLoading.value = false
  }
}

// Tingkatan diskon poin — staff-configurable, admin-only to mutate (kasir
// can view the table so they know what a member qualifies for, but only
// redeems it from ManualOrderView.vue; never edits the tiers themselves).
const tiersStore = useLoyaltyTiersStore()
const MAX_TIER_DISCOUNT_PERCENT = 25

const tierFormOpen = ref(false)
const editingTierId = ref(null)
const tierSubmitting = ref(false)
const tierForm = reactive({ minPoints: '', discountPercent: '' })

function openCreateTier() {
  editingTierId.value = null
  tierForm.minPoints = ''
  tierForm.discountPercent = ''
  tierFormOpen.value = true
}

function openEditTier(tier) {
  editingTierId.value = tier.id
  tierForm.minPoints = tier.minPoints
  tierForm.discountPercent = tier.discountPercent
  tierFormOpen.value = true
}

async function onTierSubmit() {
  tierSubmitting.value = true
  try {
    const payload = {
      minPoints: Number(tierForm.minPoints),
      discountPercent: Number(tierForm.discountPercent),
    }
    if (editingTierId.value) {
      await tiersStore.update(editingTierId.value, payload)
      toast.success('Tingkatan diperbarui')
    } else {
      await tiersStore.create(payload)
      toast.success('Tingkatan ditambahkan')
    }
    tierFormOpen.value = false
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    tierSubmitting.value = false
  }
}

let pendingTierDelete = null
const tierDeleteTarget = ref(null)
const tierDeleting = ref(false)

function openDeleteTier(tier) {
  tierDeleteTarget.value = tier
  pendingTierDelete = tier
}

async function onTierDeleteConfirm() {
  const target = pendingTierDelete
  if (!target) return

  tierDeleting.value = true
  try {
    await tiersStore.remove(target.id)
    toast.success('Tingkatan dihapus')
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    tierDeleting.value = false
    pendingTierDelete = null
  }
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-lg font-semibold tracking-tight">Member</h1>
      <p class="text-sm text-muted-foreground">
        Program loyalitas — poin didapat otomatis dari Pesanan Manual dengan nomor HP diisi.
      </p>
    </div>

    <div class="relative max-w-sm">
      <SearchIcon class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        v-model="searchQuery"
        placeholder="Cari nomor HP atau nama..."
        class="pl-8"
        @input="onSearchInput"
      />
    </div>

    <div class="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>No. HP</TableHead>
            <TableHead>Nama</TableHead>
            <TableHead class="w-28">Poin</TableHead>
            <TableHead class="w-40">Member Sejak</TableHead>
            <TableHead class="w-20"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableEmpty v-if="!store.loading && store.items.length === 0" :colspan="5">
            {{ searchQuery ? 'Tidak ada member yang cocok.' : 'Belum ada member.' }}
          </TableEmpty>
          <TableRow v-for="c in store.items" :key="c.id">
            <TableCell class="font-medium" data-label="No. HP">{{ c.telepon }}</TableCell>
            <TableCell class="text-muted-foreground" data-label="Nama">{{ c.nama || '—' }}</TableCell>
            <TableCell data-label="Poin">
              <span class="flex items-center gap-1 font-semibold text-accent-foreground">
                <StarIcon class="size-3.5 fill-current text-amber-500" />
                {{ c.points }}
              </span>
            </TableCell>
            <TableCell class="text-sm text-muted-foreground" data-label="Member Sejak">{{ formatDateTime(c.createdAt) }}</TableCell>
            <TableCell class="text-right" data-label="Aksi">
              <Button variant="ghost" size="sm" @click="openDetail(c)">Detail</Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <Dialog :open="!!detailId" @update:open="(v) => !v && (detailId = null)">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Member {{ detailData?.telepon }}</DialogTitle>
          <DialogDescription class="sr-only">
            Rincian satu member: poin terkumpul dan riwayat transaksinya.
          </DialogDescription>
        </DialogHeader>
        <div v-if="detailLoading" class="flex justify-center py-8">
          <LoaderCircleIcon class="size-6 animate-spin text-muted-foreground" />
        </div>
        <div v-else-if="detailData" class="space-y-4">
          <div class="flex items-center justify-between rounded-md border p-3">
            <div>
              <p class="font-medium">{{ detailData.nama || 'Tanpa nama' }}</p>
              <p class="text-xs text-muted-foreground">{{ detailData.telepon }}</p>
            </div>
            <span class="flex items-center gap-1.5 text-lg font-bold text-accent-foreground">
              <StarIcon class="size-5 fill-current text-amber-500" />
              {{ detailData.points }}
            </span>
          </div>

          <div>
            <h3 class="mb-2 text-sm font-semibold text-muted-foreground">Riwayat Pesanan</h3>
            <p v-if="detailData.orders.length === 0" class="text-sm text-muted-foreground">
              Belum ada pesanan.
            </p>
            <div v-else class="space-y-2">
              <div
                v-for="o in detailData.orders"
                :key="o.id"
                class="flex items-center justify-between rounded-md border p-2.5 text-sm"
              >
                <div>
                  <p class="font-mono font-medium">{{ o.kodeOrder }}</p>
                  <p class="text-xs text-muted-foreground">{{ formatDateTime(o.createdAt) }}</p>
                </div>
                <div class="text-right">
                  <Badge :class="STATUS_BADGE_CLASS[o.status]">{{ STATUS_LABEL[o.status] }}</Badge>
                  <p class="mt-0.5 text-xs text-muted-foreground">
                    {{ formatRupiah(o.totalHarga) }}
                    <span v-if="o.pointsEarned > 0">· +{{ o.pointsEarned }} poin</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <div class="flex items-center justify-between pt-2">
      <div>
        <h2 class="text-lg font-semibold tracking-tight">Tingkatan Diskon Poin</h2>
        <p class="text-sm text-muted-foreground">
          Poin member bisa ditukar diskon secara opsional saat kasir membuat Pesanan Manual — kasir
          yang memutuskan, bukan otomatis. Maksimal {{ MAX_TIER_DISCOUNT_PERCENT }}% per tingkatan.
        </p>
      </div>
      <Button v-if="auth.isAdmin" class="gap-2" @click="openCreateTier">
        <PlusIcon class="size-4" />
        Tambah Tingkatan
      </Button>
    </div>

    <div class="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Minimal Poin</TableHead>
            <TableHead>Diskon</TableHead>
            <TableHead v-if="auth.isAdmin" class="w-28 text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableEmpty v-if="tiersStore.loaded && tiersStore.items.length === 0" :colspan="auth.isAdmin ? 3 : 2">
            Belum ada tingkatan diskon.
          </TableEmpty>
          <TableRow v-for="t in tiersStore.items" :key="t.id">
            <TableCell class="font-medium" data-label="Minimal Poin">≥ {{ t.minPoints }} poin</TableCell>
            <TableCell class="text-accent-foreground font-semibold" data-label="Diskon">{{ t.discountPercent }}%</TableCell>
            <TableCell v-if="auth.isAdmin" class="text-right" data-label="Aksi">
              <Button variant="ghost" size="icon" @click="openEditTier(t)">
                <PencilIcon class="size-4" />
              </Button>
              <Button variant="ghost" size="icon" @click="openDeleteTier(t)">
                <Trash2Icon class="size-4" />
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <Dialog v-model:open="tierFormOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ editingTierId ? 'Ubah Tingkatan' : 'Tambah Tingkatan' }}</DialogTitle>
          <DialogDescription>
            Member yang poinnya mencapai batas ini otomatis dapat diskon
            sebesar persentase yang kamu tentukan.
          </DialogDescription>
        </DialogHeader>
        <form id="tier-form" class="space-y-4" @submit.prevent="onTierSubmit">
          <div class="space-y-2">
            <Label for="minPoints">Minimal Poin</Label>
            <Input
              id="minPoints"
              v-model.number="tierForm.minPoints"
              type="number"
              min="1"
              step="1"
              required
            />
          </div>
          <div class="space-y-2">
            <Label for="discountPercent">Diskon (%)</Label>
            <Input
              id="discountPercent"
              v-model.number="tierForm.discountPercent"
              type="number"
              min="0"
              :max="MAX_TIER_DISCOUNT_PERCENT"
              step="0.5"
              required
            />
            <p class="text-xs text-muted-foreground">Maksimal {{ MAX_TIER_DISCOUNT_PERCENT }}%.</p>
          </div>
        </form>
        <DialogFooter>
          <Button type="submit" form="tier-form" :disabled="tierSubmitting">
            <LoaderCircleIcon v-if="tierSubmitting" class="size-4 animate-spin" />
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog :open="!!tierDeleteTarget" @update:open="(v) => !v && (tierDeleteTarget = null)">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hapus tingkatan "≥ {{ tierDeleteTarget?.minPoints }} poin"?</AlertDialogTitle>
          <AlertDialogDescription>Tindakan ini tidak bisa dibatalkan.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction :disabled="tierDeleting" @click="onTierDeleteConfirm">Hapus</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
