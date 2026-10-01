<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { useReservationsStore } from '@/stores/reservations'
import { useAuthStore } from '@/stores/auth'
import { useActiveShiftStore } from '@/stores/activeShift'
import { dengarkan } from '@/lib/realtime'
import { formatApiError, API_URL } from '@/lib/api'
import { formatDateTime, formatRupiah } from '@/lib/format'
import StartShiftDialog from '@/components/StartShiftDialog.vue'
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
  TriangleAlertIcon,
  CopyIcon,
  ExternalLinkIcon,
} from '@lucide/vue'

const store = useReservationsStore()
const auth = useAuthStore()
const activeShiftStore = useActiveShiftStore()

// ---------- Shift berjalan (syarat mencatat DP) ----------
// Uang DP masuk hitungan kas shift pencatatnya, jadi server menolak mencatat
// DP tanpa shift berjalan milik akun ini (reservation.service.js
// assertShiftBerjalan, kode PERLU_SHIFT). Dulu layar ini tidak memberi tahu
// apa-apa: staff mengisi seluruh form + DP, menekan Simpan, dan ditolak
// berulang kali tanpa jalan keluar. Sekarang statusnya terlihat sejak awal,
// dan shift bisa dimulai di tempat — isian form tetap utuh, lalu aksi yang
// tadi menunggu (simpan reservasi + DP, catat Bayar DP) langsung dijalankan.
const belumShift = computed(() => activeShiftStore.loaded && !activeShiftStore.hasActiveShift)
const shiftDialog = reactive({ open: false, alasan: '', labelKonfirmasi: '', labelLewati: '' })
// Aksi yang menunggu shift dimulai / jalan lain tanpa shift. Selalu ditimpa
// setiap kali dialog dibuka, jadi aksi lama tidak pernah ikut terjalankan.
let setelahShift = null
let tanpaShift = null
function mintaMulaiShift({
  alasan = '',
  labelKonfirmasi = 'Konfirmasi Mulai Shift',
  labelLewati = '',
  lanjut = null,
  lewati = null,
} = {}) {
  setelahShift = lanjut
  tanpaShift = lewati
  Object.assign(shiftDialog, { open: true, alasan, labelKonfirmasi, labelLewati })
}
function onShiftDimulai() {
  const aksi = setelahShift
  setelahShift = null
  tanpaShift = null
  aksi?.()
}
function onLewatiShift() {
  const aksi = tanpaShift
  setelahShift = null
  tanpaShift = null
  shiftDialog.open = false
  aksi?.()
}

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
//
// Sejak 1 Oktober (permintaan client) ini QR ROMBONGAN, bukan QR meja biasa:
// selama reservasi terkonfirmasi memegang mejanya, QR yang tertempel di meja
// tidak bisa dipakai memesan oleh customer lain — hanya QR ini
// (api reservation.service.js aksesMejaPublik). Hanya untuk reservasi yang
// syaratnya terpenuhi: dikonfirmasi, punya meja, DP lunas.
const qrReservation = ref(null)
const qrLink = ref('')
const qrVersi = ref(0)
function qrImageUrl(id) {
  return `${API_URL}/admin/reservations/${id}/qr?v=${qrVersi.value}`
}
function bisaMulaiPesanan(r) {
  return r.status === 'confirmed' && !!r.tableId && (r.dp?.status === 'lunas' || r.dp?.status === 'tidak_perlu')
}
async function bukaQrRombongan(r) {
  try {
    qrLink.value = await store.linkRombongan(r.id)
    qrVersi.value = Date.now()
    qrReservation.value = r
  } catch (err) {
    toast.error(formatApiError(err))
  }
}
async function salinLinkRombongan() {
  try {
    await navigator.clipboard.writeText(qrLink.value)
    toast.success('Link QR rombongan disalin', {
      description: 'Bagikan hanya ke rombongan reservasi ini.',
    })
  } catch {
    toast.error('Gagal menyalin link')
  }
}

const METODE_LABEL = { tunai: 'Tunai', qris: 'QRIS', debit: 'Debit' }

// ---------- Aturan DP toko ----------
// DP wajib setiap reservasi baru, dihitung server — tidak bisa diubah per
// reservasi oleh siapa pun (permintaan client 1 Oktober). Aturannya sendiri
// diubah admin saja (server menolak kasir).
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
// DP dibayar pas — tidak bisa dicicil, tidak bisa lebih (server menolaknya
// juga: reservation.service.js assertDpPas).
const bayarTidakPas = computed(
  () => !!bayarTarget.value && bayarAmount.value > 0 && bayarAmount.value !== bayarTarget.value.dp.kurang
)
const bayarMelunasi = computed(
  () =>
    !!bayarTarget.value &&
    bayarAmount.value > 0 &&
    bayarAmount.value === bayarTarget.value.dp.kurang
)
function onBayarClick() {
  const r = bayarTarget.value
  if (!bayarMelunasi.value) return
  mintaKonfirmasiLunas(
    { nama: r.namaCustomer, total: r.dp.wajib, pending: r.status === 'pending' },
    catatBayar
  )
}
function catatBayar() {
  if (belumShift.value) {
    mintaShiftUntukBayar()
    return
  }
  kirimBayar()
}
function mintaShiftUntukBayar() {
  mintaMulaiShift({
    alasan: `Pembayaran DP ${formatRupiah(bayarAmount.value)} harus masuk kas shift. Mulai shift dulu — pembayarannya langsung dicatat.`,
    labelKonfirmasi: 'Mulai Shift & Catat',
    lanjut: kirimBayar,
  })
}
async function kirimBayar() {
  const r = bayarTarget.value
  if (!r) return
  const amount = bayarAmount.value
  savingBayar.value = true
  try {
    const hasil = await store.catatPembayaranDp(r.id, { amount, metode: bayarForm.metode })
    toast.success(
      `DP ${r.namaCustomer} ${formatRupiah(amount)} lunas${hasil.dikonfirmasiOtomatis ? ' — reservasi dikonfirmasi' : ''}`,
      { description: 'Uangnya sudah tercatat di DP reservasi shift yang sedang berjalan.' }
    )
    bayarTarget.value = null
  } catch (err) {
    // Shift diakhiri di tab/perangkat lain sejak halaman ini dimuat.
    if (err.code === 'PERLU_SHIFT') {
      activeShiftStore.fetch().catch(() => {})
      mintaShiftUntukBayar()
      return
    }
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
  // Hanya dipakai saat MEMBUAT reservasi: DP yang dibayar customer saat itu.
  dpDibayarSekarang: '',
  metodeDp: 'tunai',
})

// Reservasi yang sedang diedit, seperti saat dibuka.
const asliEdit = reactive({ depositAmount: 0, jumlahTamu: 0, dibayar: 0, status: 'pending' })

// DP wajib selalu dari aturan toko — form hanya menampilkannya (server yang
// menghitung; request tidak bisa membawa angka DP wajib). Saat mengedit: DP
// wajib reservasi itu sendiri, kecuali aturannya per tamu dan jumlah
// tamunya diubah — dihitung ulang dari aturan, sama seperti di server.
const tamuBerubah = computed(
  () => editingId.value !== null && Number(form.jumlahTamu) !== asliEdit.jumlahTamu
)
const dpWajibForm = computed(() => {
  if (editingId.value === null) return dpDariAturan(form.jumlahTamu)
  if (store.aturanDp.perTamu && tamuBerubah.value) return dpDariAturan(form.jumlahTamu)
  return asliEdit.depositAmount
})
const dpDihitungUlang = computed(
  () => tamuBerubah.value && store.aturanDp.perTamu && dpWajibForm.value !== asliEdit.depositAmount
)
// Jumlah tamu dikurangi sampai DP wajib di bawah DP yang sudah dibayar:
// kelebihannya tidak bisa dikembalikan lewat sistem, server menolaknya.
const dpEditDiBawahDibayar = computed(
  () => dpDihitungUlang.value && dpWajibForm.value < asliEdit.dibayar
)
// Jumlah tamu ditambah sampai DP wajib naik: kurang lagi, reservasi yang
// sudah dikonfirmasi kembali Pending sampai kekurangannya dibayar pas.
const dpEditJadiKurang = computed(
  () => dpDihitungUlang.value && dpWajibForm.value > asliEdit.dibayar
)
const keteranganDpWajib = computed(() => {
  const a = store.aturanDp
  if (editingId.value !== null && !dpDihitungUlang.value) {
    return 'DP wajib reservasi ini, ditetapkan saat dibuat. Tidak bisa diubah.'
  }
  if (!a.nominal) return 'Aturan DP toko Rp 0 — reservasi ini tidak perlu DP.'
  const rumus = a.perTamu
    ? `${formatRupiah(a.nominal)} × ${Number(form.jumlahTamu) || 0} tamu`
    : `${formatRupiah(a.nominal)} per reservasi`
  return `Dari aturan toko: ${rumus}. Tidak bisa diubah per reservasi.`
})
// DP dibayar PAS (permintaan client 1 Oktober): kosong = belum bayar
// (reservasi Pending), selain itu harus sama persis dengan DP wajib.
const dpBayarForm = computed(() => Number(form.dpDibayarSekarang) || 0)
const dpBayarTidakPas = computed(
  () => editingId.value === null && dpBayarForm.value > 0 && dpBayarForm.value !== dpWajibForm.value
)
const dpAkanLunas = computed(
  () => editingId.value === null && dpWajibForm.value > 0 && dpBayarForm.value === dpWajibForm.value
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
// Shift dimulai/diakhiri di tab atau perangkat lain.
const berhentiDengarShift = dengarkan('shift:berubah', () => {
  activeShiftStore.fetch().catch(() => {})
})
onUnmounted(() => {
  clearTimeout(tundaMuat)
  clearTimeout(tundaMeja)
  berhentiDengar()
  berhentiDengarShift()
})

onMounted(() => {
  store.fetchAll()
  store.fetchAturanDp().catch(() => {})
  activeShiftStore.fetch().catch(() => {})
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

// ---------- Pilihan meja ----------
// Dari GET /admin/reservations/meja — bisa dibaca kasir (dulu dari
// /admin/tables yang khusus admin, jadi untuk kasir daftarnya kosong dan meja
// tidak pernah bisa dipilih). Dimuat ulang setiap jadwalnya berubah, karena
// meja yang sudah direservasi di sekitar jam itu tidak bisa dipilih.
const mejaList = ref([])
const memuatMeja = ref(false)
let urutMeja = 0
async function muatMeja() {
  const ini = ++urutMeja
  memuatMeja.value = true
  try {
    const hasil = await store.fetchMeja({
      waktu: localInputToIso(form.tanggalReservasi) || undefined,
      kecuali: editingId.value ?? undefined,
    })
    if (ini === urutMeja) mejaList.value = hasil
  } catch (err) {
    if (ini === urutMeja) toast.error(formatApiError(err))
  } finally {
    if (ini === urutMeja) memuatMeja.value = false
  }
}
let tundaMeja = null
watch(
  () => form.tanggalReservasi,
  () => {
    if (!formOpen.value) return
    clearTimeout(tundaMeja)
    tundaMeja = setTimeout(muatMeja, 300)
  }
)

// Kenapa sebuah meja tidak bisa dipilih untuk isian form saat ini.
function alasanMeja(t) {
  if (!t.isActive) return 'nonaktif'
  if (t.direservasi) {
    return `sudah direservasi ${t.direservasi.namaCustomer} (${formatDateTime(t.direservasi.waktu)})`
  }
  const tamu = Number(form.jumlahTamu) || 0
  if (tamu > t.kapasitas) return `tidak muat ${tamu} orang`
  return null
}

// Meja aktif, plus — saat mengedit — meja reservasi itu sendiri walau sudah
// dinonaktifkan. Tanpa yang kedua, Select reka-ui menampilkan placeholder
// untuk nilai yang tidak ada di daftar, sehingga meja nonaktif yang masih
// dipakai terbaca "Belum ditentukan" (terlihat belum ada meja).
const tableOptions = computed(() => {
  const currentId = Number(form.tableId)
  return mejaList.value
    .filter((t) => t.isActive || (form.tableId !== NO_TABLE && t.id === currentId))
    .map((t) => ({ ...t, alasan: alasanMeja(t) }))
})
const mejaTerpilihBermasalah = computed(() => {
  if (form.tableId === NO_TABLE) return null
  const t = tableOptions.value.find((x) => String(x.id) === form.tableId)
  return t?.alasan ? `Meja ${t.nomorMeja} ${t.alasan} — pilih meja lain.` : null
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
  form.dpDibayarSekarang = draft?.dpDibayarSekarang ?? ''
  form.metodeDp = draft?.metodeDp ?? 'tunai'
  restoringDraft = false
  formOpen.value = true
  muatMeja()
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
  form.dpDibayarSekarang = ''
  asliEdit.depositAmount = r.depositAmount || 0
  asliEdit.jumlahTamu = r.jumlahTamu
  asliEdit.dibayar = r.dp?.dibayar ?? 0
  asliEdit.status = r.status
  formOpen.value = true
  muatMeja()
}

function onSubmit() {
  if (dpAkanLunas.value) {
    mintaKonfirmasiLunas(
      { nama: form.namaCustomer || 'customer', total: dpWajibForm.value, pending: true },
      simpanForm
    )
    return
  }
  simpanForm()
}

// DP yang dibayar sekarang butuh shift berjalan — tanpa itu, staff memilih:
// mulai shift lalu simpan bersama DP-nya, atau simpan reservasinya saja dan
// DP dicatat nanti lewat Bayar DP.
function simpanForm() {
  if (editingId.value === null && dpBayarForm.value > 0 && belumShift.value) {
    mintaShiftUntukForm()
    return
  }
  kirimForm()
}
function mintaShiftUntukForm() {
  mintaMulaiShift({
    alasan: `DP ${formatRupiah(dpBayarForm.value)} yang dibayar sekarang harus masuk kas shift. Mulai shift dulu — reservasinya langsung disimpan bersama DP-nya.`,
    labelKonfirmasi: 'Mulai Shift & Simpan',
    labelLewati: 'Simpan tanpa DP',
    lanjut: () => kirimForm(),
    lewati: () => kirimForm({ tanpaDp: true }),
  })
}

async function kirimForm({ tanpaDp = false } = {}) {
  submitting.value = true
  try {
    const { dpDibayarSekarang, metodeDp, ...isi } = form
    // Tanpa angka DP wajib — selalu dihitung server dari aturan toko.
    const payload = {
      ...isi,
      tableId: form.tableId === NO_TABLE ? '' : form.tableId,
      tanggalReservasi: localInputToIso(form.tanggalReservasi),
    }
    if (editingId.value) {
      const sesudah = await store.update(editingId.value, payload)
      if (asliEdit.status === 'confirmed' && sesudah?.status === 'pending') {
        toast.warning('Reservasi kembali Pending', {
          description: `DP wajib jadi ${formatRupiah(sesudah.dp.wajib)} — kurang ${formatRupiah(sesudah.dp.kurang)}. Catat lewat Bayar DP (pas); reservasi otomatis dikonfirmasi lagi.`,
        })
      } else {
        toast.success('Reservasi diperbarui')
      }
    } else {
      const bayar = tanpaDp ? 0 : Number(dpDibayarSekarang) || 0
      if (bayar > 0) Object.assign(payload, { dpDibayarSekarang: bayar, metodeDp })
      const hasil = await store.create(payload)
      if (hasil.baruLunas) {
        toast.success('Reservasi ditambahkan — DP lunas', {
          description: `${hasil.dikonfirmasiOtomatis ? 'Reservasi langsung dikonfirmasi. ' : ''}Uang DP sudah tercatat di shift yang sedang berjalan.`,
        })
      } else if (tanpaDp) {
        toast.success('Reservasi ditambahkan — DP belum dicatat', {
          description: 'Catat DP-nya lewat tombol Bayar DP setelah shift dimulai.',
        })
      } else {
        toast.success('Reservasi ditambahkan')
      }
      clearDraft()
    }
    formOpen.value = false
  } catch (err) {
    // Shift diakhiri di tab/perangkat lain sejak halaman ini dimuat — form
    // tetap terbuka, tawarkan mulai shift di tempat.
    if (err.code === 'PERLU_SHIFT' && editingId.value === null) {
      activeShiftStore.fetch().catch(() => {})
      mintaShiftUntukForm()
      return
    }
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

    <div
      v-if="belumShift"
      class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950"
    >
      <span class="flex min-w-0 items-start gap-2 text-amber-900 dark:text-amber-200">
        <TriangleAlertIcon class="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        Kamu belum mulai shift — reservasi tetap bisa dibuat, tapi DP yang
        dibayar customer baru bisa dicatat setelah shift dimulai.
      </span>
      <Button size="sm" variant="outline" @click="mintaMulaiShift()">Mulai Shift</Button>
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
                <!-- Konfirmasi manual hanya kalau syaratnya terpenuhi (tanpa DP
                wajib, atau DP sudah lunas). Yang DP-nya belum lunas
                dikonfirmasi otomatis begitu Bayar DP melunasinya. -->
                <Button
                  v-if="r.status === 'pending' && (r.dp?.status === 'tidak_perlu' || r.dp?.status === 'lunas')"
                  size="sm"
                  variant="outline"
                  :disabled="statusBusyId === r.id"
                  @click="onChangeStatus(r, 'confirmed')"
                >
                  Konfirmasi
                </Button>
                <Button
                  v-if="bisaMulaiPesanan(r)"
                  size="sm"
                  variant="outline"
                  class="gap-1.5"
                  @click="bukaQrRombongan(r)"
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
            Meja harus muat dan belum direservasi di sekitar jam itu. DP wajib
            mengikuti aturan toko dan dibayar pas.
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
          <!-- Satu kolom di HP: input tanggal & jam bawaan browser terlalu sempit
          di setengah lebar dialog 360px — jamnya terpotong. -->
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                  :disabled="!!t.alasan"
                >
                  Meja {{ t.nomorMeja }} (maks {{ t.kapasitas }} orang){{ t.alasan ? ` — ${t.alasan}` : '' }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p v-if="mejaTerpilihBermasalah" class="text-xs font-medium text-destructive">
              {{ mejaTerpilihBermasalah }}
            </p>
            <p v-else-if="!form.tanggalReservasi" class="text-xs text-muted-foreground">
              Isi tanggal &amp; jam dulu supaya meja yang sudah direservasi di jam itu ditandai.
            </p>
            <p v-else-if="memuatMeja" class="text-xs text-muted-foreground">Memeriksa meja…</p>
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
          <!-- DP wajib hanya ditampilkan: selalu dari aturan toko, tidak bisa
          diubah per reservasi oleh siapa pun (server yang menghitung). -->
          <div class="space-y-1 rounded-md border p-3">
            <div class="flex items-center justify-between gap-3 text-sm">
              <span class="text-muted-foreground">DP wajib</span>
              <span class="font-semibold">{{
                dpWajibForm > 0 ? formatRupiah(dpWajibForm) : 'Tidak perlu DP'
              }}</span>
            </div>
            <p class="text-xs text-muted-foreground">{{ keteranganDpWajib }}</p>
            <p v-if="dpEditDiBawahDibayar" class="text-xs font-medium text-destructive">
              DP yang sudah dibayar ({{ formatRupiah(asliEdit.dibayar) }}) lebih besar dari DP
              wajib untuk {{ form.jumlahTamu }} tamu. Kelebihannya tidak bisa dikembalikan lewat
              sistem — kalau tamunya memang berkurang, batalkan reservasi ini lalu buat yang baru.
            </p>
            <p v-else-if="dpEditJadiKurang" class="text-xs font-medium text-status-waiting-verif">
              Kurang {{ formatRupiah(dpWajibForm - asliEdit.dibayar) }} — setelah disimpan,
              catat lewat Bayar DP (pas).<template v-if="asliEdit.status === 'confirmed'">
                Reservasi kembali Pending sampai kekurangannya dibayar.</template>
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
            <p v-if="dpBayarTidakPas" class="text-xs font-medium text-destructive">
              DP harus dibayar pas {{ formatRupiah(dpWajibForm) }} — tidak bisa kurang (dicicil)
              atau lebih.
            </p>
            <p
              v-else-if="dpAkanLunas"
              class="flex items-center gap-1.5 text-xs font-medium text-status-completed"
            >
              <CircleCheckIcon class="size-3.5 shrink-0" />
              Lunas — reservasi langsung dikonfirmasi dan mejanya dipegang.
            </p>
            <p v-else class="text-xs text-muted-foreground">
              Kosongkan kalau customer belum membayar — reservasi disimpan Pending: meja belum
              dipegang dan QR rombongan belum tersedia sampai DP dibayar pas lewat Bayar DP.
            </p>
            <p
              v-if="belumShift && dpAkanLunas"
              class="flex items-start gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400"
            >
              <TriangleAlertIcon class="mt-px size-3.5 shrink-0" />
              Kamu belum mulai shift. Saat menyimpan, kamu diminta mulai shift
              dulu supaya DP ini masuk kas shift — atau simpan tanpa DP.
            </p>
          </div>
        </form>
        <DialogFooter>
          <Button
            type="submit"
            form="reservation-form"
            :disabled="submitting || dpBayarTidakPas || !!mejaTerpilihBermasalah || dpEditDiBawahDibayar"
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
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>QR Rombongan — Meja {{ qrReservation?.nomorMeja }}</DialogTitle>
          <DialogDescription class="text-xs">
            Khusus rombongan {{ qrReservation?.namaCustomer }}. Selama reservasi ini berlangsung,
            QR yang tertempel di meja terkunci untuk customer lain — rombongan memesan lewat QR
            ini. Tunjukkan ke tamu, atau bagikan link-nya hanya ke rombongan.
          </DialogDescription>
        </DialogHeader>
        <img
          v-if="qrReservation"
          :src="qrImageUrl(qrReservation.id)"
          alt="QR rombongan reservasi"
          class="mx-auto w-full max-w-56 rounded-lg border"
        />
        <p class="break-all text-center text-xs text-muted-foreground">{{ qrLink }}</p>
        <DialogFooter class="grid grid-cols-2">
          <Button variant="outline" class="gap-2" @click="salinLinkRombongan">
            <CopyIcon class="size-4" />
            Salin Link
          </Button>
          <Button as="a" :href="qrLink" target="_blank" rel="noopener" variant="outline" class="gap-2">
            <ExternalLinkIcon class="size-4" />
            Buka Menu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Catat pembayaran DP — bisa dicicil sampai lunas. -->
    <Dialog :open="!!bayarTarget" @update:open="(v) => !v && (bayarTarget = null)">
      <DialogContent class="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bayar DP — {{ bayarTarget?.namaCustomer }}</DialogTitle>
          <DialogDescription>
            Catat uang DP yang diterima sekarang — harus pas sebesar kekurangannya.
            Uangnya langsung masuk DP reservasi di shift yang sedang berjalan.
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
          <p v-if="bayarTidakPas" class="text-xs font-medium text-destructive">
            DP harus dibayar pas {{ formatRupiah(bayarTarget.dp.kurang) }} — tidak bisa dicicil
            atau lebih.
          </p>
          <p
            v-else-if="bayarMelunasi"
            class="flex items-center gap-1.5 text-xs font-medium text-status-completed"
          >
            <CircleCheckIcon class="size-3.5 shrink-0" />
            Pembayaran ini melunasi DP<template v-if="bayarTarget.status === 'pending'">
              — reservasi langsung dikonfirmasi</template>.
          </p>
          <p
            v-if="belumShift"
            class="flex items-start gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400"
          >
            <TriangleAlertIcon class="mt-px size-3.5 shrink-0" />
            Kamu belum mulai shift. Sebelum dicatat, kamu diminta mulai shift
            dulu supaya uang DP ini masuk kas shift.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" :disabled="savingBayar" @click="bayarTarget = null">
            Batal
          </Button>
          <Button :disabled="savingBayar || !bayarMelunasi" @click="onBayarClick">
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

    <!-- Mulai shift di tempat — syarat mencatat DP. -->
    <StartShiftDialog
      :open="shiftDialog.open"
      :alasan="shiftDialog.alasan"
      :label-konfirmasi="shiftDialog.labelKonfirmasi"
      :label-lewati="shiftDialog.labelLewati"
      @update:open="(v) => (shiftDialog.open = v)"
      @dimulai="onShiftDimulai"
      @lewati="onLewatiShift"
    />

    <!-- Aturan DP toko (admin). -->
    <Dialog :open="aturanOpen" @update:open="(v) => (aturanOpen = v)">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Aturan DP reservasi</DialogTitle>
          <DialogDescription>
            Berapa yang wajib dibayar untuk membuka reservasi. Dipakai sebagai
            DP wajib setiap reservasi baru dan tidak bisa diubah per
            reservasi — DP-nya dibayar pas.
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
