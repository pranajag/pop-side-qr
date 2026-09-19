<script setup>
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { CircleAlertIcon, LoaderCircleIcon } from '@lucide/vue'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const username = ref('')
const password = ref('')
const error = ref('')
const submitting = ref(false)

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
  if (typeof target === 'string' && target.startsWith('/') && !target.startsWith('//')) {
    return target
  }
  return { name: 'pesanan' }
}

async function onSubmit() {
  error.value = ''
  submitting.value = true
  try {
    await auth.login(username.value, password.value)
    router.replace(safeRedirectTarget())
  } catch (err) {
    error.value = err.status === 401 ? 'Username atau password salah' : err.message
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
        <p class="text-sm text-muted-foreground">Masuk untuk kelola menu, meja, dan pesanan</p>
      </div>

      <form class="space-y-4 rounded-lg border bg-card p-6" @submit.prevent="onSubmit">
        <Alert v-if="error" variant="destructive">
          <CircleAlertIcon class="size-4" />
          <AlertTitle>Gagal masuk</AlertTitle>
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <div class="space-y-2">
          <Label for="username">Username</Label>
          <Input id="username" v-model="username" autocomplete="username" required autofocus />
        </div>

        <div class="space-y-2">
          <Label for="password">Password</Label>
          <Input id="password" v-model="password" type="password" autocomplete="current-password" required />
        </div>

        <Button type="submit" class="w-full" :disabled="submitting">
          <LoaderCircleIcon v-if="submitting" class="size-4 animate-spin" />
          Masuk
        </Button>
      </form>
    </div>
  </div>
</template>
