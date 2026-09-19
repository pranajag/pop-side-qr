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
} from '@lucide/vue'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const username = ref('')
const password = ref('')
const showPassword = ref(false)
const error = ref('')
const submitting = ref(false)
// Server (loginLimiter, 5/15 menit per kombinasi IP+username) is the real
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
  return { name: 'pesanan' }
}

async function onSubmit() {
  if (isLockedOut.value) return
  error.value = ''
  submitting.value = true
  try {
    await auth.login(username.value, password.value)
    router.replace(safeRedirectTarget())
  } catch (err) {
    if (err.status === 429) {
      // rateLimitResetSeconds comes straight from the server's own window —
      // 900 (15 menit) is just a fallback for the unlikely case the header
      // didn't arrive, not the real source of truth.
      startLockoutCountdown(err.rateLimitResetSeconds ?? 900)
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

      <form
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
