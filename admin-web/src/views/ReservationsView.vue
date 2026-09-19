<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { useReservationsStore } from '@/stores/reservations'
import { useTablesStore } from '@/stores/tables'
import { formatApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  CalendarClockIcon,
} from '@lucide/vue'

const store = useReservationsStore()
const tables = useTablesStore()

const formOpen = ref(false)
const editingId = ref(null)
const submitting = ref(false)
const deleteTarget = ref(null)
const deleting = ref(false)
const statusBusyId = ref(null)

const FILTERS = [
  { value: undefined, label: 'Aktif' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Dikonfirmasi' },
  { value: 'completed', label: 'Selesai' },
  { value: 'cancelled', label: 'Dibatalkan' },
  { value: 'all', label: 'Semua' },
]

const STATUS_LABEL = {
  pending: 'Pending',
  confirmed: 'Dikonfirmasi',
  cancelled: 'Dibatalkan',
  completed: 'Selesai',
}
const STATUS_VARIANT = {
  pending: 'secondary',
  confirmed: 'default',
  cancelled: 'destructive',
  completed: 'outline',
}

// "Aktif" (the default filter) means store.statusFilter is undefined, which
// the backend reads as "no filter" (all statuses) — filtered client-side
// here instead so the default view can hide cancelled/completed without a
// second round-trip, same shape as orders.js's matchesFilter.
const visibleItems = computed(() => {
  if (store.statusFilter === undefined) {
    return store.items.filter(
      (r) => r.status === 'pending' || r.status === 'confirmed'
    )
  }
  return store.items
})

const form = reactive({
  namaCustomer: '',
  namaAcara: '',
  telepon: '',
  jumlahTamu: 1,
  tanggalReservasi: '',
  tableId: 'none',
  catatan: '',
})

// reka-ui's SelectItem forbids value="" (reserved to mean "cleared"), so
// "no table assigned" uses this sentinel instead — translated to null right
// before the request leaves this component.
const NO_TABLE = 'none'

// Losing a half-filled reservation to a stray click (backdrop, Escape, the
// wrong sidebar link) is exactly what was reported — so the in-progress
// *create* draft survives any close that isn't a successful submit. Scoped
// to create only: an edit draft would risk showing reservation A's leftover
// text after closing without saving and then opening a *different*
// reservation B to edit, which would be worse than the bug being fixed.
const DRAFT_KEY = 'popside.reservationDraft'
let restoringDraft = false

function loadDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
function saveDraft() {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(form))
  } catch {
    // Storage unavailable (private mode, quota, disabled) — draft just
    // won't survive a close; nothing else depends on it persisting.
  }
}
function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    // Nothing to clean up if storage was never reachable in the first place.
  }
}

watch(
  form,
  () => {
    // Skip the write this same tick restores a saved draft into `form` —
    // otherwise that restore would immediately re-save itself right back,
    // which is harmless but pointless.
    if (restoringDraft || editingId.value !== null) return
    saveDraft()
  },
  { deep: true }
)

onMounted(() => {
  store.fetchAll()
  tables.fetchAll()
})

// Native datetime-local inputs always read/write in the browser's own local
// time, but this app is pinned to one fixed timezone regardless of device
// (AGENTS.md rule #15 / format.js's formatDateTime) — so both directions go
// through Asia/Jakarta wall-clock components explicitly rather than the
// browser's Date.getHours()/etc, which would drift on a device set to a
// different OS timezone.
const jakartaParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function isoToLocalInput(iso) {
  if (!iso) return ''
  const parts = Object.fromEntries(
    jakartaParts.formatToParts(new Date(iso)).map((p) => [p.type, p.value])
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

// Inverse of isoToLocalInput: the input's value is Jakarta wall-clock, so
// this builds the UTC instant via the same fixed +7h offset api/src/utils/
// jakartaTime.js uses server-side, rather than sending a bare "YYYY-MM-
// DDTHH:mm" string and relying on the API process's TZ env var to parse it
// as Jakarta time (that dependency is exactly what jakartaTime.js's own
// comment says this codebase avoids).
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000
function localInputToIso(value) {
  if (!value) return ''
  const [datePart, timePart] = value.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)
  return new Date(
    Date.UTC(year, month - 1, day, hour, minute) - JAKARTA_OFFSET_MS
  ).toISOString()
}

// Active tables, plus — while editing — the reservation's own currently-
// assigned table even if it's since been deactivated. Without that second
// part, reka-ui's Select falls back to the placeholder for a model value
// that matches no rendered option, so an inactive-but-still-assigned table
// reads as "Belum ditentukan" (looks unassigned) instead of showing what
// it actually is.
const tableOptions = computed(() => {
  const active = tables.items.filter((t) => t.isActive)
  const currentId = Number(form.tableId)
  if (form.tableId !== NO_TABLE && !active.some((t) => t.id === currentId)) {
    const current = tables.items.find((t) => t.id === currentId)
    if (current) return [...active, current]
  }
  return active
})

function openCreate() {
  editingId.value = null
  const draft = loadDraft()
  restoringDraft = true
  form.namaCustomer = draft?.namaCustomer ?? ''
  form.namaAcara = draft?.namaAcara ?? ''
  form.telepon = draft?.telepon ?? ''
  form.jumlahTamu = draft?.jumlahTamu ?? 1
  form.tanggalReservasi = draft?.tanggalReservasi ?? ''
  form.tableId = draft?.tableId ?? NO_TABLE
  form.catatan = draft?.catatan ?? ''
  restoringDraft = false
  formOpen.value = true
  if (draft) {
    toast.info('Draf reservasi yang belum tersimpan dipulihkan')
  }
}

function openEdit(r) {
  editingId.value = r.id
  form.namaCustomer = r.namaCustomer
  form.namaAcara = r.namaAcara || ''
  form.telepon = r.telepon || ''
  form.jumlahTamu = r.jumlahTamu
  form.tanggalReservasi = isoToLocalInput(r.tanggalReservasi)
  form.tableId = r.tableId ? String(r.tableId) : NO_TABLE
  form.catatan = r.catatan || ''
  formOpen.value = true
}

async function onSubmit() {
  submitting.value = true
  try {
    const payload = {
      ...form,
      tableId: form.tableId === NO_TABLE ? '' : form.tableId,
      tanggalReservasi: localInputToIso(form.tanggalReservasi),
    }
    if (editingId.value) {
      await store.update(editingId.value, payload)
      toast.success('Reservasi diperbarui')
    } else {
      await store.create(payload)
      toast.success('Reservasi ditambahkan')
      clearDraft()
    }
    formOpen.value = false
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    submitting.value = false
  }
}

async function onChangeStatus(r, status) {
  statusBusyId.value = r.id
  try {
    await store.updateStatus(r.id, status)
    toast.success(`Reservasi ${STATUS_LABEL[status].toLowerCase()}`)
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    statusBusyId.value = null
  }
}

// Same non-reactive-target pattern as TablesView.vue's pendingDelete —
// AlertDialogAction's own close nulls deleteTarget before @click fires.
let pendingDelete = null

function openDelete(r) {
  deleteTarget.value = r
  pendingDelete = r
}

async function onDeleteConfirm() {
  const target = pendingDelete
  if (!target) return

  deleting.value = true
  try {
    await store.remove(target.id)
    toast.success('Reservasi dihapus')
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
        <h1 class="text-lg font-semibold tracking-tight">Reservasi</h1>
        <p class="text-sm text-muted-foreground">
          Kelola reservasi meja untuk acara/event customer.
        </p>
      </div>
      <Button class="gap-2" @click="openCreate">
        <PlusIcon class="size-4" />
        Tambah Reservasi
      </Button>
    </div>

    <div class="flex flex-wrap gap-2">
      <Button
        v-for="f in FILTERS"
        :key="f.label"
        size="sm"
        :variant="store.statusFilter === f.value ? 'default' : 'outline'"
        @click="store.setFilter(f.value)"
      >
        {{ f.label }}
      </Button>
    </div>

    <div class="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Customer</TableHead>
            <TableHead>Acara</TableHead>
            <TableHead>Tanggal &amp; Jam</TableHead>
            <TableHead class="w-24">Tamu</TableHead>
            <TableHead class="w-28">Meja</TableHead>
            <TableHead class="w-32">Status</TableHead>
            <TableHead class="w-44 text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableEmpty
            v-if="!store.loading && visibleItems.length === 0"
            :colspan="7"
          >
            Belum ada reservasi.
          </TableEmpty>
          <TableRow v-for="r in visibleItems" :key="r.id">
            <TableCell class="font-medium">
              {{ r.namaCustomer }}
              <span
                v-if="r.telepon"
                class="block text-xs font-normal text-muted-foreground"
                >{{ r.telepon }}</span
              >
            </TableCell>
            <TableCell class="text-muted-foreground">{{
              r.namaAcara || '—'
            }}</TableCell>
            <TableCell class="text-muted-foreground">{{
              formatDateTime(r.tanggalReservasi)
            }}</TableCell>
            <TableCell>{{ r.jumlahTamu }} orang</TableCell>
            <TableCell class="text-muted-foreground">
              <span v-if="r.nomorMeja">Meja {{ r.nomorMeja }}</span>
              <span v-else>—</span>
            </TableCell>
            <TableCell>
              <Badge :variant="STATUS_VARIANT[r.status]">{{
                STATUS_LABEL[r.status]
              }}</Badge>
            </TableCell>
            <TableCell class="text-right">
              <Button
                v-if="r.status === 'pending'"
                size="sm"
                variant="outline"
                class="mr-1"
                :disabled="statusBusyId === r.id"
                @click="onChangeStatus(r, 'confirmed')"
              >
                Konfirmasi
              </Button>
              <Button
                v-if="r.status === 'confirmed'"
                size="sm"
                variant="outline"
                class="mr-1"
                :disabled="statusBusyId === r.id"
                @click="onChangeStatus(r, 'completed')"
              >
                Selesai
              </Button>
              <Button
                v-if="r.status === 'pending' || r.status === 'confirmed'"
                size="sm"
                variant="ghost"
                class="mr-1 text-destructive hover:text-destructive"
                :disabled="statusBusyId === r.id"
                @click="onChangeStatus(r, 'cancelled')"
              >
                Batalkan
              </Button>
              <Button variant="ghost" size="icon" @click="openEdit(r)">
                <PencilIcon class="size-4" />
              </Button>
              <Button variant="ghost" size="icon" @click="openDelete(r)">
                <Trash2Icon class="size-4" />
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <Dialog v-model:open="formOpen">
      <DialogContent class="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">
            <CalendarClockIcon class="size-4" />
            {{ editingId ? 'Ubah Reservasi' : 'Tambah Reservasi' }}
          </DialogTitle>
        </DialogHeader>
        <form
          id="reservation-form"
          class="space-y-4"
          @submit.prevent="onSubmit"
        >
          <div class="space-y-2">
            <Label for="namaCustomer">Nama Customer</Label>
            <Input
              id="namaCustomer"
              v-model="form.namaCustomer"
              required
              maxlength="100"
            />
          </div>
          <div class="space-y-2">
            <Label for="namaAcara">Nama Acara (opsional)</Label>
            <Input
              id="namaAcara"
              v-model="form.namaAcara"
              maxlength="100"
              placeholder="Mis. Ulang Tahun Sarah"
            />
          </div>
          <div class="space-y-2">
            <Label for="telepon">Nomor Telepon (opsional)</Label>
            <Input
              id="telepon"
              v-model="form.telepon"
              maxlength="20"
              placeholder="08xxxxxxxxxx"
            />
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div class="space-y-2">
              <Label for="jumlahTamu">Jumlah Tamu</Label>
              <Input
                id="jumlahTamu"
                v-model="form.jumlahTamu"
                type="number"
                min="1"
                max="999"
                step="1"
                required
              />
            </div>
            <div class="space-y-2">
              <Label for="tanggalReservasi">Tanggal &amp; Jam</Label>
              <Input
                id="tanggalReservasi"
                v-model="form.tanggalReservasi"
                type="datetime-local"
                required
              />
            </div>
          </div>
          <div class="space-y-2">
            <Label for="tableId">Meja (opsional)</Label>
            <Select v-model="form.tableId">
              <SelectTrigger id="tableId" class="w-full">
                <SelectValue placeholder="Belum ditentukan" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem :value="NO_TABLE">Belum ditentukan</SelectItem>
                <SelectItem
                  v-for="t in tableOptions"
                  :key="t.id"
                  :value="String(t.id)"
                >
                  Meja {{ t.nomorMeja }} (maks {{ t.kapasitas }} orang){{ !t.isActive ? ' — nonaktif' : '' }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="space-y-2">
            <Label for="catatan">Catatan (opsional)</Label>
            <Input
              id="catatan"
              v-model="form.catatan"
              maxlength="300"
              placeholder="Mis. butuh dekorasi tambahan"
            />
          </div>
        </form>
        <DialogFooter>
          <Button type="submit" form="reservation-form" :disabled="submitting">
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
            >Hapus reservasi "{{
              deleteTarget?.namaCustomer
            }}"?</AlertDialogTitle
          >
          <AlertDialogDescription
            >Tindakan ini tidak bisa dibatalkan.</AlertDialogDescription
          >
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
