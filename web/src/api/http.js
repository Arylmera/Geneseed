// HTTP core for the API layer — the one place fetch, the CSRF token, and error
// normalisation live. Domain modules (status, catalog, diff, jobs, mcp) build on
// `get`/`post`; index.js composes them into the single `api` object. Mirrors how
// _harness_core owns the shared primitives the topic modules import.

// The server injects this into index.html as a CSRF guard for mutating calls.
const TOKEN = typeof window !== 'undefined' ? window.__GENESEED_TOKEN__ : ''

// Turn a non-2xx response into an Error carrying the server's `error` message
// (falling back to the status text) and the HTTP status for callers that branch
// on it (e.g. 409 "already running").
async function fail(r) {
  const body = await r.json().catch(() => ({}))
  const err = new Error(body.error || r.statusText)
  err.status = r.status
  return err
}

export async function get(path) {
  const r = await fetch(path)
  if (!r.ok) throw await fail(r)
  return r.json()
}

export async function post(path, body = {}) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'X-Geneseed-Token': TOKEN || '', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw await fail(r)
  return r.json()
}
