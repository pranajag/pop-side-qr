<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { api, formatApiError } from '@/lib/api'
import { formatRupiah, formatDateTime } from '@/lib/format'
import { useAuthStore } from '@/stores/auth'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { LoaderCircleIcon, PlayIcon, SquareIcon, TriangleAlertIcon, InfoIcon } from '@lucide/vue'

const auth = useAuthStore()
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

async function onStart() {
  busy.value = true
  try {
    await api.post('/admin/shifts/start')
    toast.success('Shift dimulai')
    await load()
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

function openEndDialog() {
  cashCountedInput.value = ''
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

async function onEndConfirm() {
  if (cashCountedNumber.value === null) {
    toast.error('Masukkan jumlah uang tunai yang valid')
    return
  }
  busy.value = true
  try {
    const { shift } = await api.post('/admin/shifts/end', { cashCounted: cashCountedNumber.value })
    endDialogOpen.value = false
    if (shift.isMinus) {
      toast.error(`Shift diakhiri — kas MINUS ${formatRupiah(Math.abs(shift.cashDifference))}`)
    } else if (shift.cashDifference > 0) {
      toast.success(`Shift diakhiri — kas lebih ${formatRupiah(shift.cashDifference)}`)
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
  const minutes = Math.max(0, Math.floor((end - new Date(startedAt).getTime()) / 60000))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}j ${m}m` : `${m}m`
}

function reconBadgeClass(diff) {
  if (diff < 0) return 'bg-destructive text-white'
  if (diff > 0) return 'bg-status-ready text-white'
  return 'bg-status-completed text-white'
}

function reconLabel(diff) {
  if (diff < 0) return `Minus ${formatRupiah(Math.abs(diff))}`
  if (diff > 0) return `Lebih ${formatRupiah(diff)}`
  return 'Pas'
}

const activeDuration = computed(() => (active.value ? formatDuration(active.value.startedAt, null) : null))

// A shift open this long almost certainly means someone forgot to click
// "Akhiri Shift", not that they're genuinely still clocked in — flagging it
// here (not just relying on the person themselves to notice) is what stops
// a forgotten shift from silently double-counting orders alongside whoever
// starts the next one. 8h is a generous cutoff for a single cafe shift.
const STALE_SHIFT_MS = 8 * 60 * 60 * 1000
const staleOtherShifts = computed(() =>
  shifts.value.filter(
    (s) => s.isActive && s.username !== auth.user?.username && now.value - new Date(s.startedAt).getTime() > STALE_SHIFT_MS
  )
)
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-lg font-semibold tracking-tight">Shift</h1>
      <p class="text-sm text-muted-foreground">Catat jam kerja dan lihat hasil tiap shift yang sudah berjalan.</p>
    </div>

    <Alert v-if="staleOtherShifts.length > 0" variant="destructive">
      <TriangleAlertIcon class="size-4" />
      <AlertTitle>Ada shift yang mungkin lupa diakhiri</AlertTitle>
      <AlertDescription>
        <span v-for="(s, i) in staleOtherShifts" :key="s.id">
          {{ s.username }} sejak {{ formatDateTime(s.startedAt) }}{{ i < staleOtherShifts.length - 1 ? ', ' : '' }}
        </span>
        — order baru masih ikut terhitung ke shift ini selama belum diakhiri.
      </AlertDescription>
    </Alert>

    <div class="rounded-lg border bg-card p-4">
      <div v-if="active" class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <span class="flex size-10 shrink-0 items-center justify-center rounded-full bg-status-confirmed/15 text-status-confirmed">
            <span class="size-2.5 animate-pulse rounded-full bg-status-confirmed"></span>
          </span>
          <div>
            <p class="text-sm font-semibold">
              Shift {{ auth.user?.username }} sedang berjalan
              <span class="font-normal text-muted-foreground">· {{ activeDuration }}</span>
            </p>
            <p class="text-xs text-muted-foreground">Mulai {{ formatDateTime(active.startedAt) }}</p>
          </div>
        </div>
        <div class="flex items-center gap-4">
          <div class="text-right text-sm">
            <p class="font-semibold">{{ active.orderCount }} order &middot; {{ formatRupiah(active.revenue) }}</p>
            <p class="text-xs text-muted-foreground">Sejauh ini &middot; tunai {{ formatRupiah(active.expectedCash) }}</p>
          </div>
          <Button variant="destructive" class="gap-2" :disabled="busy" @click="openEndDialog">
            <SquareIcon class="size-4" />
            Akhiri Shift
          </Button>
        </div>
      </div>
      <div v-else class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p class="text-sm font-semibold">Kamu belum mulai shift</p>
          <p class="text-xs text-muted-foreground">Mulai shift supaya order yang masuk tercatat di hasil shift ini.</p>
        </div>
        <Button class="gap-2" :disabled="busy" @click="onStart">
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
          <TableEmpty v-if="!loading && shifts.length === 0" :colspan="auth.isAdmin ? 7 : 5">Belum ada shift.</TableEmpty>
          <TableRow v-for="s in shifts" :key="s.id">
            <TableCell class="font-medium">{{ s.username }}</TableCell>
            <TableCell class="text-sm text-muted-foreground">{{ formatDateTime(s.startedAt) }}</TableCell>
            <TableCell class="text-sm text-muted-foreground">
              <Badge v-if="s.isActive" class="bg-status-confirmed text-white">Sedang Berjalan</Badge>
              <span v-else>{{ formatDateTime(s.endedAt) }}</span>
            </TableCell>
            <TableCell class="text-sm">{{ s.orderCount }}</TableCell>
            <TableCell class="text-sm font-medium">{{ formatRupiah(s.revenue) }}</TableCell>
            <TableCell v-if="auth.isAdmin" class="text-sm">
              <Badge v-if="s.cashDifference !== null" :class="reconBadgeClass(s.cashDifference)">
                {{ reconLabel(s.cashDifference) }}
              </Badge>
              <span v-else class="text-muted-foreground">&mdash;</span>
            </TableCell>
            <TableCell v-if="auth.isAdmin" class="text-right">
              <Button v-if="!s.isActive" variant="ghost" size="sm" @click="openDetail(s)">Detail</Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <Dialog :open="endDialogOpen" @update:open="(v) => (endDialogOpen = v)">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Akhiri Shift</DialogTitle>
        </DialogHeader>
        <div class="space-y-4">
          <p class="text-sm text-muted-foreground">
            Hitung uang tunai fisik di laci sekarang, lalu masukkan jumlahnya. Sistem mencatat
            <strong>{{ formatRupiah(active?.expectedCash ?? 0) }}</strong> dari transaksi tunai shift ini.
          </p>
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
          <Alert v-if="cashCountedNumber !== null && cashCountedNumber < (active?.expectedCash ?? 0)" variant="destructive">
            <TriangleAlertIcon class="size-4" />
            <AlertTitle>Kas akan tercatat MINUS</AlertTitle>
            <AlertDescription>
              Selisih {{ formatRupiah((active?.expectedCash ?? 0) - cashCountedNumber) }} dari yang seharusnya.
            </AlertDescription>
          </Alert>
        </div>
        <DialogFooter>
          <Button variant="outline" :disabled="busy" @click="endDialogOpen = false">Batal</Button>
          <Button variant="destructive" :disabled="busy || cashCountedNumber === null" @click="onEndConfirm">
            <LoaderCircleIcon v-if="busy" class="size-4 animate-spin" />
            Konfirmasi Akhiri Shift
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog :open="!!detailShiftId" @update:open="(v) => !v && (detailShiftId = null)">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Detail Shift {{ detailData?.username }}</DialogTitle>
        </DialogHeader>
        <div v-if="detailLoading" class="flex justify-center py-8">
          <LoaderCircleIcon class="size-6 animate-spin text-muted-foreground" />
        </div>
        <div v-else-if="detailData" class="space-y-4">
          <div class="grid grid-cols-3 gap-3 text-sm">
            <div class="rounded-md border p-2.5">
              <p class="text-xs text-muted-foreground">QRIS</p>
              <p class="font-semibold">{{ formatRupiah(detailData.byMetode.qris) }}</p>
            </div>
            <div class="rounded-md border p-2.5">
              <p class="text-xs text-muted-foreground">Tunai</p>
              <p class="font-semibold">{{ formatRupiah(detailData.byMetode.tunai) }}</p>
            </div>
            <div class="rounded-md border p-2.5">
              <p class="text-xs text-muted-foreground">Debit</p>
              <p class="font-semibold">{{ formatRupiah(detailData.byMetode.debit) }}</p>
            </div>
          </div>

          <div v-if="detailData.cashCounted !== null" class="space-y-1 rounded-md border p-3 text-sm">
            <div class="flex justify-between">
              <span class="text-muted-foreground">Tunai tercatat sistem</span>
              <span>{{ formatRupiah(detailData.expectedCash) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-muted-foreground">Dihitung kasir</span>
              <span>{{ formatRupiah(detailData.cashCounted) }}</span>
            </div>
            <div class="flex justify-between border-t pt-1 font-semibold">
              <span>Selisih</span>
              <span :class="{ 'text-destructive': detailData.isMinus }">{{ reconLabel(detailData.cashDifference) }}</span>
            </div>
          </div>

          <div v-if="detailData.cancelledAfterConfirm.length > 0" class="space-y-2">
            <Alert>
              <InfoIcon class="size-4" />
              <AlertTitle>Kemungkinan penyebab selisih</AlertTitle>
              <AlertDescription>
                Order tunai ini sempat dikonfirmasi (kas dianggap sudah diterima) sebelum dibatalkan — bukan
                kepastian penyebabnya, tapi titik awal yang wajar untuk dicek.
              </AlertDescription>
            </Alert>
            <div v-for="o in detailData.cancelledAfterConfirm" :key="o.kodeOrder" class="rounded-md border p-2.5 text-sm">
              <div class="flex items-center justify-between">
                <span class="font-mono font-medium">{{ o.kodeOrder }}</span>
                <span class="font-medium">{{ formatRupiah(o.totalHarga) }}</span>
              </div>
              <p class="text-xs text-muted-foreground">Dibatalkan {{ formatDateTime(o.cancelledAt) }}</p>
              <p v-if="o.alasan" class="mt-1 text-xs italic text-muted-foreground">"{{ o.alasan }}"</p>
              <p v-if="o.refundAmount !== null" class="mt-1 text-xs text-status-completed">
                Sudah dikembalikan {{ formatRupiah(o.refundAmount) }}
              </p>
              <p v-else class="mt-1 text-xs text-amber-600">Belum dicatat apakah uangnya dikembalikan</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
