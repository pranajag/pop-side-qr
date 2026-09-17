<script setup>
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'

const auth = useAuthStore()
const router = useRouter()

async function onLogout() {
  await auth.logout()
  router.replace({ name: 'login' })
}
</script>

<template>
  <div class="flex min-h-svh items-center justify-center px-4">
    <div class="max-w-sm space-y-4 text-center">
      <h1 class="text-lg font-semibold">Dashboard kasir belum tersedia</h1>
      <p class="text-sm text-muted-foreground">
        Halaman untuk akun kasir sedang dikerjakan di sprint berikutnya. Hubungi admin kalau ada pesanan yang perlu
        diproses sementara ini.
      </p>
      <Button variant="outline" @click="onLogout">Keluar</Button>
    </div>
  </div>
</template>
