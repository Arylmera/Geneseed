// Geneseed PWA service worker. Deliberately minimal: it exists so the console is
// installable (a real dock/taskbar icon and its own standalone window on macOS
// and Windows) and so Vite's content-hashed, immutable assets load instantly
// from a cache. HTML navigations and /api/* always hit the network, so the
// per-session CSRF token and live data are never served stale.
const CACHE = 'geneseed-assets-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  // Only same-origin GETs are cacheable; never the API or HTML (token + live data).
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (request.mode === 'navigate' || url.pathname.startsWith('/api/')) return
  // /assets/* are content-hashed and immutable — cache-first is safe and fast.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(request).then(
          (hit) =>
            hit ||
            fetch(request).then((res) => {
              if (res.ok) cache.put(request, res.clone())
              return res
            }),
        ),
      ),
    )
  }
})
