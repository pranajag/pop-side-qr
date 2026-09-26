<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { useReservationsStore } from '@/stores/reservations'
import { useTablesStore } from '@/stores/tables'
import { useAuthStore } from '@/stores/auth'
import { dengarkan } from '@/lib/realtime'
import { formatApiError, API_URL } from '@/lib/api'
import { formatDateTime, formatRupiah } from '@/lib/format'
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
  CalendarClockIcon,
  QrCodeIcon,
  WalletIcon,
  CircleCheckIcon,
} from '@lucide/vue'

const store = useReservationsStore()
const tables = useTablesStore()
const auth = useAuthStore()

const formOpen = ref(false)
const editingId = ref(null)
const submitting = ref(false)
const deleteTarget = ref(null)
const deleting = ref(false)
const statusBusyId = ref(null)
// "Mulai Pesanan" for a confirmed, table-assigned reservation — there's no
// staff-side dine-in order creation (ManualOrderView.vue is takeaway-only,
// tableId always null there); the real flow is the guest's own phone
// scanning that table's QR, same as any other dine-in customer. This just
// surfaces that QR from the reservation instead of staff cross-referencing
// the table number back to TablesView.vue themselves. getTableBill's own
// per-visit scoping (table.service.js) already keeps whatever this table
// ordered before today's reservation out of the new party's bill — no new
// billing concept needed for that part.
const qrReservation = ref(null)
function qrImageUrl(tableId) {
  return `${API_URL}/admin/tables/${tableId}/qr`
}

const METODE_LABEL = { tunai: 'Tunai', qris: 'QRIS', debit: 'Debit' }

// ---------- Aturan DP toko ----------
// Mengisi DP wajib otomatis saat reservasi baru dibuat. Diubah admin saja
// (server menolak kasir); kasir tetap melihatnya dan tetap bisa
// menyesuaikan DP wajib satu reservasi tertentu di form.
function dpDariAturan(jumlahTamu) {
  const a = store.aturanDp
  return a.perTamu ? a.nominal * (Number(jumlahTamu) || 0) : a.nominal
}
const aturanDpLabel = computed(() => {
  const a = store.aturanDp
  if (!a.nominal) return 'Belum diatur — reservasi baru tidak meminta DP, kecuali diisi manual.'
  return a.perTamu
    ? `${formatRupiah(a.nominal)} per tamu`
    : `${formatRupiah(a.nominal)} per reservasi`
})
const aturanOpen = ref(false)
const aturanForm = reactive({ nominal: '', perTamu: false })
const savingAturan = ref(false)
function openAturan() {
  aturanForm.nominal = store.aturanDp.nominal ? String(store.aturanDp.nominal) : ''
  aturanForm.perTamu = store.aturanDp.perTamu
  aturanOpen.value = true
}
async function onSaveAturan() {
  savingAturan.value = true
  try {
    await store.updateAturanDp({
      nominal: Number(aturanForm.nominal) || 0,
      perTamu: aturanForm.perTamu,
    })
    toast.success('Aturan DP disimpan')
    aturanOpen.value = false
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    savingAturan.value = false
  }
}

// ---------- Ringkasan DP per reservasi ----------
function dpInfo(r) {
  const dp = r.dp
  if (!dp || dp.status === 'tidak_perlu') return null
  if (dp.status === 'lunas')
    return { teks: `DP ${formatRupiah(dp.wajib)} · lunas`, kelas: 'text-status-completed' }
  if (dp.status === 'sebagian')
    return {
      teks: `DP ${formatRupiah(dp.dibayar)} / ${formatRupiah(dp.wajib)}`,
      sub: `kurang ${formatRupiah(dp.kurang)}`,
      kelas: 'text-status-waiting-verif',
    }
  return { teks: `DP ${formatRupiah(dp.wajib)} · belum dibayar`, kelas: 'text-muted-foreground' }
}

// ---------- Konfirmasi lunas (dipakai form & dialog pembayaran) ----------
// Same non-reactive-target pattern as pendingDelete below: AlertDialogAction
// closes (and would null a ref) before its own @click runs.
const konfirmasiLunas = ref(null)
let aksiSetelahLunas = null
function mintaKonfirmasiLunas(info, aksi) {
  aksiSetelahLunas = aksi
  konfirmasiLunas.value = info
}
function onKonfirmasiLunas() {
  const aksi = aksiSetelahLunas
  aksiSetelahLunas = null
  aksi?.()
}

// ---------- Catat pembayaran DP (bisa dicicil) ----------
const bayarTarget = ref(null)
const bayarForm = reactive({ amount: '', metode: 'tunai' })
const savingBayar = ref(false)
function openBayar(r) {
  bayarTarget.value = r
  bayarForm.amount = String(r.dp.kurang)
  bayarForm.metode = 'tunai'
}
const bayarAmount = computed(() => Number(bayarForm.amount) || 0)
const bayarSisa = computed(() =>
  bayarTarget.value ? Math.max(0, bayarTarget.value.dp.kurang - bayarAmount.value) : 0
)
const bayarMelebihi = computed(
  () => !!bayarTarget.value && bayarAmount.value > bayarTarget.value.dp.kurang
)
const bayarMelunasi = computed(
  () =>
    !!bayarTarget.value &&
    bayarAmount.value > 0 &&
    bayarAmount.value === bayarTarget.value.dp.kurang
)
function onBayarClick() {
  const r = bayarTarget.value
  if (bayarMelunasi.value) {
    mintaKonfirmasiLunas(
      { nama: r.namaCustomer, total: r.dp.wajib, pending: r.status === 'pending' },
      kirimBayar
    )
    return
  }
  kirimBayar()
}
async function kirimBayar() {
  const r = bayarTarget.value
  if (!r) return
  const amount = bayarAmount.value
  savingBayar.value = true
  try {
    const hasil = await store.catatPembayaranDp(r.id, { amount, metode: bayarForm.metode })
    if (hasil.baruLunas) {
      toast.success(
        `DP ${r.namaCustomer} lunas${hasil.dikonfirmasiOtomatis ? ' — reservasi dikonfirmasi' : ''}`,
        { description: 'Uangnya sudah tercatat di DP reservasi shift yang sedang berjalan.' }
      )
    } else {
      toast.success(`Pembayaran DP ${formatRupiah(amount)} dicatat`, {
        description: `Kurang ${formatRupiah(hasil.kurang)} lagi. Sudah tercatat di DP reservasi shift ini.`,
      })
    }
    bayarTarget.value = null
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    savingBayar.value = false
  }
}

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
  depositAmount: '',
  // Wajib (dan hanya admin yang boleh) kalau DP wajib di bawah aturan toko.
  alasanDp: '',
  // Hanya dipakai saat MEMBUAT reservasi: DP yang dibayar customer saat itu.
  dpDibayarSekarang: '',
  metodeDp: 'tunai',
})

// DP wajib ikut aturan toko dan jumlah tamu — sampai staff mengetik
// angkanya sendiri; setelah itu tidak lagi ditimpa.
const dpManual = ref(false)
watch(
  () => form.jumlahTamu,
  (n) => {
    if (editingId.value !== null || dpManual.value || restoringDraft) return
    const wajib = dpDariAturan(n)
    form.depositAmount = wajib > 0 ? String(wajib) : ''
  }
)
const dpWajibForm = computed(() => Number(form.depositAmount) || 0)
// DP di bawah aturan toko = memotong/membebaskan DP: keputusan admin, wajib
// alasan. Server yang menentukan (reservation.service.js); layar ini
// menjelaskannya lebih dulu supaya tidak ada yang kaget ditolak.
const dpAturanForm = computed(() => dpDariAturan(form.jumlahTamu))
// Saat mengedit, DP/jumlah tamu yang TIDAK diubah tidak diperiksa ulang
// (dan tidak dikirim) — kasir tetap bisa mengubah catatan/jam reservasi
// lama yang DP-nya kebetulan di bawah aturan yang baru.
const asliEdit = reactive({ depositAmount: 0, jumlahTamu: 0 })
const dpAtauTamuBerubah = computed(
  () =>
    editingId.value === null ||
    dpWajibForm.value !== asliEdit.depositAmount ||
    Number(form.jumlahTamu) !== asliEdit.jumlahTamu
)
const dpDiBawahAturan = computed(() => dpAtauTamuBerubah.value && dpWajibForm.value < dpAturanForm.value)
const dpDitolakUntukKasir = computed(() => dpDiBawahAturan.value && !auth.isAdmin)
const dpBayarForm = computed(() => Number(form.dpDibayarSekarang) || 0)
const dpBayarMelebihi = computed(() => dpBayarForm.value > dpWajibForm.value)
const dpSisaForm = computed(() => Math.max(0, dpWajibForm.value - dpBayarForm.value))
const dpAkanLunas = computed(
  () =>
    editingId.value === null &&
    dpWajibForm.value > 0 &&
    dpBayarForm.value >= dpWajibForm.value &&
    !dpBayarMelebihi.value
)

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

// Reservasi yang dibuat/diubah staff lain (atau DP yang baru dibayar)
// langsung muncul di layar ini juga.
let tundaMuat = null
const berhentiDengar = dengarkan('reservasi:berubah', () => {
  clearTimeout(tundaMuat)
  tundaMuat = setTimeout(() => store.fetchAll(), 250)
})
onUnmounted(() => {
  clearTimeout(tundaMuat)
  berhentiDengar()
})

onMounted(() => {
  store.fetchAll()
  tables.fetchAll()
  store.fetchAturanDp().catch(() => {})
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
  form.depositAmount = draft?.depositAmount ?? ''
  form.alasanDp = draft?.alasanDp ?? ''
  form.dpDibayarSekarang = draft?.dpDibayarSekarang ?? ''
  form.metodeDp = draft?.metodeDp ?? 'tunai'
  // Draf yang sudah membawa angka DP wajib dianggap isian staff sendiri.
  dpManual.value = !!draft?.depositAmount
  if (!dpManual.value) {
    const wajib = dpDariAturan(form.jumlahTamu)
    form.depositAmount = wajib > 0 ? String(wajib) : ''
  }
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
  form.depositAmount = r.depositAmount > 0 ? String(r.depositAmount) : ''
  form.alasanDp = r.alasanDp || ''
  form.dpDibayarSekarang = ''
  asliEdit.depositAmount = r.depositAmount || 0
  asliEdit.jumlahTamu = r.jumlahTamu
  dpManual.value = true
  formOpen.value = true
}

function onSubmit() {
  if (dpAkanLunas.value) {
    mintaKonfirmasiLunas(
      { nama: form.namaCustomer || 'customer', total: dpWajibForm.value, pending: true },
      kirimForm
    )
    return
  }
  kirimForm()
}

async function kirimForm() {
  submitting.value = true
  try {
    const { dpDibayarSekarang, metodeDp, ...isi } = form
    const payload = {
      ...isi,
      tableId: form.tableId === NO_TABLE ? '' : form.tableId,
      tanggalReservasi: localInputToIso(form.tanggalReservasi),
      // Kosong = 0: reservasi tanpa DP wajib, dikirim eksplisit supaya
      // server tidak mengisinya dari aturan toko.
      depositAmount: form.depositAmount === '' ? 0 : form.depositAmount,
    }
    if (editingId.value) {
      if (!dpAtauTamuBerubah.value) {
        delete payload.depositAmount
        delete payload.jumlahTamu
      }
      await store.update(editingId.value, payload)
      toast.success('Reservasi diperbarui')
    } else {
      const bayar = Number(dpDibayarSekarang) || 0
      if (bayar > 0) Object.assign(payload, { dpDibayarSekarang: bayar, metodeDp })
      const hasil = await store.create(payload)
      if (hasil.baruLunas) {
        toast.success('Reservasi ditambahkan — DP lunas', {
          description: `${hasil.dikonfirmasiOtomatis ? 'Reservasi langsung dikonfirmasi. ' : ''}Uang DP sudah tercatat di shift yang sedang berjalan.`,
        })
      } else if (bayar > 0) {
        toast.success(`Reservasi ditambahkan — DP ${formatRupiah(bayar)} dicatat`, {
          description: `Kurang ${formatRupiah(hasil.kurang)} lagi. Uangnya sudah tercatat di shift ini.`,
        })
      } else {
        toast.success('Reservasi ditambahkan')
      }
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

    <div
      class="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3"
    >
      <div class="flex min-w-0 items-start gap-3">
        <WalletIcon class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div class="min-w-0">
          <p class="text-sm font-medium">Aturan DP reservasi</p>
          <p class="text-xs text-muted-foreground">{{ aturanDpLabel }}</p>
        </div>
      </div>
      <Button v-if="auth.isAdmin" size="sm" variant="outline" @click="openAturan">
        Atur DP
      </Button>
    </div>

    <div class="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <!-- Empat kolom: dulu tujuh kolom + lima tombol aksi berjajar
            butuh ~1080px, sementara di 1059px (sidebar 272px) ruang tabelnya
            cuma ~655px — kolom Status terjepit dan Aksi tersembunyi di
            balik scroll samping. Acara ikut ke Customer; tanggal, tamu, dan
            meja jadi satu kolom Jadwal; tombol aksi boleh melipat. -->
            <TableHead>Customer</TableHead>
            <TableHead>Jadwal</TableHead>
            <TableHead>Status</TableHead>
            <TableHead class="w-[14.5rem] text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableEmpty
            v-if="!store.loading && visibleItems.length === 0"
            :colspan="4"
          >
            Belum ada reservasi.
          </TableEmpty>
          <TableRow v-for="r in visibleItems" :key="r.id">
            <TableCell class="whitespace-normal" data-label="Customer">
              <div class="flex flex-col items-end gap-0.5 sm:items-start">
                <span class="font-medium">{{ r.namaCustomer }}</span>
                <span v-if="r.telepon" class="text-xs text-muted-foreground">{{
                  r.telepon
                }}</span>
                <span v-if="r.namaAcara" class="text-xs text-muted-foreground">{{
                  r.namaAcara
                }}</span>
              </div>
            </TableCell>
            <TableCell class="text-sm" data-label="Jadwal">
              <div class="flex flex-col items-end gap-0.5 sm:items-start">
                <span class="whitespace-nowrap">{{ formatDateTime(r.tanggalReservasi) }}</span>
                <span class="text-xs text-muted-foreground"
                  >{{ r.jumlahTamu }} orang ·
                  {{ r.nomorMeja ? `Meja ${r.nomorMeja}` : 'tanpa meja' }}</span
                >
              </div>
            </TableCell>
            <TableCell class="whitespace-normal" data-label="Status">
              <div class="flex flex-col items-end gap-1 sm:items-start">
                <Badge :variant="STATUS_VARIANT[r.status]">{{
                  STATUS_LABEL[r.status]
                }}</Badge>
                <span
                  v-if="dpInfo(r)"
                  class="text-xs font-medium"
                  :class="dpInfo(r).kelas"
                  >{{ dpInfo(r).teks
                  }}<span v-if="dpInfo(r).sub" class="block">{{ dpInfo(r).sub }}</span></span
                >
                <span v-if="r.alasanDp" class="text-xs text-muted-foreground" :title="r.alasanDp">
                  DP di bawah aturan: {{ r.alasanDp }}
                </span>
              </div>
            </TableCell>
            <TableCell class="whitespace-normal text-right" data-label="Aksi">
              <div class="flex flex-wrap items-center justify-end gap-1">
                <Button
                  v-if="r.dp?.kurang > 0 && r.status !== 'cancelled'"
                  size="sm"
                  variant="outline"
                  class="gap-1.5"
                  @click="openBayar(r)"
                >
                  <WalletIcon class="size-3.5" />
                  Bayar DP
                </Button>
                <Button
                  v-if="r.status === 'pending'"
                  size="sm"
                  variant="outline"
                 
                  :disabled="statusBusyId === r.id"
                  @click="onChangeStatus(r, 'confirmed')"
                >
                  Konfirmasi
                </Button>
                <Button
                  v-if="r.status === 'confirmed' && r.tableId"
                  size="sm"
                  variant="outline"
                  class="gap-1.5"
                  @click="qrReservation = r"
                >
                  <QrCodeIcon class="size-3.5" />
                  Mulai Pesanan
                </Button>
                <Button
                  v-if="r.status === 'confirmed'"
                  size="sm"
                  variant="outline"
                 
                  :disabled="statusBusyId === r.id"
                  @click="onChangeStatus(r, 'completed')"
                >
                  Selesai
                </Button>
                <Button
                  v-if="r.status === 'pending' || r.status === 'confirmed'"
                  size="sm"
                  variant="ghost"
                  class="text-destructive hover:text-destructive"
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
              </div>
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
          <DialogDescription>
            Meja yang dipilih harus muat untuk jumlah tamu, dan deposit dicatat
            sebagai pembayaran di muka.
          </DialogDescription>
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
          <div class="space-y-2">
            <Label for="depositAmount">DP wajib</Label>
            <Input
              id="depositAmount"
              v-model="form.depositAmount"
              type="number"
              min="0"
              step="1000"
              placeholder="0"
              @input="dpManual = true"
            />
            <p class="text-xs text-muted-foreground">
              <template v-if="editingId === null && !dpManual && store.aturanDp.nominal">
                Otomatis dari aturan:
                {{
                  store.aturanDp.perTamu
                    ? `${formatRupiah(store.aturanDp.nominal)} × ${form.jumlahTamu || 0} tamu`
                    : `${formatRupiah(store.aturanDp.nominal)} per reservasi`
                }}. Boleh diubah untuk reservasi ini.
              </template>
              <template v-else-if="!store.aturanDp.nominal">Isi 0 atau kosongkan kalau reservasi ini tidak perlu DP.</template>
            </p>
            <p v-if="dpDitolakUntukKasir" class="text-xs text-destructive">
              Di bawah aturan toko ({{ formatRupiah(dpAturanForm) }}). Hanya admin yang bisa
              mengurangi atau membebaskan DP.
            </p>
          </div>
          <div v-if="dpDiBawahAturan && auth.isAdmin" class="space-y-2">
            <Label for="alasanDp">Alasan DP di bawah aturan toko (wajib)</Label>
            <Input
              id="alasanDp"
              v-model="form.alasanDp"
              maxlength="200"
              placeholder="Mis. pelanggan tetap, acara kantor rekanan"
            />
            <p class="text-xs text-muted-foreground">
              Aturan toko {{ formatRupiah(dpAturanForm) }}. Alasan ini dicatat di reservasi dan log audit.
            </p>
          </div>
          <div
            v-if="editingId === null && dpWajibForm > 0"
            class="space-y-3 rounded-md border p-3"
          >
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div class="space-y-2">
                <Label for="dpDibayarSekarang">DP dibayar sekarang</Label>
                <Input
                  id="dpDibayarSekarang"
                  v-model="form.dpDibayarSekarang"
                  type="number"
                  min="0"
                  step="1000"
                  placeholder="0"
                />
              </div>
              <div class="space-y-2">
                <Label for="metodeDp">Diterima lewat</Label>
                <Select v-model="form.metodeDp">
                  <SelectTrigger id="metodeDp" class="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tunai">Tunai</SelectItem>
                    <SelectItem value="qris">QRIS</SelectItem>
                    <SelectItem value="debit">Debit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p v-if="dpBayarMelebihi" class="text-xs font-medium text-destructive">
              Melebihi DP wajib {{ formatRupiah(dpWajibForm) }}.
            </p>
            <p
              v-else-if="dpAkanLunas"
              class="flex items-center gap-1.5 text-xs font-medium text-status-completed"
            >
              <CircleCheckIcon class="size-3.5 shrink-0" />
              Lunas — reservasi langsung dikonfirmasi.
            </p>
            <p v-else-if="dpBayarForm > 0" class="text-xs font-medium text-status-waiting-verif">
              Kurang {{ formatRupiah(dpSisaForm) }} — bisa dilunasi nanti lewat tombol Bayar DP.
            </p>
            <p v-else class="text-xs text-muted-foreground">
              Kosongkan kalau customer belum membayar DP. Uang yang dicatat di
              sini langsung masuk DP reservasi di shift yang sedang berjalan.
            </p>
          </div>
        </form>
        <DialogFooter>
          <Button
            type="submit"
            form="reservation-form"
            :disabled="submitting || (editingId === null && dpBayarMelebihi) || dpDitolakUntukKasir || (dpDiBawahAturan && form.alasanDp.trim().length < 3)"
          >
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

    <Dialog :open="!!qrReservation" @update:open="(v) => !v && (qrReservation = null)">
      <DialogContent class="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle>Meja {{ qrReservation?.nomorMeja }} — {{ qrReservation?.namaCustomer }}</DialogTitle>
          <DialogDescription class="text-xs">
            Sama seperti QR yang tertempel di meja — tunjukkan ini ke tamu untuk mulai pesan, atau scan sendiri kalau mau bantu input.
          </DialogDescription>
        </DialogHeader>
        <img
          v-if="qrReservation"
          :src="qrImageUrl(qrReservation.tableId)"
          alt="QR Meja"
          class="mx-auto w-full max-w-56 rounded-lg border"
        />
      </DialogContent>
    </Dialog>

    <!-- Catat pembayaran DP — bisa dicicil sampai lunas. -->
    <Dialog :open="!!bayarTarget" @update:open="(v) => !v && (bayarTarget = null)">
      <DialogContent class="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bayar DP — {{ bayarTarget?.namaCustomer }}</DialogTitle>
          <DialogDescription>
            Catat uang DP yang diterima sekarang. Uangnya langsung masuk DP
            reservasi di shift yang sedang berjalan.
          </DialogDescription>
        </DialogHeader>
        <div v-if="bayarTarget" class="space-y-4">
          <dl class="space-y-1 rounded-md border p-3 text-sm">
            <div class="flex justify-between gap-3">
              <dt class="text-muted-foreground">DP wajib</dt>
              <dd>{{ formatRupiah(bayarTarget.dp.wajib) }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-muted-foreground">Sudah dibayar</dt>
              <dd>{{ formatRupiah(bayarTarget.dp.dibayar) }}</dd>
            </div>
            <div class="flex justify-between gap-3 border-t pt-1 font-semibold">
              <dt>Kurang</dt>
              <dd class="text-status-waiting-verif">
                {{ formatRupiah(bayarTarget.dp.kurang) }}
              </dd>
            </div>
          </dl>
          <ul
            v-if="bayarTarget.pembayaranDp.length > 0"
            class="space-y-1 text-xs text-muted-foreground"
          >
            <li
              v-for="pb in bayarTarget.pembayaranDp"
              :key="pb.id"
              class="flex justify-between gap-3"
            >
              <span>{{ formatDateTime(pb.paidAt) }} · {{ METODE_LABEL[pb.metode] }}</span>
              <span class="font-medium text-foreground">{{ formatRupiah(pb.amount) }}</span>
            </li>
          </ul>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div class="space-y-2">
              <Label for="bayarAmount">Jumlah dibayar</Label>
              <Input
                id="bayarAmount"
                v-model="bayarForm.amount"
                type="number"
                min="1"
                step="1000"
              />
            </div>
            <div class="space-y-2">
              <Label for="bayarMetode">Diterima lewat</Label>
              <Select v-model="bayarForm.metode">
                <SelectTrigger id="bayarMetode" class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tunai">Tunai</SelectItem>
                  <SelectItem value="qris">QRIS</SelectItem>
                  <SelectItem value="debit">Debit</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p v-if="bayarMelebihi" class="text-xs font-medium text-destructive">
            Melebihi kekurangan DP — maksimal {{ formatRupiah(bayarTarget.dp.kurang) }}.
          </p>
          <p
            v-else-if="bayarMelunasi"
            class="flex items-center gap-1.5 text-xs font-medium text-status-completed"
          >
            <CircleCheckIcon class="size-3.5 shrink-0" />
            Pembayaran ini melunasi DP.
          </p>
          <p v-else-if="bayarAmount > 0" class="text-xs font-medium text-status-waiting-verif">
            Setelah ini masih kurang {{ formatRupiah(bayarSisa) }}.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" :disabled="savingBayar" @click="bayarTarget = null">
            Batal
          </Button>
          <Button :disabled="savingBayar || bayarAmount <= 0 || bayarMelebihi" @click="onBayarClick">
            <LoaderCircleIcon v-if="savingBayar" class="size-4 animate-spin" />
            Catat Pembayaran
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Konfirmasi saat sebuah pembayaran melunasi DP. -->
    <AlertDialog :open="!!konfirmasiLunas" @update:open="(v) => !v && (konfirmasiLunas = null)">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>DP {{ konfirmasiLunas?.nama }} sudah lunas?</AlertDialogTitle>
          <AlertDialogDescription>
            Pastikan customer benar-benar sudah membayar total
            {{ formatRupiah(konfirmasiLunas?.total ?? 0) }}. Setelah dikonfirmasi:
            DP ditandai lunas,
            <template v-if="konfirmasiLunas?.pending">reservasi langsung dikonfirmasi,</template>
            dan uangnya masuk DP reservasi di shift yang sedang berjalan.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction @click="onKonfirmasiLunas">Ya, DP Lunas</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- Aturan DP toko (admin). -->
    <Dialog :open="aturanOpen" @update:open="(v) => (aturanOpen = v)">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Aturan DP reservasi</DialogTitle>
          <DialogDescription>
            Berapa yang wajib dibayar untuk membuka reservasi. Dipakai sebagai
            DP wajib otomatis setiap reservasi baru — tetap bisa disesuaikan
            per reservasi.
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-4">
          <div class="space-y-2">
            <Label for="aturanNominal">Nominal DP</Label>
            <Input
              id="aturanNominal"
              v-model="aturanForm.nominal"
              type="number"
              min="0"
              step="1000"
              placeholder="0 = tidak ada DP wajib"
            />
          </div>
          <div class="space-y-2">
            <Label for="aturanTipe">Dihitung</Label>
            <Select
              :model-value="aturanForm.perTamu ? 'tamu' : 'reservasi'"
              @update:model-value="(v) => (aturanForm.perTamu = v === 'tamu')"
            >
              <SelectTrigger id="aturanTipe" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="reservasi">Per reservasi (nominal tetap)</SelectItem>
                <SelectItem value="tamu">Per tamu (nominal × jumlah tamu)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p class="text-xs text-muted-foreground">
            Contoh: {{
              aturanForm.perTamu
                ? `${formatRupiah(Number(aturanForm.nominal) || 0)} × 6 tamu = ${formatRupiah((Number(aturanForm.nominal) || 0) * 6)}`
                : `${formatRupiah(Number(aturanForm.nominal) || 0)} untuk setiap reservasi`
            }}. Reservasi yang sudah ada tidak berubah.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" :disabled="savingAturan" @click="aturanOpen = false">
            Batal
          </Button>
          <Button :disabled="savingAturan" @click="onSaveAturan">
            <LoaderCircleIcon v-if="savingAturan" class="size-4 animate-spin" />
            Simpan Aturan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
