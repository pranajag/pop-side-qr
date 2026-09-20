import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    component: () => import('@/components/AppShell.vue'),
    children: [
      { path: '', redirect: { name: 'pesanan' } },
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/views/DashboardView.vue'),
        meta: { roles: ['admin'] },
      },
      // Order handling is core kasir work, not admin-only (MEMORY.md).
      {
        path: 'pesanan',
        name: 'pesanan',
        component: () => import('@/views/OrdersView.vue'),
        meta: { roles: ['admin', 'kasir'] },
      },
      {
        path: 'pesanan/manual',
        name: 'pesanan-manual',
        component: () => import('@/views/ManualOrderView.vue'),
        meta: { roles: ['admin', 'kasir'] },
      },
      {
        path: 'shift',
        name: 'shift',
        component: () => import('@/views/ShiftView.vue'),
        meta: { roles: ['admin', 'kasir'] },
      },
      {
        path: 'reservasi',
        name: 'reservasi',
        component: () => import('@/views/ReservationsView.vue'),
        meta: { roles: ['admin', 'kasir'] },
      },
      {
        path: 'member',
        name: 'member',
        component: () => import('@/views/MembersView.vue'),
        meta: { roles: ['admin', 'kasir'] },
      },
      {
        path: 'kategori',
        name: 'kategori',
        component: () => import('@/views/CategoriesView.vue'),
        meta: { roles: ['admin'] },
      },
      {
        path: 'produk',
        name: 'produk',
        component: () => import('@/views/ProductsView.vue'),
        meta: { roles: ['admin'] },
      },
      {
        path: 'meja',
        name: 'meja',
        component: () => import('@/views/TablesView.vue'),
        meta: { roles: ['admin'] },
      },
      {
        path: 'laporan',
        name: 'laporan',
        component: () => import('@/views/ReportView.vue'),
        meta: { roles: ['admin'] },
      },
      {
        path: 'riwayat',
        name: 'riwayat',
        component: () => import('@/views/ActivityLogView.vue'),
        meta: { roles: ['admin'] },
      },
      {
        path: 'akun',
        name: 'akun',
        component: () => import('@/views/UsersView.vue'),
        meta: { roles: ['admin'] },
      },
      {
        path: 'pengaturan',
        name: 'pengaturan',
        component: () => import('@/views/SettingsView.vue'),
        meta: { roles: ['admin'] },
      },
    ],
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.ready) {
    await auth.init()
  }

  if (!to.meta.public && !auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.name === 'login' && auth.isAuthenticated) {
    return { name: auth.user?.role === 'admin' ? 'dashboard' : 'pesanan' }
  }
  // Root path lands admins on the overview dashboard instead of the raw
  // order queue — kasir keeps the existing static redirect above (a kasir
  // dashboard would just be a smaller Pesanan, so it isn't worth a second
  // page). Checked here, not as the static child redirect, since that
  // config has no access to the logged-in user's role.
  if (to.path === '/' && auth.user?.role === 'admin') {
    return { name: 'dashboard' }
  }
  // Route declares which roles may see it (undefined = any authenticated
  // role) — send anyone else to the one page every role can reach.
  const allowedRoles = to.meta.roles
  if (allowedRoles && auth.user && !allowedRoles.includes(auth.user.role)) {
    return { name: 'pesanan' }
  }
  return true
})

export default router
