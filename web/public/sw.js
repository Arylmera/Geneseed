// Geneseed PWA service worker. Deliberately minimal: it exists so the console is
// installable (a real dock/taskbar icon and its own standalone window on macOS
// and Windows) and so Vite's content-hashed, immutable assets load instantly
// from a cache. HTML navigations and /api/* always hit the network, so the
// per-session CSRF token and live data are never served stale.
// v2: v1 may hold index.html cached under a chunk URL (see below); the new name makes
// activate drop it. shortcut: one name for every build, so old hashed assets pile up
// until the name changes; stamp a build id into dist/sw.js from vite.config.js to prune per build.
const CACHE = 'geneseed-assets-v2'

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
              // A missing file (mid-rebuild, web/dist emptied) comes back as the index.html
              // fallback at 200: cached under the chunk URL, it broke every later import().
              // A 206 is not the whole asset either. Only a full, non-HTML answer is kept.
              const type = res.headers.get('Content-Type') || ''
              if (res.status === 200 && !type.startsWith('text/html'))
                cache.put(request, res.clone())
              return res
            }),
        ),
      ),
    )
  }
})
