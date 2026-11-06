// HTTP core for the API layer — the one place fetch, the CSRF token, and error
// normalisation live. index.js builds every endpoint on `get`/`post` and exports
// them as the single `api` object.

// The server injects this into index.html as a CSRF guard for mutating calls.
const TOKEN = typeof window !== 'undefined' ? window.__GENESEED_TOKEN__ : ''

// Turn a non-2xx response into an Error carrying the server's `error` message
// (falling back to the status text) and the HTTP status for callers that branch
// on it (e.g. 409 "already running").
async function fail(r) {
  const body = await r.json().catch(() => ({}))
  // The CSRF token is read once at page load and is minted fresh by every daemon
  // start, so a tab left open across a `web restart` 403s on every mutation with a
  // bare "forbidden" — which reads as "the save silently did nothing". Say what it is.
  const msg =
    r.status === 403 && body.error === 'forbidden'
      ? 'the web server restarted since this page loaded — reload the page, then re-apply your edit'
      : body.error || body.message || r.statusText
  const err = new Error(msg)
  err.status = r.status
  err.body = body
  return err
}

// Longer than the slowest answer a read can give: `/api/doctor` waits on the warm-up run, which the
// server stops at 180 s. Past this the daemon is wedged, and a page must fail, not stay pending.
export const GET_TIMEOUT_MS = 200_000

export async function get(path) {
  try {
    const r = await fetch(path, { signal: AbortSignal.timeout(GET_TIMEOUT_MS) })
    if (!r.ok) throw await fail(r)
    return await r.json()
  } catch (e) {
    if (e?.name === 'TimeoutError') {
      throw new Error('the local server did not answer in time', { cause: e })
    }
    throw e
  }
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
