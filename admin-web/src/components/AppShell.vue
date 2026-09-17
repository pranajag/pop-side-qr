<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import {
  ClipboardListIcon,
  LayoutGridIcon,
  UtensilsIcon,
  QrCodeIcon,
  BarChart3Icon,
  SettingsIcon,
  LogOutIcon,
} from '@lucide/vue'
import { toast } from 'vue-sonner'

const auth = useAuthStore()
const router = useRouter()

const nav = computed(() => {
  const items = [{ to: { name: 'pesanan' }, label: 'Pesanan', icon: ClipboardListIcon }]
  if (auth.isAdmin) {
    items.push(
      { to: { name: 'kategori' }, label: 'Kategori', icon: LayoutGridIcon },
      { to: { name: 'produk' }, label: 'Produk', icon: UtensilsIcon },
      { to: { name: 'meja' }, label: 'Meja', icon: QrCodeIcon },
      { to: { name: 'laporan' }, label: 'Laporan', icon: BarChart3Icon },
      { to: { name: 'pengaturan' }, label: 'Pengaturan', icon: SettingsIcon }
    )
  }
  return items
})

async function onLogout() {
  await auth.logout()
  router.replace({ name: 'login' })
  toast('Berhasil keluar')
}
</script>

<template>
  <div class="flex min-h-svh">
    <aside class="flex w-56 shrink-0 flex-col border-r bg-card">
      <div class="px-4 py-4">
        <p class="text-sm font-semibold tracking-tight">Popside Admin</p>
      </div>
      <nav class="flex-1 space-y-1 px-2">
        <router-link
          v-for="item in nav"
          :key="item.label"
          :to="item.to"
          class="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          active-class="bg-accent text-accent-foreground font-medium"
        >
          <component :is="item.icon" class="size-4" />
          {{ item.label }}
        </router-link>
      </nav>
      <div class="border-t px-3 py-3">
        <p class="truncate px-1 text-xs text-muted-foreground">
          Masuk sebagai <span class="font-medium text-foreground">{{ auth.user?.username }}</span>
          <span class="text-muted-foreground/70">({{ auth.user?.role }})</span>
        </p>
        <Button variant="ghost" size="sm" class="mt-1 w-full justify-start gap-2" @click="onLogout">
          <LogOutIcon class="size-4" />
          Keluar
        </Button>
      </div>
    </aside>

    <main class="min-w-0 flex-1 overflow-y-auto p-6">
      <router-view />
    </main>
  </div>
</template>
