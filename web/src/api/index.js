// The API facade — every endpoint the UI calls, grouped by domain under section
// headers. http.js still owns the shared primitives (fetch, CSRF, error
// normalisation); this file is the whole rest of the layer. It used to be eleven
// one-wrapper-per-line domain modules spread into this object — the split bought
// nothing at the call site (`api.*` was always flat), so the domains live here as
// sections instead of files.
import { get, post } from './http.js'

// ── The install a call reads ────────────────────────────────────────────────
// Every install-scoped call takes an optional trailing `install` ({ host, path }, a row of
// /api/installs or /api/fleet). Reads send it as `?host=&path=` (two params: a Windows path
// holds a colon), writes as `host`/`path` in the body. Omitted, the server answers for the
// install the topbar selector picked. An unknown pair is a 404, never another install's data.

// True for a whole pair, false for none (null/undefined). A HALF or malformed pair throws, as
// the server refuses it: dropped silently, a write would land on the topbar's install.
const named = (install) => {
  if (install == null) return false
  if (typeof install.host === 'string' && typeof install.path === 'string') return true
  throw new Error('an install needs both host and path')
}
// `url` plus the install's params, merged into any query the url already carries.
const withInstall = (url, install) => {
  if (!named(install)) return url
  const q = new URLSearchParams({ host: install.host, path: install.path })
  return `${url}${url.includes('?') ? '&' : '?'}${q}`
}
// `body` plus the install's `host`/`path`. A body that already carries either key keeps it
// meaning something else, so naming an install there is a caller bug, not a silent overwrite.
const bodyFor = (body, install) => {
  const b = body ?? {}
  if (!named(install)) return b
  if ('host' in b || 'path' in b) throw new Error('this body already has host or path')
  return { ...b, host: install.host, path: install.path }
}
// The two the endpoints call. A bad install REJECTS, like any failed request, never throws
// synchronously: a caller's `.catch` or `await` sees it the same way.
const settle = (fn) => {
  try {
    return fn()
  } catch (e) {
    return Promise.reject(e)
  }
}
const getIn = (url, install) => settle(() => get(withInstall(url, install)))
const postIn = (url, body, install) => settle(() => post(url, bodyFor(body, install)))

// ── Status ──────────────────────────────────────────────────────────────────
// Read-only status surface: the dashboards' overview, the install snapshot,
// doctor results, and the theme/voice catalogue. (Plus the one live-activity
// mutation — flipping its on/off toggle.)

const overview = (install) => getIn('/api/overview', install)
// The Ledger Overview's four reads: every installed harness (sync, drift, always-on cost), skill
// and agent calls over 30 days, gate asks per rule per day, and whether a newer release exists.
const fleet = () => get('/api/fleet')
// Every kit this Geneseed ships, and per install which are on: the Installs / Kits tab.
const kits = () => get('/api/kits')
const usage = () => get('/api/usage')
const gates = () => get('/api/gates')
const update = () => get('/api/update')
// The newest file-backed entries across the harness. Its own endpoint rather than a field on
// the overview: it stats every candidate file, which the overview (fetched on every mutation)
// has no business paying for.
const recent = (install) => getIn('/api/recent', install)
const activity = (install) => getIn('/api/activity', install)
const activityDetail = (sid, install) => getIn('/api/activity/' + encodeURIComponent(sid), install)
const activityToggle = (enabled, install) => postIn('/api/activity', { enabled }, install)
const setup = (install) => getIn('/api/setup', install)
// Served from the daemon's cached run; `fresh` (the Doctor page's Re-run) runs every check again.
const doctor = (fresh = false, install) =>
  getIn(fresh ? '/api/doctor?fresh=1' : '/api/doctor', install)
const themes = (install) => getIn('/api/themes', install)

// ── Catalog ─────────────────────────────────────────────────────────────────
// Library browsing: list a section's items, read one rendered item, or delete a
// memory fact (which also drops it from the MEMORY.md index server-side).

const catalog = (section, install) => getIn(`/api/catalog/${section}`, install)
const item = (type, name, install) =>
  getIn(`/api/item/${type}/${encodeURIComponent(name)}`, install)
const memoryDelete = (name, install) => postIn('/api/memory/delete', { name }, install)

// ── Diff ────────────────────────────────────────────────────────────────────
// Drift from source: read the deployed-vs-source diff, and restore (discard
// local edits for) selected files. Restore is synchronous — it returns
// { restored, deleted, errors }, not a job id.

const diff = (install) => getIn('/api/diff', install)
const restore = (files, install) => postIn('/api/actions/restore', { files }, install)

// ── Jobs ────────────────────────────────────────────────────────────────────
// Long-running actions and their job lifecycle. `action` kicks off a named
// action (build, update, doctor, export, …) and returns { job_id }; the others
// poll, list, and cancel. opts (e.g. { theme, emit } for build) ride in the body.

const HTTP_CONFLICT = 409 // server is busy with another single-flight action

const job = (id) => get(`/api/jobs/${id}`)
const jobs = () => get('/api/jobs')
const cancelJob = (id) => post(`/api/jobs/${id}/cancel`)

// `install` is merged for `build` and `restore` only, the two actions the server reads it on.
// The others ignore it, and `install`/`deploy` read `host`/`path` as their own target, so it is
// never added to their body.
const ACTIONS_WITH_INSTALL = new Set(['build', 'restore'])

async function action(name, opts, install) {
  const body = opts || {}
  const url = `/api/actions/${name}`
  try {
    return await (ACTIONS_WITH_INSTALL.has(name) ? postIn(url, body, install) : post(url, body))
  } catch (e) {
    // Only startJob's `busy` is the single-flight case; install refusals are 409 too and keep their text.
    if (e.status === HTTP_CONFLICT && e.body?.error === 'busy')
      throw new Error('An action is already running.', { cause: e })
    throw e
  }
}

// ── Loops ────────────────────────────────────────────────────────────────────
// The loop catalogue, read-only: templates (each with its graph), bricks (with their
// source body), and which project or global brick overrides a shipped one.

const loops = (install) => getIn('/api/loops', install)
// The Active tab: every loop `geneseed loop init` registered, its LOOP.md re-read per call;
// and the one write the page makes, a loop's preset (404 on an unknown root or preset).
const activeLoops = () => get('/api/loops/active')
const setLoopPreset = (root, preset) => post('/api/loops/preset', { root, preset })

// ── MCP ─────────────────────────────────────────────────────────────────────
// MCP server wiring, read-only: each active install's config and the servers it holds.

const mcp = () => get('/api/mcp')

// Ask the machine running the daemon to open the FOLDER holding a target's config, so the
// user can edit it by hand. `path` is the target's
// config path and must be one the server already listed — it checks, and 404s otherwise.
// Resolves `{ ok, dir }`; `ok` means the path was allowed, not that a window appeared (a
// headless host has no opener and the server swallows that by design).
const mcpReveal = (path) => post('/api/reveal', { path })

// ── Installs ────────────────────────────────────────────────────────────────
// Harness install activation: list every detected install (host × scope) and their
// on/off state, and flip one whole install between active and disabled. The on-disk
// stash dir is the single source of truth — these calls only trigger and reflect.
// Toggling is keyed on the (host, path) PAIR: a cwd can carry both an OpenCode and a
// Claude install at the same path, so path alone is ambiguous.

const installs = () => get('/api/installs')
const installToggle = (host, path, action) => post('/api/install', { host, path, action })
// Permanently delete a folder install and de-list it. `memory` ∈ {keep, archive, delete}
// governs the memory/notebook stores. Same (host, path) allowlist as installToggle.
const installRemove = (host, path, memory) =>
  post('/api/install', { host, path, action: 'remove', memory })
// Re-point the whole console at a detected install (the harness selector).
const selectView = (host, path) => post('/api/view', { host, path })
// Open the OS-native folder chooser on the daemon host and return the picked absolute
// path: { path } | { cancelled: true } | { error }. The browser can't reveal a disk path
// itself, so the local daemon pops a real Finder/dialog on the user's own screen.
const pickFolder = () => post('/api/pick-folder', {})

// ── Server ──────────────────────────────────────────────────────────────────
// Local server lifecycle: a liveness ping and a graceful self-stop, so the
// console can be shut down from the page itself (mirrors `geneseed web stop`).

const ping = () => get('/api/ping')
const shutdown = () => post('/api/shutdown')
const restart = () => post('/api/restart')

// ── Docs ────────────────────────────────────────────────────────────────────
// Docs surface: the menu (groups + pages) and one page at a time. The page
// payload's `kind` decides how the frontend renders it (markdown, concept, map,
// cli, glossary, about) — the server's docs-page endpoint sets it.

// `harness` (a host id: 'opencode' | 'claude' | 'openclaude' | 'bob') filters the
// menu and strips the other hosts' inline blocks server-side. Omitted → server
// uses the installed default.
const hq = (harness) => (harness ? `?harness=${encodeURIComponent(harness)}` : '')

const docs = (harness, install) => getIn(`/api/docs${hq(harness)}`, install)
const docsPage = (id, harness, install) =>
  getIn(`/api/docs/page/${encodeURIComponent(id)}${hq(harness)}`, install)

// ── Rules ───────────────────────────────────────────────────────────────────
// User rules (user-rules.md) — the Rules page. Reads return the parsed rules,
// budget stats, and a content fingerprint; every mutation must send that
// fingerprint back and gets a 409 when the file changed under it (an agent
// session editing the same file), so the UI reloads instead of clobbering.

const rules = (install) => getIn('/api/rules', install)
const rulesMutate = (body, install) => postIn('/api/rules', body, install)
const rulesPromote = (body, install) => postIn('/api/rules/promote', body, install)

// ── Profile ─────────────────────────────────────────────────────────────────
// User profile (PROFILE.md) — the Profile page. The read returns the raw markdown
// and a content fingerprint; the save must send that fingerprint back and gets a 409
// when the file changed under it (an agent session editing the same file), so the UI
// reloads instead of clobbering.

const profile = (install) => getIn('/api/profile', install)
const profileSave = (body, install) => postIn('/api/profile', body, install)

// ── Excludes ────────────────────────────────────────────────────────────────
// Sovereign-repo exclusions: folders where every global harness install goes
// dormant (hooks stay silent, the preamble is not loaded). The web mirror of
// `harness exclude add|remove|list`.

const excludes = () => get('/api/excludes')
const excludeMutate = (action, path) => post('/api/excludes', { action, path })

export const api = {
  fleet,
  kits,
  usage,
  gates,
  update,
  loops,
  activeLoops,
  setLoopPreset,
  overview,
  recent,
  activity,
  activityDetail,
  activityToggle,
  setup,
  doctor,
  themes,
  catalog,
  item,
  memoryDelete,
  diff,
  restore,
  job,
  jobs,
  cancelJob,
  action,
  mcp,
  mcpReveal,
  installs,
  installToggle,
  installRemove,
  selectView,
  pickFolder,
  ping,
  shutdown,
  restart,
  docs,
  docsPage,
  rules,
  rulesMutate,
  rulesPromote,
  profile,
  profileSave,
  excludes,
  excludeMutate,
}
