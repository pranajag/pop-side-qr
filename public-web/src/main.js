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
//
// PROD alone isn't a strict enough gate: `dist/` is a real production build,
// and VS Code's Live Server will happily serve it on port 5500. A worker
// registered from there outlives Live Server itself — the browser keeps
// replaying that cached shell, Live Server's injected reload.js included,
// which then retries ws://127.0.0.1:5500 forever against a server nobody is
// running. Observed in the wild, and confusing precisely because stopping
// Live Server doesn't stop it. Nothing is ever really deployed on these
// ports, so refusing to register there costs nothing.
const LIVE_SERVER_PORTS = new Set(['5500', '5501'])
const servedByLiveServer = LIVE_SERVER_PORTS.has(window.location.port)

if (import.meta.env.PROD && !servedByLiveServer && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

// If one was already registered from such a server before the guard above
// existed, it's still installed in that browser and still replaying the old
// page. Clean it up from the same origin rather than leaving the person to
// find it in chrome://serviceworker-internals.
if (servedByLiveServer && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => regs.forEach((r) => r.unregister()))
    .catch(() => {})
}
