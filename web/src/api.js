const TOKEN = typeof window !== 'undefined' ? window.__GENESEED_TOKEN__ : ''

async function get(path) {
  const r = await fetch(path)
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText)
  return r.json()
}

export const api = {
  overview: () => get('/api/overview'),
  catalog: (section) => get(`/api/catalog/${section}`),
  item: (type, name) => get(`/api/item/${type}/${encodeURIComponent(name)}`),
  diff: () => get('/api/diff'),
  themes: () => get('/api/themes'),
  job: (id) => get(`/api/jobs/${id}`),
  // opts (e.g. { theme, emit } for build) ride along in the JSON body.
  async action(name, opts) {
    const r = await fetch(`/api/actions/${name}`, {
      method: 'POST',
      headers: { 'X-Geneseed-Token': TOKEN || '', 'Content-Type': 'application/json' },
      body: JSON.stringify(opts || {}),
    })
    if (r.status === 409) throw new Error('An action is already running.')
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText)
    return r.json() // { job_id }
  },
}
