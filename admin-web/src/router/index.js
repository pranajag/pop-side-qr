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
      // Order handling is core kasir work, not admin-only (MEMORY.md).
      { path: 'pesanan', name: 'pesanan', component: () => import('@/views/OrdersView.vue'), meta: { roles: ['admin', 'kasir'] } },
      {
        path: 'pesanan/manual',
        name: 'pesanan-manual',
        component: () => import('@/views/ManualOrderView.vue'),
        meta: { roles: ['admin', 'kasir'] },
      },
      { path: 'kategori', name: 'kategori', component: () => import('@/views/CategoriesView.vue'), meta: { roles: ['admin'] } },
      { path: 'produk', name: 'produk', component: () => import('@/views/ProductsView.vue'), meta: { roles: ['admin'] } },
      { path: 'meja', name: 'meja', component: () => import('@/views/TablesView.vue'), meta: { roles: ['admin'] } },
      { path: 'laporan', name: 'laporan', component: () => import('@/views/ReportView.vue'), meta: { roles: ['admin'] } },
      { path: 'akun', name: 'akun', component: () => import('@/views/UsersView.vue'), meta: { roles: ['admin'] } },
      { path: 'pengaturan', name: 'pengaturan', component: () => import('@/views/SettingsView.vue'), meta: { roles: ['admin'] } },
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
    return { name: 'pesanan' }
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
