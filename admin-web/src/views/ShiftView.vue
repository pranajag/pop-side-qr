<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { api, formatApiError, API_URL } from '@/lib/api'
import { formatRupiah, formatDateTime } from '@/lib/format'
import { useAuthStore } from '@/stores/auth'
import { useActiveShiftStore } from '@/stores/activeShift'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  LoaderCircleIcon,
  PlayIcon,
  SquareIcon,
  TriangleAlertIcon,
  InfoIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
} from '@lucide/vue'

const auth = useAuthStore()
const activeShiftStore = useActiveShiftStore()
const active = ref(null)
const shifts = ref([])
const loading = ref(false)
const busy = ref(false)

// Ticks the "sedang berlangsung" duration + live stats display without
// needing a fresh fetch every second — only refetch on start/end/refresh.
const now = ref(Date.now())
let clockTimer = null

async function load() {
  loading.value = true
  try {
    const [activeRes, listRes] = await Promise.all([
      api.get('/admin/shifts/active'),
      api.get('/admin/shifts?limit=50'),
    ])
    active.value = activeRes.shift
    shifts.value = listRes.shifts
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  load()
  clockTimer = setInterval(() => {
    now.value = Date.now()
  }, 30000)
})
onUnmounted(() => clearInterval(clockTimer))

// Starting a shift now requires counting the starting float first — same
// reasoning as the end-shift dialog below: expectedCash at end-shift is
// meaningless without knowing what the drawer started with.
const startDialogOpen = ref(false)
const cashStartInput = ref('')
// Who's actually on shift, separate from which login account is doing the
// clicking — a shared kasir/admin login otherwise leaves no record of
// which real person was working (schema.prisma's Shift.namaStaff comment).
const namaStaffInput = ref('')

function openStartDialog() {
  cashStartInput.value = ''
  namaStaffInput.value = ''
  startDialogOpen.value = true
}

const cashStartNumber = computed(() => {
  const raw = cashStartInput.value
  if (raw === '' || raw === null || raw === undefined) return null
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : null
})

async function onStartConfirm() {
  if (cashStartNumber.value === null) {
    toast.error('Masukkan jumlah kas awal yang valid')
    return
  }
  if (!namaStaffInput.value.trim()) {
    toast.error('Masukkan nama staff yang sedang shift')
    return
  }
  busy.value = true
  try {
    await api.post('/admin/shifts/start', {
      cashStart: cashStartNumber.value,
      namaStaff: namaStaffInput.value.trim(),
    })
    startDialogOpen.value = false
    toast.success('Shift dimulai')
    await load()
    activeShiftStore.fetch()
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    busy.value = false
  }
}

// Ending a shift now requires counting the drawer first — this dialog is
// both the cash-reconciliation input AND the confirmation step for an
// action that locks in the shift's final numbers.
const endDialogOpen = ref(false)
const cashCountedInput = ref('')

const gojekInput = ref('')
const grabfoodInput = ref('')

function openEndDialog() {
  cashCountedInput.value = ''
  gojekInput.value = ''
  grabfoodInput.value = ''
  endDialogOpen.value = true
}

// cashCountedInput ends up a Number, not a string, once typed — Vue's
// compiler auto-applies numeric casting to v-model on a native
// type="number" input even without an explicit .number modifier. Must not
// assume it's always a string (a bare .trim() call blew up on that).
const cashCountedNumber = computed(() => {
  const raw = cashCountedInput.value
  if (raw === '' || raw === null || raw === undefined) return null
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : null
})

function parseAmount(raw) {
  if (raw === '' || raw === null || raw === undefined) return null
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : null
}
const gojekNumber = computed(() => parseAmount(gojekInput.value))
const grabfoodNumber = computed(() => parseAmount(grabfoodInput.value))

async function onEndConfirm() {
  if (cashCountedNumber.value === null) {
    toast.error('Masukkan jumlah uang tunai yang valid')
    return
  }
  busy.value = true
  try {
    const { shift } = await api.post('/admin/shifts/end', {
      cashCounted: cashCountedNumber.value,
      // Optional — omitted entirely (not sent as 0) when left blank, so a
      // shift with genuinely no Gojek/GrabFood orders doesn't need the
      // kasir to type a 0 they're not actually sure about.
      gojekAmount: gojekNumber.value ?? undefined,
      grabfoodAmount: grabfoodNumber.value ?? undefined,
    })
    endDialogOpen.value = false
    activeShiftStore.fetch()
    if (shift.isMinus) {
      toast.error(
        `Shift diakhiri — kas MINUS ${formatRupiah(Math.abs(shift.cashDifference))}`
      )
    } else if (shift.cashDifference > 0) {
      toast.success(
        `Shift diakhiri — kas lebih ${formatRupiah(shift.cashDifference)}`
      )
    } else {
      toast.success('Shift diakhiri — kas pas')
    }
    await load()
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    busy.value = false
  }
}

// Detail dialog — breakdown by payment method + candidate causes for a
// cash shortfall, fetched on demand per shift (not part of the list call).
const detailShiftId = ref(null)
const detailData = ref(null)
const detailLoading = ref(false)

// Plain GET behind the session cookie, same as qrImageUrl/buktiBayarUrl
// elsewhere — no CSRF token needed (GET is exempt server-side too) and a
// direct navigation lets the browser handle the download/Content-
// Disposition itself instead of round-tripping a blob through JS.
function reportUrl(shiftId, ext) {
  return `${API_URL}/admin/shifts/${shiftId}/report.${ext}`
}

async function openDetail(shift) {
  detailShiftId.value = shift.id
  detailData.value = null
  detailLoading.value = true
  try {
    const { shift: detail } = await api.get(`/admin/shifts/${shift.id}`)
    detailData.value = detail
  } catch (err) {
    toast.error(formatApiError(err))
    detailShiftId.value = null
  } finally {
    detailLoading.value = false
  }
}

function formatDuration(startedAt, endedAt) {
  const end = endedAt ? new Date(endedAt).getTime() : now.value
  const minutes = Math.max(
    0,
    Math.floor((end - new Date(startedAt).getTime()) / 60000)
  )
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}j ${m}m` : `${m}m`
}

function reconBadgeClass(diff) {
  if (diff < 0) return 'bg-destructive text-destructive-foreground'
  if (diff > 0) return 'bg-status-ready text-status-ready-foreground'
  return 'bg-status-completed text-status-completed-foreground'
}

function reconLabel(diff) {
  if (diff < 0) return `Minus ${formatRupiah(Math.abs(diff))}`
  if (diff > 0) return `Lebih ${formatRupiah(diff)}`
  return 'Pas'
}

const activeDuration = computed(() =>
  active.value ? formatDuration(active.value.startedAt, null) : null
)

// A shift open this long almost certainly means someone forgot to click
// "Akhiri Shift", not that they're genuinely still clocked in — flagging it
// here (not just relying on the person themselves to notice) is what stops
// a forgotten shift from silently double-counting orders alongside whoever
// starts the next one. 8h is a generous cutoff for a single cafe shift.
const STALE_SHIFT_MS = 8 * 60 * 60 * 1000
const staleOtherShifts = computed(() =>
  shifts.value.filter(
    (s) =>
      s.isActive &&
      s.username !== auth.user?.username &&
      now.value - new Date(s.startedAt).getTime() > STALE_SHIFT_MS
  )
)
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-lg font-semibold tracking-tight">Shift</h1>
      <p class="text-sm text-muted-foreground">
        Catat jam kerja dan lihat hasil tiap shift yang sudah berjalan.
      </p>
    </div>

    <Alert v-if="staleOtherShifts.length > 0" variant="destructive">
      <TriangleAlertIcon class="size-4" />
      <AlertTitle>Ada shift yang mungkin lupa diakhiri</AlertTitle>
      <AlertDescription>
        <span v-for="(s, i) in staleOtherShifts" :key="s.id">
          {{ s.namaStaff || s.username }} sejak {{ formatDateTime(s.startedAt)
          }}{{ i < staleOtherShifts.length - 1 ? ', ' : '' }}
        </span>
        — order baru masih ikut terhitung ke shift ini selama belum diakhiri.
      </AlertDescription>
    </Alert>

    <div class="rounded-lg border bg-card p-4">
      <div
        v-if="active"
        class="flex flex-wrap items-center justify-between gap-4"
      >
        <div class="flex items-center gap-3">
          <span
            class="flex size-10 shrink-0 items-center justify-center rounded-full bg-status-confirmed/15 text-status-confirmed"
          >
            <span
              class="size-2.5 animate-pulse rounded-full bg-status-confirmed"
            ></span>
          </span>
          <div>
            <p class="text-sm font-semibold">
              Shift {{ auth.user?.username }} sedang berjalan
              <span class="font-normal text-muted-foreground"
                >· {{ activeDuration }}</span
              >
            </p>
            <p class="text-xs text-muted-foreground">
              Mulai {{ formatDateTime(active.startedAt) }}
            </p>
          </div>
        </div>
        <div class="flex items-center gap-4">
          <div class="text-right text-sm">
            <p class="font-semibold">
              {{ active.orderCount }} order &middot;
              {{ formatRupiah(active.revenue) }}
            </p>
            <p class="text-xs text-muted-foreground">
              Kas awal {{ formatRupiah(active.cashStart ?? 0) }} &middot;
              seharusnya di laci {{ formatRupiah(active.expectedCash) }}
            </p>
          </div>
          <Button
            variant="destructive"
            class="gap-2"
            :disabled="busy"
            @click="openEndDialog"
          >
            <SquareIcon class="size-4" />
            Akhiri Shift
          </Button>
        </div>
      </div>
      <div v-else class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p class="text-sm font-semibold">Kamu belum mulai shift</p>
          <p class="text-xs text-muted-foreground">
            Mulai shift supaya order yang masuk tercatat di hasil shift ini.
          </p>
        </div>
        <Button class="gap-2" :disabled="busy" @click="openStartDialog">
          <LoaderCircleIcon v-if="busy" class="size-4 animate-spin" />
          <PlayIcon v-else class="size-4" />
          Mulai Shift
        </Button>
      </div>
    </div>

    <div class="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Staff</TableHead>
            <TableHead class="w-44">Mulai</TableHead>
            <TableHead class="w-44">Selesai</TableHead>
            <TableHead class="w-24">Order</TableHead>
            <TableHead class="w-36">Pendapatan</TableHead>
            <TableHead v-if="auth.isAdmin" class="w-40">Kas Tunai</TableHead>
            <TableHead v-if="auth.isAdmin" class="w-24"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableEmpty
            v-if="!loading && shifts.length === 0"
            :colspan="auth.isAdmin ? 7 : 5"
            >Belum ada shift.</TableEmpty
          >
          <TableRow v-for="s in shifts" :key="s.id">
            <TableCell class="font-medium" data-label="Staff">
              {{ s.namaStaff || s.username }}
              <span v-if="s.namaStaff" class="block text-xs font-normal text-muted-foreground"
                >akun {{ s.username }}</span
              >
            </TableCell>
            <TableCell class="text-sm text-muted-foreground" data-label="Mulai">{{
              formatDateTime(s.startedAt)
            }}</TableCell>
            <TableCell class="text-sm text-muted-foreground" data-label="Selesai">
              <Badge
                v-if="s.isActive"
                class="bg-status-confirmed text-status-confirmed-foreground"
                >Sedang Berjalan</Badge
              >
              <span v-else>{{ formatDateTime(s.endedAt) }}</span>
            </TableCell>
            <TableCell class="text-sm" data-label="Order">{{ s.orderCount }}</TableCell>
            <TableCell class="text-sm font-medium" data-label="Pendapatan">{{
              formatRupiah(s.revenue)
            }}</TableCell>
            <TableCell v-if="auth.isAdmin" class="text-sm" data-label="Kas Tunai">
              <Badge
                v-if="s.cashDifference !== null"
                :class="reconBadgeClass(s.cashDifference)"
              >
                {{ reconLabel(s.cashDifference) }}
              </Badge>
              <span v-else class="text-muted-foreground">&mdash;</span>
            </TableCell>
            <TableCell v-if="auth.isAdmin" class="text-right" data-label="Aksi">
              <Button
                v-if="!s.isActive"
                variant="ghost"
                size="sm"
                @click="openDetail(s)"
                >Detail</Button
              >
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <Dialog :open="startDialogOpen" @update:open="(v) => (startDialogOpen = v)">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mulai Shift</DialogTitle>
          <DialogDescription>
            Hitung uang kas yang ada di laci sekarang sebelum mulai jualan, lalu
            masukkan jumlahnya. Ini dipakai sebagai patokan awal saat
            rekonsiliasi kas di akhir shift nanti.
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-4">
          <div class="space-y-2">
            <Label for="nama-staff">Nama Staff yang Shift</Label>
            <Input
              id="nama-staff"
              v-model="namaStaffInput"
              placeholder="Mis. Budi"
              autofocus
            />
          </div>
          <div class="space-y-2">
            <Label for="cash-start">Uang Kas Awal</Label>
            <Input
              id="cash-start"
              v-model="cashStartInput"
              type="number"
              min="0"
              step="500"
              placeholder="0"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            :disabled="busy"
            @click="startDialogOpen = false"
            >Batal</Button
          >
          <Button
            :disabled="busy || cashStartNumber === null || !namaStaffInput.trim()"
            @click="onStartConfirm"
          >
            <LoaderCircleIcon v-if="busy" class="size-4 animate-spin" />
            Konfirmasi Mulai Shift
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog :open="endDialogOpen" @update:open="(v) => (endDialogOpen = v)">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Akhiri Shift</DialogTitle>
          <DialogDescription>
            Hitung uang tunai fisik di laci sekarang, lalu masukkan jumlahnya.
            Kas awal
            <strong>{{ formatRupiah(active?.cashStart ?? 0) }}</strong> + tunai
            terjual
            <strong>{{ formatRupiah(active?.byMetode?.tunai ?? 0) }}</strong> —
            sistem mencatat seharusnya ada
            <strong>{{ formatRupiah(active?.expectedCash ?? 0) }}</strong> di
            laci.
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-4">
          <div class="space-y-2">
            <Label for="cash-counted">Uang Tunai di Laci</Label>
            <Input
              id="cash-counted"
              v-model="cashCountedInput"
              type="number"
              min="0"
              step="500"
              placeholder="0"
              autofocus
            />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-2">
              <Label for="gojek-amount">Uang Gojek (opsional)</Label>
              <Input
                id="gojek-amount"
                v-model="gojekInput"
                type="number"
                min="0"
                step="500"
                placeholder="Kosongkan kalau tidak ada"
              />
            </div>
            <div class="space-y-2">
              <Label for="grabfood-amount">Uang GrabFood (opsional)</Label>
              <Input
                id="grabfood-amount"
                v-model="grabfoodInput"
                type="number"
                min="0"
                step="500"
                placeholder="Kosongkan kalau tidak ada"
              />
            </div>
          </div>
          <p class="text-xs text-muted-foreground">
            Order dari aplikasi ojol tidak masuk sistem ini — isi manual dari
            total penjualan masing-masing. Isi 0 kalau tidak ada.
          </p>
          <Alert
            v-if="
              cashCountedNumber !== null &&
              cashCountedNumber < (active?.expectedCash ?? 0)
            "
            variant="destructive"
          >
            <TriangleAlertIcon class="size-4" />
            <AlertTitle>Kas akan tercatat MINUS</AlertTitle>
            <AlertDescription>
              Selisih
              {{
                formatRupiah((active?.expectedCash ?? 0) - cashCountedNumber)
              }}
              dari yang seharusnya.
            </AlertDescription>
          </Alert>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            :disabled="busy"
            @click="endDialogOpen = false"
            >Batal</Button
          >
          <Button
            variant="destructive"
            :disabled="busy || cashCountedNumber === null"
            @click="onEndConfirm"
          >
            <LoaderCircleIcon v-if="busy" class="size-4 animate-spin" />
            Konfirmasi Akhiri Shift
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog
      :open="!!detailShiftId"
      @update:open="(v) => !v && (detailShiftId = null)"
    >
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Detail Shift {{ detailData?.namaStaff || detailData?.username }}</DialogTitle>
          <DialogDescription class="sr-only">
            Rincian satu shift: waktu mulai dan selesai, pendapatan per metode
            bayar, dan hasil rekonsiliasi kasnya.
          </DialogDescription>
        </DialogHeader>
        <div v-if="detailLoading" class="flex justify-center py-8">
          <LoaderCircleIcon class="size-6 animate-spin text-muted-foreground" />
        </div>
        <div v-else-if="detailData" class="space-y-4">
          <div class="flex gap-2">
            <a :href="reportUrl(detailData.id, 'xlsx')" class="flex-1">
              <Button variant="outline" size="sm" class="w-full gap-2">
                <FileSpreadsheetIcon class="size-3.5" />
                Unduh Excel
              </Button>
            </a>
            <a :href="reportUrl(detailData.id, 'pdf')" class="flex-1">
              <Button variant="outline" size="sm" class="w-full gap-2">
                <FileTextIcon class="size-3.5" />
                Unduh PDF
              </Button>
            </a>
          </div>
          <div class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div class="rounded-md border p-2.5">
              <p class="text-xs text-muted-foreground">QRIS</p>
              <p class="font-semibold">
                {{ formatRupiah(detailData.byMetode.qris) }}
              </p>
            </div>
            <div class="rounded-md border p-2.5">
              <p class="text-xs text-muted-foreground">Tunai</p>
              <p class="font-semibold">
                {{ formatRupiah(detailData.byMetode.tunai) }}
              </p>
            </div>
            <div class="rounded-md border p-2.5">
              <p class="text-xs text-muted-foreground">Debit</p>
              <p class="font-semibold">
                {{ formatRupiah(detailData.byMetode.debit) }}
              </p>
            </div>
            <div class="rounded-md border p-2.5">
              <p class="text-xs text-muted-foreground">Gojek</p>
              <p class="font-semibold">
                {{
                  detailData.gojekAmount === null
                    ? '—'
                    : formatRupiah(detailData.gojekAmount)
                }}
              </p>
            </div>
            <div class="rounded-md border p-2.5">
              <p class="text-xs text-muted-foreground">GrabFood</p>
              <p class="font-semibold">
                {{
                  detailData.grabfoodAmount === null
                    ? '—'
                    : formatRupiah(detailData.grabfoodAmount)
                }}
              </p>
            </div>
          </div>
          <div
            v-if="detailData.onlineSalesAmount !== null"
            class="flex justify-between rounded-md border p-2.5 text-sm"
          >
            <span class="text-muted-foreground"
              >Total Pendapatan (termasuk online)</span
            >
            <span class="font-semibold">{{
              formatRupiah(detailData.totalRevenueWithOnline)
            }}</span>
          </div>

          <div
            v-if="detailData.cashCounted !== null"
            class="space-y-1 rounded-md border p-3 text-sm"
          >
            <div class="flex justify-between">
              <span class="text-muted-foreground">Kas awal</span>
              <span>{{
                detailData.cashStart === null
                  ? '—'
                  : formatRupiah(detailData.cashStart)
              }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">Tunai terjual</span>
              <span>{{ formatRupiah(detailData.byMetode.tunai) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">Seharusnya di laci</span>
              <span>{{ formatRupiah(detailData.expectedCash) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">Dihitung kasir</span>
              <span>{{ formatRupiah(detailData.cashCounted) }}</span>
            </div>
            <div class="flex justify-between border-t pt-1 font-semibold">
              <span>Selisih</span>
              <span :class="{ 'text-destructive': detailData.isMinus }">{{
                reconLabel(detailData.cashDifference)
              }}</span>
            </div>
          </div>

          <div
            v-if="detailData.cancelledAfterConfirm.length > 0"
            class="space-y-2"
          >
            <Alert>
              <InfoIcon class="size-4" />
              <AlertTitle>Kemungkinan penyebab selisih</AlertTitle>
              <AlertDescription>
                Order tunai ini sempat dikonfirmasi (kas dianggap sudah
                diterima) sebelum dibatalkan — bukan kepastian penyebabnya, tapi
                titik awal yang wajar untuk dicek.
              </AlertDescription>
            </Alert>
            <div
              v-for="o in detailData.cancelledAfterConfirm"
              :key="o.kodeOrder"
              class="rounded-md border p-2.5 text-sm"
            >
              <div class="flex items-center justify-between">
                <span class="font-mono font-medium">{{ o.kodeOrder }}</span>
                <span class="font-medium">{{
                  formatRupiah(o.totalHarga)
                }}</span>
              </div>
              <p class="text-xs text-muted-foreground">
                Dibatalkan {{ formatDateTime(o.cancelledAt) }}
              </p>
              <p
                v-if="o.alasan"
                class="mt-1 text-xs italic text-muted-foreground"
              >
                "{{ o.alasan }}"
              </p>
              <p
                v-if="o.refundAmount !== null"
                class="mt-1 text-xs text-status-completed"
              >
                Sudah dikembalikan {{ formatRupiah(o.refundAmount) }}
              </p>
              <p v-else class="mt-1 text-xs text-amber-600 dark:text-amber-400">
                Belum dicatat apakah uangnya dikembalikan
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
