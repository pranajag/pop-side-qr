<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { useTablesStore } from '@/stores/tables'
import { useSettingsStore } from '@/stores/settings'
import { api, formatApiError } from '@/lib/api'
import { formatRupiah, formatDateTime } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
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
  TrendingUpIcon,
  TrendingDownIcon,
  TimerIcon,
  TrophyIcon,
  WalletIcon,
  ClipboardListIcon,
  DoorOpenIcon,
  EraserIcon,
  StarIcon,
} from '@lucide/vue'

const router = useRouter()
const tables = useTablesStore()
const loading = ref(true)
const overview = ref(null)

// null (not 0/Infinity) when yesterday had zero orders/revenue — "up
// infinity percent from zero" is meaningless, so the comparison line is
// hidden entirely for that case rather than showing a made-up number.
function pctChange(today, yesterday) {
  if (!yesterday) return null
  return ((today - yesterday) / yesterday) * 100
}

const revenueChange = computed(() =>
  overview.value ? pctChange(overview.value.today.total, overview.value.yesterday.total) : null
)
const orderCountChange = computed(() =>
  overview.value
    ? pctChange(overview.value.today.orderCount, overview.value.yesterday.orderCount)
    : null
)

async function load() {
  loading.value = true
  try {
    const data = await api.get('/admin/dashboard')
    overview.value = data.overview
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    loading.value = false
  }
}

function goToPendingVerif() {
  router.push({ name: 'pesanan', query: { status: 'waiting_verif' } })
}

const activeTables = computed(() => tables.items.filter((t) => t.isActive))
const settings = useSettingsStore()
const memberBusy = ref(false)
async function onToggleMember(value) {
  memberBusy.value = true
  try {
    await settings.setMemberEnabled(value)
    toast.success(value ? 'Fitur member diaktifkan' : 'Fitur member dimatikan')
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    memberBusy.value = false
  }
}

const billOpenBusyId = ref(null)
async function onToggleBillOpen(table, value) {
  billOpenBusyId.value = table.id
  try {
    await tables.setBillOpen(table.id, value)
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    billOpenBusyId.value = null
  }
}

// Confirmed first: the old bill is unrecoverable from the customer's side
// once the visit moves on, and a mis-tap on the wrong table would wipe the
// running bill of a group still sitting there.
const clearTarget = ref(null)
const clearing = ref(false)
// AlertDialogAction closes the dialog on click, which nulls clearTarget via
// @update:open *before* the @click handler below runs — same ordering trap
// CategoriesView.vue documents. The plain variable survives it.
let pendingClear = null

function openClear(table) {
  clearTarget.value = table
  pendingClear = table
}

async function onClearVisitConfirm() {
  const target = pendingClear
  if (!target) return

  clearing.value = true
  try {
    await tables.clearVisit(target.id)
    toast.success(`Bill Meja ${target.nomorMeja} dikosongkan`)
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    clearing.value = false
    pendingClear = null
  }
}

onMounted(() => {
  load()
  tables.fetchAll()
  settings.fetchSettings()
})
</script>

<template>
  <div class="mx-auto max-w-4xl space-y-8">
    <div>
      <h1 class="text-lg font-semibold tracking-tight">Dashboard</h1>
      <p class="text-sm text-muted-foreground">Ringkasan hari ini.</p>
    </div>

    <div v-if="loading" class="flex justify-center py-16">
      <LoaderCircleIcon class="size-6 animate-spin text-muted-foreground" />
    </div>

    <template v-else-if="overview">
      <button
        v-if="overview.pendingVerifCount > 0"
        type="button"
        class="flex w-full items-center justify-between gap-3 rounded-lg border-l-4 border-l-amber-500 bg-muted/40 px-4 py-3 text-left transition-colors hover:bg-muted/60"
        @click="goToPendingVerif"
      >
        <p class="text-sm">
          <span class="font-semibold">{{ overview.pendingVerifCount }}</span>
          pembayaran QRIS menunggu diverifikasi
        </p>
        <span class="shrink-0 text-xs font-medium text-primary-strong">Cek sekarang →</span>
      </button>

      <!-- The three numbers an admin actually opens this page to see, side
      by side at equal weight — omzet, berapa order, berapa yang dibatalkan
      setelah dibayar. No card chrome beyond a divider, so the eye lands on
      the numbers themselves instead of three competing boxes. -->
      <div class="grid grid-cols-3 divide-x rounded-lg border">
        <div class="space-y-1 px-4 py-4 sm:px-6">
          <p class="text-xs text-muted-foreground">Omzet Hari Ini</p>
          <p class="text-xl font-semibold tracking-tight sm:text-2xl">
            {{ formatRupiah(overview.today.total) }}
          </p>
          <p
            v-if="revenueChange !== null"
            class="flex items-center gap-1 text-xs"
            :class="revenueChange >= 0 ? 'text-status-completed' : 'text-destructive'"
          >
            <TrendingUpIcon v-if="revenueChange >= 0" class="size-3.5 shrink-0" />
            <TrendingDownIcon v-else class="size-3.5 shrink-0" />
            <span>{{ Math.abs(revenueChange).toFixed(0) }}% dari kemarin</span>
          </p>
          <p v-else class="text-xs text-muted-foreground">Kemarin tidak ada omzet</p>
        </div>

        <div class="space-y-1 px-4 py-4 sm:px-6">
          <p class="text-xs text-muted-foreground">Order Hari Ini</p>
          <p class="text-xl font-semibold tracking-tight sm:text-2xl">{{ overview.today.orderCount }}</p>
          <p
            v-if="orderCountChange !== null"
            class="flex items-center gap-1 text-xs"
            :class="orderCountChange >= 0 ? 'text-status-completed' : 'text-destructive'"
          >
            <TrendingUpIcon v-if="orderCountChange >= 0" class="size-3.5 shrink-0" />
            <TrendingDownIcon v-else class="size-3.5 shrink-0" />
            <span>{{ Math.abs(orderCountChange).toFixed(0) }}% dari kemarin</span>
          </p>
          <p v-else class="text-xs text-muted-foreground">Kemarin tidak ada order</p>
        </div>

        <div class="space-y-1 px-4 py-4 sm:px-6">
          <p class="text-xs text-muted-foreground">Void Hari Ini</p>
          <p
            class="text-xl font-semibold tracking-tight sm:text-2xl"
            :class="overview.today.voidCount > 0 ? 'text-destructive' : ''"
          >
            {{ overview.today.voidCount }}
          </p>
          <p class="text-xs text-muted-foreground">
            {{ overview.today.voidCount > 0 ? formatRupiah(overview.today.voidAmount) : 'Tidak ada void' }}
          </p>
        </div>
      </div>

      <div class="grid gap-6 lg:grid-cols-2">
        <div class="space-y-3">
          <h2 class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <WalletIcon class="size-4" />
            Metode Pembayaran
          </h2>
          <div v-if="overview.today.orderCount === 0" class="text-sm text-muted-foreground">
            Belum ada order hari ini.
          </div>
          <div v-else class="space-y-2.5">
            <div
              v-for="(amount, metode) in overview.today.byMetode"
              :key="metode"
              class="flex items-center justify-between text-sm"
            >
              <span class="capitalize text-muted-foreground">{{ metode }}</span>
              <span class="font-medium">{{ formatRupiah(amount) }}</span>
            </div>
          </div>
        </div>

        <div class="space-y-3">
          <h2 class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <TrophyIcon class="size-4" />
            Produk Terlaris
          </h2>
          <div v-if="overview.today.topProducts.length === 0" class="text-sm text-muted-foreground">
            Belum ada produk terjual hari ini.
          </div>
          <ol v-else class="space-y-2.5">
            <li
              v-for="(p, idx) in overview.today.topProducts"
              :key="p.nama"
              class="flex items-center justify-between text-sm"
            >
              <span class="flex items-center gap-2 text-muted-foreground">
                <span class="text-xs">{{ idx + 1 }}.</span>
                <span class="text-foreground">{{ p.nama }}</span>
              </span>
              <span class="text-muted-foreground">{{ p.qty }}x</span>
            </li>
          </ol>
        </div>
      </div>

      <div class="space-y-3">
        <h2 class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <TimerIcon class="size-4" />
          Shift Aktif
        </h2>
        <div v-if="overview.activeShifts.length === 0" class="text-sm text-muted-foreground">
          Tidak ada shift yang sedang berjalan.
        </div>
        <div v-else class="divide-y rounded-lg border">
          <div
            v-for="shift in overview.activeShifts"
            :key="shift.id"
            class="flex items-center justify-between px-4 py-2.5 text-sm"
          >
            <div>
              <p class="font-medium">{{ shift.username }}</p>
              <p class="text-xs text-muted-foreground">Mulai {{ formatDateTime(shift.startedAt) }}</p>
            </div>
            <div class="text-right">
              <p class="text-xs text-muted-foreground">Kas seharusnya</p>
              <p class="font-medium">{{ formatRupiah(shift.expectedCash) }}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="space-y-3">
        <div>
          <h2 class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <StarIcon class="size-4" />
            Fitur Member
          </h2>
          <p class="mt-0.5 text-xs text-muted-foreground">
            Kalau dimatikan, kolom nomor HP hilang dari checkout customer —
            tidak ada poin yang dikumpulkan dan tidak ada diskon member yang
            berlaku. Data member yang sudah ada tetap tersimpan.
          </p>
        </div>
        <label
          class="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
        >
          <span>
            {{ settings.memberEnabled ? 'Aktif' : 'Nonaktif' }}
            <span class="block text-xs text-muted-foreground">
              {{
                settings.memberEnabled
                  ? 'Customer bisa isi nomor HP untuk kumpulkan poin & dapat diskon.'
                  : 'Program poin & diskon member sedang berhenti.'
              }}
            </span>
          </span>
          <Switch
            :model-value="settings.memberEnabled"
            :disabled="memberBusy"
            @update:model-value="onToggleMember"
          />
        </label>
      </div>

      <div class="space-y-3">
        <div>
          <h2 class="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <DoorOpenIcon class="size-4" />
            Open Bill
          </h2>
          <p class="mt-0.5 text-xs text-muted-foreground">
            Tandai meja yang belum minta bayar — murni penanda buat staff, tidak mengubah cara order/bayar.
          </p>
        </div>
        <div v-if="activeTables.length === 0" class="text-sm text-muted-foreground">
          Belum ada meja aktif.
        </div>
        <div v-else class="grid gap-2 sm:grid-cols-2">
          <div
            v-for="t in activeTables"
            :key="t.id"
            class="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
          >
            <label :for="`bill-open-${t.id}`" class="flex-1 cursor-pointer">
              Meja {{ t.nomorMeja }}
            </label>
            <Button
              variant="ghost"
              size="sm"
              class="gap-1.5 text-muted-foreground"
              @click="openClear(t)"
            >
              <EraserIcon class="size-3.5" />
              Kosongkan
            </Button>
            <Switch
              :id="`bill-open-${t.id}`"
              :model-value="t.isBillOpen"
              :disabled="billOpenBusyId === t.id"
              @update:model-value="(v) => onToggleBillOpen(t, v)"
            />
          </div>
        </div>
      </div>

      <router-link
        :to="{ name: 'laporan' }"
        class="flex items-center gap-1.5 text-sm text-primary-strong hover:underline"
      >
        <ClipboardListIcon class="size-3.5" />
        Lihat laporan lengkap &amp; rentang tanggal lain
      </router-link>
    </template>

    <AlertDialog
      :open="!!clearTarget"
      @update:open="(v) => !v && (clearTarget = null)"
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle
            >Kosongkan bill Meja {{ clearTarget?.nomorMeja }}?</AlertDialogTitle
          >
          <AlertDialogDescription>
            Meja dianggap selesai dipakai: bill yang dilihat customer di meja
            ini kembali kosong, dan penanda "belum minta bayar" ikut dimatikan.
            Pesanan lamanya tetap tersimpan di Riwayat Aktivitas dan laporan —
            yang direset hanya tampilan bill mejanya.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction :disabled="clearing" @click="onClearVisitConfirm">
            Kosongkan
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
