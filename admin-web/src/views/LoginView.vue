<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
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
const kunciTersalin = ref(false)

// Aplikasi authenticator yang disarankan — keduanya membaca QR/tautan
// otpauth:// standar (TOTP SHA1, 6 digit, 30 detik) dari server.
const APLIKASI = [
  {
    nama: 'Google Authenticator',
    android: 'https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2',
    ios: 'https://apps.apple.com/app/google-authenticator/id388497605',
  },
  {
    nama: 'Microsoft Authenticator',
    android: 'https://play.google.com/store/apps/details?id=com.azure.authenticator',
    ios: 'https://apps.apple.com/app/microsoft-authenticator/id983156458',
  },
]
// Dashboard dibuka di HP: QR di layar HP itu sendiri tidak bisa dipindai
// kameranya, jadi yang ditonjolkan tombol yang membuka aplikasinya langsung.
const platform = (() => {
  const ua = navigator.userAgent || ''
  if (/android/i.test(ua)) return 'android'
  if (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios'
  return 'lainnya'
})()

async function salinKunci() {
  try {
    await navigator.clipboard.writeText(setupData.value.rahasia.replace(/\s/g, ''))
    kunciTersalin.value = true
  } catch {
    kunciTersalin.value = false
  }
}

// Kode dari aplikasi: hanya angka, maks 6 — Microsoft Authenticator
// menampilkannya "123 456", dan kode yang ditempel sering membawa spasi.
// Begitu lengkap 6 digit langsung dikirim, tanpa perlu menekan tombol.
watch(kode, (nilai) => {
  if (pakaiCadangan.value || langkah.value === 'password') return
  const angka = nilai.replace(/\D/g, '').slice(0, 6)
  if (angka !== nilai) {
    kode.value = angka
    return
  }
  if (angka.length === 6 && !submitting.value) kirimKode()
})

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
  kunciTersalin.value = false
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
  <div class="flex min-h-svh items-center justify-center bg-muted/30 px-4 py-8">
    <div class="w-full space-y-6" :class="langkah === 'setup-2fa' ? 'max-w-md' : 'max-w-sm'">
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
              Sekali saja, sekitar 2 menit. Sesudah ini, setiap login admin
              meminta kode 6 digit dari aplikasi di HP Anda.
            </p>
          </div>

          <section class="space-y-2">
            <p class="flex items-center gap-2 text-sm font-medium">
              <span class="flex size-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">1</span>
              Pasang aplikasi di HP (gratis)
            </p>
            <div class="grid grid-cols-2 gap-2">
              <div v-for="app in APLIKASI" :key="app.nama" class="rounded-md border px-3 py-2">
                <p class="text-sm font-medium leading-tight">{{ app.nama }}</p>
                <div class="mt-1 flex flex-wrap gap-x-3 text-xs">
                  <a
                    v-if="platform !== 'ios'"
                    :href="app.android"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-primary underline-offset-4 hover:underline"
                  >Play Store</a>
                  <a
                    v-if="platform !== 'android'"
                    :href="app.ios"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-primary underline-offset-4 hover:underline"
                  >App Store</a>
                </div>
              </div>
            </div>
            <p class="text-xs text-muted-foreground">Sudah punya salah satunya? Langsung ke langkah 2.</p>
          </section>

          <section class="space-y-3">
            <p class="flex items-center gap-2 text-sm font-medium">
              <span class="flex size-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">2</span>
              Tambahkan akun Popside ke aplikasi
            </p>
            <div v-if="!setupData" class="flex h-24 items-center justify-center rounded-md border">
              <LoaderCircleIcon class="size-5 animate-spin text-muted-foreground" />
            </div>
            <template v-else>
              <!-- HP: dashboard dan aplikasi di HP yang sama — QR tidak bisa
                   dipindai, jadi satu ketukan yang membuka aplikasinya. -->
              <div class="space-y-2 md:hidden">
                <Button as="a" :href="setupData.otpauthUrl" class="w-full">
                  <ShieldCheckIcon class="size-4" />
                  Tambahkan ke aplikasi Authenticator
                </Button>
                <p class="text-xs text-muted-foreground">
                  Aplikasi terbuka sendiri dan akun "Popside" langsung tersimpan,
                  lalu kembali ke halaman ini. Tidak terbuka? Pakai kunci manual di bawah.
                </p>
                <details class="rounded-md border px-3 py-2 text-sm">
                  <summary class="cursor-pointer text-muted-foreground">Pindai QR dari HP lain</summary>
                  <img
                    :src="setupData.qrDataUrl"
                    alt="QR kode 2FA untuk aplikasi authenticator"
                    class="mx-auto mt-2 size-48 rounded-md border bg-white p-2"
                  />
                </details>
              </div>
              <!-- Laptop/tablet: pindai QR dengan kamera aplikasi di HP. -->
              <div class="hidden flex-col items-center gap-2 md:flex">
                <img
                  :src="setupData.qrDataUrl"
                  alt="QR kode 2FA untuk aplikasi authenticator"
                  class="size-60 rounded-md border bg-white p-2"
                />
                <ul class="w-full space-y-0.5 text-xs text-muted-foreground">
                  <li><strong class="text-foreground">Google Authenticator:</strong> ketuk <strong>+</strong> → <strong>Pindai kode QR</strong>.</li>
                  <li><strong class="text-foreground">Microsoft Authenticator:</strong> ketuk <strong>+</strong> → <strong>Akun lain</strong> → <strong>Pindai kode QR</strong>.</li>
                </ul>
              </div>
              <div class="space-y-1.5 rounded-md bg-muted/50 p-3">
                <p class="text-xs text-muted-foreground">
                  Kunci manual — di aplikasi pilih <strong>Masukkan kunci penyiapan</strong>
                  (Microsoft: <strong>masukkan kode secara manual</strong>), jenis <strong>berbasis waktu</strong>.
                  Nama akun bebas, misalnya "Popside".
                </p>
                <div class="flex items-center gap-2">
                  <span class="flex-1 font-mono text-sm break-words select-all">{{ setupData.rahasia }}</span>
                  <Button type="button" variant="outline" size="sm" @click="salinKunci">
                    <CheckIcon v-if="kunciTersalin" class="size-4" />
                    <CopyIcon v-else class="size-4" />
                    {{ kunciTersalin ? 'Tersalin' : 'Salin' }}
                  </Button>
                </div>
              </div>
            </template>
          </section>

          <p class="flex items-center gap-2 text-sm font-medium">
            <span class="flex size-5 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">3</span>
            Masukkan kode 6 digit yang muncul di aplikasi
          </p>
        </template>
        <div v-else class="space-y-1">
          <h2 class="text-sm font-semibold">Verifikasi 2 langkah</h2>
          <p class="text-sm text-muted-foreground">
            {{
              pakaiCadangan
                ? 'Masukkan salah satu kode cadangan (XXXX-XXXX).'
                : 'Buka Google Authenticator atau Microsoft Authenticator di HP, lalu masukkan 6 digit dari akun Popside.'
            }}
          </p>
        </div>

        <div class="space-y-2">
          <Label for="kode2fa">{{ pakaiCadangan ? 'Kode cadangan' : 'Kode 6 digit' }}</Label>
          <Input
            id="kode2fa"
            v-model="kode"
            :inputmode="pakaiCadangan ? 'text' : 'numeric'"
            :pattern="pakaiCadangan ? undefined : '[0-9 ]*'"
            autocomplete="one-time-code"
            :maxlength="pakaiCadangan ? 9 : 12"
            :placeholder="pakaiCadangan ? 'XXXX-XXXX' : '000000'"
            class="h-12 text-center font-mono text-xl tracking-widest"
            required
            autofocus
          />
          <p v-if="!pakaiCadangan" class="text-xs text-muted-foreground">
            Kode berganti tiap 30 detik — langsung terkirim begitu 6 digit terisi.
          </p>
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
