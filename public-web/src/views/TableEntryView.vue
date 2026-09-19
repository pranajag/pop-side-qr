<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTableStore } from '@/stores/table'
import { useLocaleStore } from '@/stores/locale'
import { LoaderCircleIcon, TriangleAlertIcon } from '@lucide/vue'
import logoUrl from '@/assets/pop-side-logo.jpg'

const route = useRoute()
const router = useRouter()
const table = useTableStore()
const locale = useLocaleStore()

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
  <div class="flex min-h-svh flex-col items-center justify-center gap-6 px-6 text-center">
    <img :src="logoUrl" alt="Popside" class="size-16 rounded-2xl shadow-lg shadow-black/10" />
    <template v-if="failed">
      <TriangleAlertIcon class="size-10 text-destructive" />
      <div class="space-y-1">
        <h1 class="text-lg font-semibold">{{ locale.t('qrTidakValid') }}</h1>
        <p class="text-sm text-muted-foreground">
          {{ locale.t('qrTidakValidDesc') }}
        </p>
      </div>
    </template>
    <template v-else>
      <LoaderCircleIcon class="size-8 animate-spin text-muted-foreground" />
      <p class="text-sm text-muted-foreground">{{ locale.t('memeriksaMeja') }}</p>
    </template>
  </div>
</template>
