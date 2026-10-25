// @vitest-environment node
// The service worker runs through its REAL source: `public/sw.js` is a classic script (an
// `export` would make it a syntax error the page's `register().catch` swallows), so the
// test evaluates its text against a fake `self`, an in-memory `caches` and a stubbed
// `fetch`, then drives the listeners it registered.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8')
const ORIGIN = 'http://127.0.0.1:4747'

function boot({ respond, existing = [] }) {
  const listeners = {}
  const stores = new Map(existing.map((name) => [name, new Map()]))
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map())
      const store = stores.get(name)
      return {
        match: async (req) => store.get(req.url)?.clone(),
        put: async (req, res) => void store.set(req.url, res),
      }
    },
  }
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, fn) => (listeners[type] = fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  }
  let fetches = 0
  const fetch = async (req) => {
    fetches += 1
    return respond(req)
  }
  new Function('self', 'caches', 'fetch', SRC)(self, caches, fetch)

  async function get(path, mode = 'no-cors') {
    const request = { url: ORIGIN + path, method: 'GET', mode }
    let answer = null
    const waits = []
    listeners.fetch({
      request,
      respondWith: (p) => (answer = p),
      waitUntil: (p) => waits.push(p),
    })
    const res = answer && (await answer)
    await Promise.all(waits)
    await new Promise((r) => setTimeout(r, 0)) // let an unawaited cache.put land
    return res
  }
  async function activate() {
    const waits = []
    listeners.activate({ waitUntil: (p) => waits.push(p) })
    await Promise.all(waits)
  }
  return { get, activate, stores, fetches: () => fetches }
}

const html = () =>
  new Response('<!doctype html><title>x</title>', {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  })
const js = (body = 'export default 1') =>
  new Response(body, { status: 200, headers: { 'Content-Type': 'text/javascript' } })

describe('service worker asset cache', () => {
  it('never caches the index.html fallback the server sends for a missing chunk', async () => {
    // A rebuild empties web/dist: for that moment a still-valid hash URL is missing and
    // the server answers it with index.html at 200. Cached, it poisoned every later
    // import() of that chunk ("Failed to fetch dynamically imported module").
    let missing = true
    const sw = boot({ respond: () => (missing ? html() : js()) })
    await sw.get('/assets/Library-abc123.js')
    missing = false
    const res = await sw.get('/assets/Library-abc123.js')
    expect(res.headers.get('Content-Type')).toBe('text/javascript')
    expect(await res.text()).toBe('export default 1')
    expect(sw.fetches()).toBe(2)
  })

  it('never caches a non-200 answer (a 206 or 404 is not the immutable asset)', async () => {
    let status = 206
    const sw = boot({
      respond: () =>
        status === 200
          ? js()
          : new Response('part', { status, headers: { 'Content-Type': 'text/javascript' } }),
    })
    await sw.get('/assets/react-x.js')
    status = 404
    await sw.get('/assets/react-x.js')
    status = 200
    expect(await (await sw.get('/assets/react-x.js')).text()).toBe('export default 1')
    expect(sw.fetches()).toBe(3)
  })

  it('serves a good asset from cache after the first fetch', async () => {
    const sw = boot({ respond: () => js() })
    await sw.get('/assets/react-x.js')
    expect(await (await sw.get('/assets/react-x.js')).text()).toBe('export default 1')
    expect(sw.fetches()).toBe(1)
  })

  it('leaves navigations and the API to the network', async () => {
    const sw = boot({ respond: () => html() })
    expect(await sw.get('/', 'navigate')).toBe(null)
    expect(await sw.get('/api/overview')).toBe(null)
  })

  it('drops the v1 cache that may hold a poisoned chunk when it activates', async () => {
    const sw = boot({ respond: () => js(), existing: ['geneseed-assets-v1'] })
    await sw.activate()
    expect(sw.stores.has('geneseed-assets-v1')).toBe(false)
  })
})
