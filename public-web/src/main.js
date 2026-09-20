import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'
import router from './router'

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')

// Menu browsing (and order tracking's own already-loaded data) stays usable
// if the cafe's WiFi drops mid-visit — see public/sw.js for exactly what it
// does and doesn't cache. Best-effort: a browser that rejects service
// workers (or dev tooling that intercepts /sw.js) just runs without offline
// support, nothing else depends on this succeeding.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
