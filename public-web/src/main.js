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
//
// Production builds only. A service worker attaches to whatever origin
// happened to serve the page and then keeps replaying that origin's cached
// shell long after the server is gone — so opening this app through an
// incidental static server (VS Code's Live Server, `python -m http.server`)
// leaves behind a page that outlives it and reports errors from a server
// nobody is running any more. In dev the same caching also hands you a stale
// shell after an edit, which Vite's HMR then appears to ignore.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
