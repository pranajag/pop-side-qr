<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { api, formatApiError } from '@/lib/api'
import { formatRupiah, formatDateTime } from '@/lib/format'
import { useAuthStore } from '@/stores/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { LoaderCircleIcon, PlayIcon, SquareIcon } from '@lucide/vue'

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

async function onEnd() {
  busy.value = true
  try {
    await api.post('/admin/shifts/end')
    toast.success('Shift diakhiri')
    await load()
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    busy.value = false
  }
}

function formatDuration(startedAt, endedAt) {
  const end = endedAt ? new Date(endedAt).getTime() : now.value
  const minutes = Math.max(0, Math.floor((end - new Date(startedAt).getTime()) / 60000))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}j ${m}m` : `${m}m`
}

const activeDuration = computed(() => (active.value ? formatDuration(active.value.startedAt, null) : null))
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-lg font-semibold tracking-tight">Shift</h1>
      <p class="text-sm text-muted-foreground">Catat jam kerja dan lihat hasil tiap shift yang sudah berjalan.</p>
    </div>

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
            <p class="text-xs text-muted-foreground">Sejauh ini</p>
          </div>
          <Button variant="destructive" class="gap-2" :disabled="busy" @click="onEnd">
            <LoaderCircleIcon v-if="busy" class="size-4 animate-spin" />
            <SquareIcon v-else class="size-4" />
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
            <TableHead class="w-24">Durasi</TableHead>
            <TableHead class="w-24">Order</TableHead>
            <TableHead class="w-36">Pendapatan</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableEmpty v-if="!loading && shifts.length === 0" :colspan="6">Belum ada shift.</TableEmpty>
          <TableRow v-for="s in shifts" :key="s.id">
            <TableCell class="font-medium">{{ s.username }}</TableCell>
            <TableCell class="text-sm text-muted-foreground">{{ formatDateTime(s.startedAt) }}</TableCell>
            <TableCell class="text-sm text-muted-foreground">
              <Badge v-if="s.isActive" class="bg-status-confirmed text-white">Sedang Berjalan</Badge>
              <span v-else>{{ formatDateTime(s.endedAt) }}</span>
            </TableCell>
            <TableCell class="text-sm text-muted-foreground">{{ formatDuration(s.startedAt, s.endedAt) }}</TableCell>
            <TableCell class="text-sm">{{ s.orderCount }}</TableCell>
            <TableCell class="text-sm font-medium">{{ formatRupiah(s.revenue) }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </div>
</template>
