import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: { name: 'menu' } },
  { path: '/t/:token', name: 'table-entry', component: () => import('@/views/TableEntryView.vue') },
  { path: '/menu', name: 'menu', component: () => import('@/views/MenuView.vue') },
  { path: '/keranjang', name: 'cart', component: () => import('@/views/CartView.vue') },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
