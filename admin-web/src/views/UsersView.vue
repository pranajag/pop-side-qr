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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { PlusIcon, PencilIcon, Trash2Icon, LoaderCircleIcon, ShieldOffIcon } from '@lucide/vue'

const store = useUsersStore()
const auth = useAuthStore()

const formOpen = ref(false)
const editingId = ref(null)
const submitting = ref(false)
const deleteTarget = ref(null)
const deleting = ref(false)
const editingHasPin = ref(false)

const form = reactive({
  username: '',
  password: '',
  pin: '',
  role: 'kasir',
  isActive: true,
})

// A solo admin editing their own row can't change role/isActive here — the
// API rejects it outright to avoid a self-lockout, so the fields are
// disabled instead of letting the submit round-trip just to show an error.
const editingSelf = computed(
  () => editingId.value !== null && editingId.value === auth.user?.id
)

onMounted(() => store.fetchAll())

function openCreate() {
  editingId.value = null
  form.username = ''
  form.password = ''
  form.pin = ''
  form.role = 'kasir'
  form.isActive = true
  editingHasPin.value = false
  formOpen.value = true
}

function openEdit(user) {
  editingId.value = user.id
  form.username = user.username
  form.password = ''
  form.pin = ''
  form.role = user.role
  form.isActive = user.isActive
  editingHasPin.value = user.hasPin
  formOpen.value = true
}

async function onSubmit() {
  submitting.value = true
  try {
    if (editingId.value) {
      const payload = {
        username: form.username,
        role: form.role,
        isActive: form.isActive,
      }
      if (form.password) payload.password = form.password
      if (form.pin) payload.pin = form.pin
      await store.update(editingId.value, payload)
      toast.success('Akun diperbarui')
    } else {
      const payload = {
        username: form.username,
        password: form.password,
        role: form.role,
        isActive: form.isActive,
      }
      if (form.pin) payload.pin = form.pin
      await store.create(payload)
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

// Cabut 2FA — dialog sendiri (bukan AlertDialog) karena butuh isian PIN.
const resetTarget = ref(null)
const resetPin = ref('')
const resetting = ref(false)

function openReset2fa(user) {
  resetTarget.value = user
  resetPin.value = ''
}

async function onReset2faConfirm() {
  const target = resetTarget.value
  if (!target) return
  resetting.value = true
  try {
    await store.reset2fa(target.id, resetPin.value)
    toast.success(`2FA ${target.username} dicabut — wajib dipasang lagi saat login berikutnya.`)
    resetTarget.value = null
  } catch (err) {
    toast.error(formatApiError(err))
  } finally {
    resetting.value = false
    resetPin.value = ''
  }
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
        <p class="text-sm text-muted-foreground">
          Kelola akun admin dan kasir.
        </p>
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
            <TableHead class="w-24">PIN</TableHead>
            <TableHead class="w-28">2FA</TableHead>
            <TableHead class="w-28 text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableEmpty
            v-if="!store.loading && store.items.length === 0"
            :colspan="6"
          >
            Belum ada akun.
          </TableEmpty>
          <TableRow v-for="user in store.items" :key="user.id">
            <TableCell class="font-medium" data-label="Username">
              {{ user.username }}
              <span
                v-if="user.id === auth.user?.id"
                class="text-xs text-muted-foreground"
                >(kamu)</span
              >
            </TableCell>
            <TableCell data-label="Role">
              <Badge variant="outline">{{
                user.role === 'admin' ? 'Admin' : 'Kasir'
              }}</Badge>
            </TableCell>
            <TableCell data-label="Status">
              <Badge :variant="user.isActive ? 'default' : 'secondary'">
                {{ user.isActive ? 'Aktif' : 'Nonaktif' }}
              </Badge>
            </TableCell>
            <TableCell data-label="PIN">
              <span v-if="user.hasPin" class="text-xs text-status-completed">Sudah diset</span>
              <span v-else class="text-xs text-muted-foreground">Belum diset</span>
            </TableCell>
            <TableCell data-label="2FA">
              <span v-if="user.duaFaktorAktif" class="text-xs text-status-completed">Aktif</span>
              <span v-else-if="user.role === 'admin'" class="text-xs text-muted-foreground">Dipasang saat login</span>
              <span v-else class="text-xs text-muted-foreground">Tidak dipakai</span>
            </TableCell>
            <TableCell class="text-right" data-label="Aksi">
              <Button variant="ghost" size="icon" @click="openEdit(user)">
                <PencilIcon class="size-4" />
              </Button>
              <Button
                v-if="user.duaFaktorAktif"
                variant="ghost"
                size="icon"
                :aria-label="`Cabut 2FA ${user.username}`"
                title="Cabut 2FA (HP hilang/ganti)"
                @click="openReset2fa(user)"
              >
                <ShieldOffIcon class="size-4" />
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

    <Dialog :open="resetTarget !== null" @update:open="(v) => { if (!v) resetTarget = null }">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cabut 2FA {{ resetTarget?.username }}?</DialogTitle>
          <DialogDescription>
            Pakai ini kalau HP authenticator akun tersebut hilang atau ganti.
            Semua sesi login akun itu langsung berakhir, dan
            {{ resetTarget?.role === 'admin' ? 'wajib memasang 2FA lagi' : 'bisa login tanpa 2FA' }}
            saat masuk berikutnya.
            <span v-if="resetTarget?.id === auth.user?.id" class="mt-1 block font-medium text-foreground">
              Ini akunmu sendiri — kamu akan langsung keluar.
            </span>
          </DialogDescription>
        </DialogHeader>
        <form class="space-y-2" @submit.prevent="onReset2faConfirm">
          <Label for="reset2faPin">PIN kamu (admin)</Label>
          <Input id="reset2faPin" v-model="resetPin" type="password" inputmode="numeric" autocomplete="off" maxlength="6" required />
          <DialogFooter class="pt-2">
            <Button type="button" variant="outline" @click="resetTarget = null">Batal</Button>
            <Button type="submit" variant="destructive" :disabled="resetting || resetPin.length < 4">
              <LoaderCircleIcon v-if="resetting" class="size-4 animate-spin" />
              Cabut 2FA
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="formOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{
            editingId ? 'Ubah Akun' : 'Tambah Akun'
          }}</DialogTitle>
          <DialogDescription>
            Role menentukan apa yang bisa diakses: kasir hanya menangani
            pesanan, admin bisa mengelola menu, laporan, dan akun.
          </DialogDescription>
        </DialogHeader>
        <form id="user-form" class="space-y-4" @submit.prevent="onSubmit">
          <div class="space-y-2">
            <Label for="username">Username</Label>
            <Input
              id="username"
              v-model="form.username"
              required
              maxlength="50"
            />
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
            <Label for="pin"
              >PIN (opsional) <span class="font-normal text-muted-foreground">— untuk konfirmasi void order yang sudah dibayar</span></Label
            >
            <Input
              id="pin"
              v-model="form.pin"
              type="password"
              inputmode="numeric"
              pattern="\d{4,6}"
              :placeholder="editingId && editingHasPin ? 'Kosongkan jika tidak diubah' : '4-6 digit angka'"
              minlength="4"
              maxlength="6"
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
          <div
            class="flex items-center justify-between rounded-md border px-3 py-2"
          >
            <Label for="isActive">Aktif</Label>
            <Switch
              id="isActive"
              v-model="form.isActive"
              :disabled="editingSelf"
            />
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

    <AlertDialog
      :open="!!deleteTarget"
      @update:open="(v) => !v && (deleteTarget = null)"
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle
            >Hapus akun "{{ deleteTarget?.username }}"?</AlertDialogTitle
          >
          <AlertDialogDescription>
            Tindakan ini tidak bisa dibatalkan. Akun yang sudah punya riwayat
            aktivitas tidak bisa dihapus — nonaktifkan saja lewat tombol Ubah.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <AlertDialogAction :disabled="deleting" @click="onDeleteConfirm"
            >Hapus</AlertDialogAction
          >
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
