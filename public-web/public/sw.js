// Basic offline support: lets a customer who already opened the menu keep
// browsing it (and see their own order status) if the cafe's WiFi drops
// mid-visit. Deliberately NOT a full offline-first cache — checkout still
// needs a live request (CheckoutView.vue's own queue+retry handles a
// network failure there), this only keeps read-only browsing alive.
const CACHE_NAME = 'popside-public-v1'
// GET requests worth serving from cache when the network is down — the
// app shell plus the read-only endpoints menu browsing needs. The API is a
// different origin from this app (VITE_API_URL), which a service worker's
// fetch handler still sees — every request a controlled page makes passes
// through it regardless of origin. Order tracking/cart/checkout are
// intentionally excluded: their data must never be served stale.
const RUNTIME_CACHE_PATTERNS = [/\/api\/public\/menu$/, /\/api\/public\/settings$/, /\/api\/public\/products\/photo\//]

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  )
  self.clients.claim()
})

function isCacheable(request) {
  if (request.method !== 'GET') return false
  const url = new URL(request.url)
  if (url.origin === self.location.origin) {
    return url.pathname === '/' || url.pathname.startsWith('/assets/')
  }
  return RUNTIME_CACHE_PATTERNS.some((re) => re.test(url.pathname))
}

// Network-first, falling back to cache — online always sees live data;
// offline (or a dropped request mid-flight) falls back to the last good
// response instead of a hard failure, which is the entire point here.
self.addEventListener('fetch', (event) => {
  if (!isCacheable(event.request)) return

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
        }
        return response
      })
      .catch(() => caches.match(event.request))
  )
})
