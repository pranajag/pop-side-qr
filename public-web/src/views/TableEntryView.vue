<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTableStore } from '@/stores/table'
import { LoaderCircleIcon, TriangleAlertIcon } from '@lucide/vue'

const route = useRoute()
const router = useRouter()
const table = useTableStore()

const failed = ref(false)

onMounted(async () => {
  const ok = await table.verify(route.params.token)
  if (ok) {
    router.replace({ name: 'menu' })
  } else {
    failed.value = true
  }
})
</script>

<template>
  <div class="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center">
    <template v-if="failed">
      <TriangleAlertIcon class="size-10 text-destructive" />
      <div class="space-y-1">
        <h1 class="text-lg font-semibold">QR tidak valid</h1>
        <p class="text-sm text-muted-foreground">
          Kode QR ini tidak dikenali atau meja sedang tidak aktif. Coba scan ulang QR di meja kamu, atau panggil
          staff untuk bantuan.
        </p>
      </div>
    </template>
    <template v-else>
      <LoaderCircleIcon class="size-8 animate-spin text-muted-foreground" />
      <p class="text-sm text-muted-foreground">Memeriksa meja kamu...</p>
    </template>
  </div>
</template>
