import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { toast } from 'vue-sonner'
import './style.css'
import App from './App.vue'
import router from './router'
import { api } from './lib/api'
import { useAuthStore } from './stores/auth'

const app = createApp(App)

app.use(createPinia())
app.use(router)

// Wired here rather than inside lib/api.js so the API client stays free of
// router/store imports. Fires when any request comes back 401 from an
// already-open screen: clear the stale local auth state and send staff to
// login with a reason, instead of leaving them on a page whose data
// silently failed to load.
api.setSessionExpiredHandler(() => {
  if (router.currentRoute.value.name === 'login') return
  useAuthStore().$patch({ user: null })
  toast.error('Sesi kamu sudah berakhir. Silakan masuk lagi.')
  router.replace({
    name: 'login',
    query: { redirect: router.currentRoute.value.fullPath },
  })
})

// Several views start store fetches in onMounted without awaiting them, and
// AppShell polls on a timer — when those reject there is no catch attached,
// so the browser reports each one. Two causes are already fully handled
// elsewhere and only add noise that buries real errors:
//
//   handled   — a 401 whose redirect to login just ran (api.js)
//   isOffline — the network is down, which the offline banner already says
//
// Everything else still surfaces normally.
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason?.handled || event.reason?.isOffline) event.preventDefault()
})

app.mount('#app')
