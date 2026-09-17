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
      { path: '', redirect: { name: 'kategori' } },
      { path: 'kategori', name: 'kategori', component: () => import('@/views/CategoriesView.vue') },
      { path: 'produk', name: 'produk', component: () => import('@/views/ProductsView.vue') },
      { path: 'meja', name: 'meja', component: () => import('@/views/TablesView.vue') },
    ],
  },
  {
    path: '/tidak-tersedia',
    name: 'not-available',
    component: () => import('@/views/NotAvailableView.vue'),
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
    return { name: 'kategori' }
  }
  // Kasir accounts exist (Sprint 1 seed) but the kasir dashboard isn't
  // built until Sprint 5 — send them somewhere honest instead of letting
  // every admin-only API call in these views fail with 403.
  if (!to.meta.public && to.name !== 'not-available' && auth.isAuthenticated && !auth.isAdmin) {
    return { name: 'not-available' }
  }
  return true
})

export default router
