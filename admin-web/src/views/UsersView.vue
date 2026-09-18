<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { toast } from 'vue-sonner'
import { useUsersStore } from '@/stores/users'
import { useAuthStore } from '@/stores/auth'
import { formatApiError } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
import { PlusIcon, PencilIcon, Trash2Icon, LoaderCircleIcon } from '@lucide/vue'

const store = useUsersStore()
const auth = useAuthStore()

const formOpen = ref(false)
const editingId = ref(null)
const submitting = ref(false)
const deleteTarget = ref(null)
const deleting = ref(false)

const form = reactive({ username: '', password: '', role: 'kasir', isActive: true })

// A solo admin editing their own row can't change role/isActive here — the
// API rejects it outright to avoid a self-lockout, so the fields are
// disabled instead of letting the submit round-trip just to show an error.
const editingSelf = computed(() => editingId.value !== null && editingId.value === auth.user?.id)

onMounted(() => store.fetchAll())

function openCreate() {
  editingId.value = null
  form.username = ''
  form.password = ''
  form.role = 'kasir'
  form.isActive = true
  formOpen.value = true
}

function openEdit(user) {
  editingId.value = user.id
  form.username = user.username
  form.password = ''
  form.role = user.role
  form.isActive = user.isActive
  formOpen.value = true
}

async function onSubmit() {
  submitting.value = true
  try {
    if (editingId.value) {
      const payload = { username: form.username, role: form.role, isActive: form.isActive }
      if (form.password) payload.password = form.password
      await store.update(editingId.value, payload)
      toast.success('Akun diperbarui')
    } else {
      await store.create({ ...form })
      toast.success('Akun ditambahkan')
    }
    formOpen.value = false
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    submitting.value = false
  }
}

// Same AlertDialogAction race as every other confirm dialog in this app —
// it fires @update:open (nulling deleteTarget) before @click gets a turn,
// so the target is captured into a plain variable at open-time instead.
let pendingDelete = null

function openDelete(user) {
  deleteTarget.value = user
  pendingDelete = user
}

async function onDeleteConfirm() {
  const target = pendingDelete
  if (!target) return

  deleting.value = true
  try {
    await store.remove(target.id)
    toast.success('Akun dihapus')
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    deleting.value = false
    pendingDelete = null
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-lg font-semibold tracking-tight">Akun Staff</h1>
        <p class="text-sm text-muted-foreground">Kelola akun admin dan kasir.</p>
      </div>
      <Button class="gap-2" @click="openCreate">
        <PlusIcon class="size-4" />
        Tambah Akun
      </Button>
    </div>

    <div class="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Username</TableHead>
            <TableHead class="w-28">Role</TableHead>
            <TableHead class="w-28">Status</TableHead>
            <TableHead class="w-28 text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableEmpty v-if="!store.loading && store.items.length === 0" :colspan="4">
            Belum ada akun.
          </TableEmpty>
          <TableRow v-for="user in store.items" :key="user.id">
            <TableCell class="font-medium">
              {{ user.username }}
              <span v-if="user.id === auth.user?.id" class="text-xs text-muted-foreground">(kamu)</span>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{{ user.role === 'admin' ? 'Admin' : 'Kasir' }}</Badge>
            </TableCell>
            <TableCell>
              <Badge :variant="user.isActive ? 'default' : 'secondary'">
                {{ user.isActive ? 'Aktif' : 'Nonaktif' }}
              </Badge>
            </TableCell>
            <TableCell class="text-right">
              <Button variant="ghost" size="icon" @click="openEdit(user)">
                <PencilIcon class="size-4" />
              </Button>
              <Button
                v-if="user.id !== auth.user?.id"
                variant="ghost"
                size="icon"
                @click="openDelete(user)"
              >
                <Trash2Icon class="size-4" />
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <Dialog v-model:open="formOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ editingId ? 'Ubah Akun' : 'Tambah Akun' }}</DialogTitle>
        </DialogHeader>
        <form id="user-form" class="space-y-4" @submit.prevent="onSubmit">
          <div class="space-y-2">
            <Label for="username">Username</Label>
            <Input id="username" v-model="form.username" required maxlength="50" />
          </div>
          <div class="space-y-2">
            <Label for="password">Password</Label>
            <Input
              id="password"
              v-model="form.password"
              type="password"
              :required="!editingId"
              :placeholder="editingId ? 'Kosongkan jika tidak diubah' : ''"
              minlength="8"
              maxlength="72"
            />
          </div>
          <div class="space-y-2">
            <Label for="role">Role</Label>
            <Select v-model="form.role" :disabled="editingSelf">
              <SelectTrigger id="role" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="kasir">Kasir</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="flex items-center justify-between rounded-md border px-3 py-2">
            <Label for="isActive">Aktif</Label>
            <Switch id="isActive" v-model="form.isActive" :disabled="editingSelf" />
          </div>
          <p v-if="editingSelf" class="text-xs text-muted-foreground">
            Role dan status akun sendiri tidak bisa diubah dari sini.
          </p>
        </form>
        <DialogFooter>
          <Button type="submit" form="user-form" :disabled="submitting">
            <LoaderCircleIcon v-if="submitting" class="size-4 animate-spin" />
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog :open="!!deleteTarget" @update:open="(v) => !v && (deleteTarget = null)">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hapus akun "{{ deleteTarget?.username }}"?</AlertDialogTitle>
          <AlertDialogDescription>
            Tindakan ini tidak bisa dibatalkan. Akun yang sudah punya riwayat aktivitas tidak bisa dihapus —
            nonaktifkan saja lewat tombol Ubah.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction :disabled="deleting" @click="onDeleteConfirm">Hapus</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
