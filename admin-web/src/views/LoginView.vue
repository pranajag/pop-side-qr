<script setup>
import { computed, onUnmounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  CircleAlertIcon,
  LoaderCircleIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  ShieldCheckIcon,
  CopyIcon,
  CheckIcon,
  ArrowLeftIcon,
} from '@lucide/vue'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const username = ref('')
const password = ref('')
const showPassword = ref(false)
const error = ref('')
const submitting = ref(false)
// Server (loginLimiter, 5/1 menit per kombinasi IP+username) is the real
// gate — this is read from its own RateLimit-Remaining response header, not
// counted client-side, so it stays accurate across reloads/other tabs
// instead of a local counter that would just reset on refresh.
const remainingAttempts = ref(null)

// Set once a 429 actually happens; counts down live so the form re-enables
// itself the moment the server's own window would allow a retry, instead of
// the user just being shown "try again later" with no way to know when.
const lockoutSeconds = ref(0)
const isLockedOut = computed(() => lockoutSeconds.value > 0)
let lockoutTimer = null

function startLockoutCountdown(seconds) {
  clearInterval(lockoutTimer)
  lockoutSeconds.value = Math.max(1, Math.round(seconds))
  lockoutTimer = setInterval(() => {
    lockoutSeconds.value -= 1
    if (lockoutSeconds.value <= 0) clearInterval(lockoutTimer)
  }, 1000)
}
onUnmounted(() => clearInterval(lockoutTimer))

const lockoutClock = computed(() => {
  const m = Math.floor(lockoutSeconds.value / 60)
  const s = lockoutSeconds.value % 60
  return `${m}:${String(s).padStart(2, '0')}`
})

// vue-router + HTML5 History mode already can't navigate cross-origin (the
// underlying pushState/replaceState throws on a different origin), so this
// couldn't send anyone to an external phishing page as-is — but validating
// explicitly here means the redirect target is provably safe by this code's
// own logic, not by an incidental platform restriction a future change
// elsewhere (e.g. switching to a raw window.location assignment) could
// silently remove. Only a same-app path ("/xyz", never "//xyz" — that's
// protocol-relative and resolves to an external origin) is honored.
function safeRedirectTarget() {
  const target = route.query.redirect
  if (
    typeof target === 'string' &&
    target.startsWith('/') &&
    !target.startsWith('//')
  ) {
    return target
  }
  // Same role-based landing page as router/index.js's beforeEach — kept in
  // sync manually since this fallback (no explicit ?redirect=) is reached
  // via router.replace() below, not the guard's own root-path check.
  return { name: auth.user?.role === 'admin' ? 'dashboard' : 'pesanan' }
}

// Langkah login: 'password' -> (akun wajib 2FA) 'kode-2fa' atau
// 'setup-2fa' -> 'kode-cadangan' (sekali, setelah 2FA baru dipasang).
// Keadaan "password benar, menunggu 2FA" disimpan server, bukan di sini —
// memuat ulang halaman berarti mulai lagi dari password.
const langkah = ref('password')
const kode = ref('')
const pakaiCadangan = ref(false)
const setupData = ref(null)
const kodeCadangan = ref([])
const tersalin = ref(false)
const sudahDisimpan = ref(false)

function kembaliKePassword(pesan = '') {
  langkah.value = 'password'
  kode.value = ''
  pakaiCadangan.value = false
  setupData.value = null
  error.value = pesan
}

function tanganiError2fa(err) {
  kode.value = ''
  // 401 = jeda 5 menit sejak password benar sudah lewat: ulangi dari awal.
  if (err.status === 401) return kembaliKePassword(err.message)
  error.value = err.message
}

async function muatSetup() {
  setupData.value = null
  try {
    setupData.value = await auth.mulaiSetup2fa()
  } catch (err) {
    tanganiError2fa(err)
  }
}

async function kirimKode() {
  error.value = ''
  submitting.value = true
  try {
    if (langkah.value === 'setup-2fa') {
      kodeCadangan.value = await auth.aktifkan2fa(kode.value.trim())
      langkah.value = 'kode-cadangan'
    } else {
      await auth.verifikasi2fa(kode.value.trim())
      router.replace(safeRedirectTarget())
    }
  } catch (err) {
    tanganiError2fa(err)
  } finally {
    submitting.value = false
  }
}

async function salinKodeCadangan() {
  try {
    await navigator.clipboard.writeText(kodeCadangan.value.join('\n'))
    tersalin.value = true
  } catch {
    tersalin.value = false
  }
}

async function onSubmit() {
  if (isLockedOut.value) return
  error.value = ''
  submitting.value = true
  try {
    const berikut = await auth.login(username.value, password.value)
    if (berikut) {
      password.value = ''
      kode.value = ''
      langkah.value = berikut
      if (berikut === 'setup-2fa') await muatSetup()
      return
    }
    router.replace(safeRedirectTarget())
  } catch (err) {
    if (err.status === 429) {
      // rateLimitResetSeconds comes straight from the server's own window —
      // 60 is just a fallback for the unlikely case the header didn't
      // arrive, not the real source of truth.
      startLockoutCountdown(err.rateLimitResetSeconds ?? 60)
      error.value = ''
    } else if (err.status === 401) {
      error.value = 'Username atau password salah'
      remainingAttempts.value = Number.isFinite(err.rateLimitRemaining)
        ? err.rateLimitRemaining
        : null
    } else {
      error.value = err.message
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="flex min-h-svh items-center justify-center bg-muted/30 px-4">
    <div class="w-full max-w-sm space-y-6">
      <div class="space-y-1 text-center">
        <h1 class="text-xl font-semibold tracking-tight">Popside Admin</h1>
        <p class="text-sm text-muted-foreground">
          Masuk untuk kelola menu, meja, dan pesanan
        </p>
      </div>

      <!-- Kode cadangan: ditampilkan SEKALI setelah 2FA baru dipasang. -->
      <div
        v-if="langkah === 'kode-cadangan'"
        class="space-y-4 rounded-lg border bg-card p-6"
      >
        <div class="flex items-start gap-3">
          <ShieldCheckIcon class="mt-0.5 size-5 shrink-0 text-primary" />
          <div class="space-y-1">
            <h2 class="text-sm font-semibold">2FA aktif. Simpan kode cadangan ini</h2>
            <p class="text-sm text-muted-foreground">
              Kalau HP authenticator hilang, satu kode ini bisa dipakai sekali
              untuk masuk. Kode ini tidak akan ditampilkan lagi.
            </p>
          </div>
        </div>
        <ul class="grid grid-cols-2 gap-2 rounded-md bg-muted/50 p-3 font-mono text-sm tabular-nums">
          <li v-for="k in kodeCadangan" :key="k" class="text-center">{{ k }}</li>
        </ul>
        <Button type="button" variant="outline" class="w-full" @click="salinKodeCadangan">
          <CheckIcon v-if="tersalin" class="size-4" />
          <CopyIcon v-else class="size-4" />
          {{ tersalin ? 'Tersalin' : 'Salin semua kode' }}
        </Button>
        <label class="flex items-start gap-2 text-sm">
          <input v-model="sudahDisimpan" type="checkbox" class="mt-0.5 size-4 accent-primary" />
          <span>Saya sudah menyimpan kode ini di tempat aman (bukan di HP yang sama).</span>
        </label>
        <Button type="button" class="w-full" :disabled="!sudahDisimpan" @click="router.replace(safeRedirectTarget())">
          Lanjut ke dashboard
        </Button>
      </div>

      <!-- Langkah 2FA: kode dari aplikasi, atau pasang 2FA dulu. -->
      <form
        v-else-if="langkah === 'kode-2fa' || langkah === 'setup-2fa'"
        class="space-y-4 rounded-lg border bg-card p-6"
        @submit.prevent="kirimKode"
      >
        <Alert v-if="error" variant="destructive">
          <CircleAlertIcon class="size-4" />
          <AlertTitle>Belum bisa masuk</AlertTitle>
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <template v-if="langkah === 'setup-2fa'">
          <div class="space-y-1">
            <h2 class="text-sm font-semibold">Pasang verifikasi 2 langkah (wajib untuk admin)</h2>
            <p class="text-sm text-muted-foreground">
              Buka Google Authenticator, Authy, atau Microsoft Authenticator di
              HP, pilih tambah akun, lalu pindai QR ini.
            </p>
          </div>
          <div class="flex justify-center">
            <img
              v-if="setupData"
              :src="setupData.qrDataUrl"
              alt="QR kode 2FA untuk aplikasi authenticator"
              class="size-48 rounded-md border bg-white p-2"
            />
            <div v-else class="flex size-48 items-center justify-center rounded-md border">
              <LoaderCircleIcon class="size-5 animate-spin text-muted-foreground" />
            </div>
          </div>
          <p v-if="setupData" class="text-center text-xs text-muted-foreground">
            Tidak bisa memindai? Ketik kunci ini di aplikasi:
            <span class="block pt-1 font-mono text-sm text-foreground select-all">{{ setupData.rahasia }}</span>
          </p>
        </template>
        <div v-else class="space-y-1">
          <h2 class="text-sm font-semibold">Verifikasi 2 langkah</h2>
          <p class="text-sm text-muted-foreground">
            {{ pakaiCadangan ? 'Masukkan salah satu kode cadangan (XXXX-XXXX).' : 'Masukkan kode 6 digit dari aplikasi authenticator.' }}
          </p>
        </div>

        <div class="space-y-2">
          <Label for="kode2fa">{{ pakaiCadangan ? 'Kode cadangan' : 'Kode 6 digit' }}</Label>
          <Input
            id="kode2fa"
            v-model="kode"
            :inputmode="pakaiCadangan ? 'text' : 'numeric'"
            autocomplete="one-time-code"
            :maxlength="pakaiCadangan ? 9 : 6"
            :placeholder="pakaiCadangan ? 'XXXX-XXXX' : '000000'"
            class="text-center font-mono text-lg tracking-widest"
            required
            autofocus
          />
        </div>

        <Button type="submit" class="w-full" :disabled="submitting || !kode.trim()">
          <LoaderCircleIcon v-if="submitting" class="size-4 animate-spin" />
          {{ langkah === 'setup-2fa' ? 'Aktifkan & masuk' : 'Masuk' }}
        </Button>
        <div class="flex items-center justify-between text-sm">
          <button type="button" class="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground" @click="kembaliKePassword()">
            <ArrowLeftIcon class="size-3.5" /> Kembali
          </button>
          <button
            v-if="langkah === 'kode-2fa'"
            type="button"
            class="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            @click="pakaiCadangan = !pakaiCadangan; kode = ''"
          >
            {{ pakaiCadangan ? 'Pakai kode aplikasi' : 'Pakai kode cadangan' }}
          </button>
        </div>
      </form>

      <form
        v-else
        class="space-y-4 rounded-lg border bg-card p-6"
        @submit.prevent="onSubmit"
      >
        <Alert v-if="isLockedOut" variant="destructive">
          <LockIcon class="size-4" />
          <AlertTitle>Sementara dikunci</AlertTitle>
          <AlertDescription>
            Terlalu banyak percobaan gagal. Coba lagi dalam
            <strong class="tabular-nums">{{ lockoutClock }}</strong
            >.
          </AlertDescription>
        </Alert>
        <Alert v-else-if="error" variant="destructive">
          <CircleAlertIcon class="size-4" />
          <AlertTitle>Gagal masuk</AlertTitle>
          <AlertDescription>
            {{ error }}
            <span v-if="remainingAttempts !== null && remainingAttempts <= 2">
              — sisa {{ remainingAttempts }}x percobaan sebelum dikunci
              sementara.
            </span>
          </AlertDescription>
        </Alert>

        <div class="space-y-2">
          <Label for="username">Username</Label>
          <Input
            id="username"
            v-model="username"
            autocomplete="username"
            required
            autofocus
            :disabled="isLockedOut"
          />
        </div>

        <div class="space-y-2">
          <Label for="password">Password</Label>
          <div class="relative">
            <Input
              id="password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              required
              :disabled="isLockedOut"
              class="pr-10"
            />
            <button
              type="button"
              class="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              :aria-label="showPassword ? 'Sembunyikan sandi' : 'Lihat sandi'"
              :disabled="isLockedOut"
              @click="showPassword = !showPassword"
            >
              <EyeOffIcon v-if="showPassword" class="size-4" />
              <EyeIcon v-else class="size-4" />
            </button>
          </div>
        </div>

        <Button
          type="submit"
          class="w-full"
          :disabled="submitting || isLockedOut"
        >
          <LoaderCircleIcon v-if="submitting" class="size-4 animate-spin" />
          {{ isLockedOut ? `Coba lagi dalam ${lockoutClock}` : 'Masuk' }}
        </Button>
      </form>
    </div>
  </div>
</template>
