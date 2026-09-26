import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: { name: 'menu' } },
  {
    path: '/t/:token',
    name: 'table-entry',
    component: () => import('@/views/TableEntryView.vue'),
  },
  {
    path: '/menu',
    name: 'menu',
    component: () => import('@/views/MenuView.vue'),
  },
  {
    path: '/keranjang',
    name: 'cart',
    component: () => import('@/views/CartView.vue'),
  },
  {
    path: '/checkout',
    name: 'checkout',
    component: () => import('@/views/CheckoutView.vue'),
  },
  {
    path: '/pesanan/:kodeOrder',
    name: 'order',
    component: () => import('@/views/OrderView.vue'),
  },
  // Alamat tak dikenal (salah ketik, link lama) — ke menu, bukan layar kosong.
  { path: '/:pathMatch(.*)*', redirect: { name: 'menu' } },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
