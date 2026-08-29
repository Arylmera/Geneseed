// The API facade — every endpoint the UI calls, grouped by domain under section
// headers. http.js still owns the shared primitives (fetch, CSRF, error
// normalisation); this file is the whole rest of the layer. It used to be eleven
// one-wrapper-per-line domain modules spread into this object — the split bought
// nothing at the call site (`api.*` was always flat), so the domains live here as
// sections instead of files.
import { get, post } from './http.js'

// ── Status ──────────────────────────────────────────────────────────────────
// Read-only status surface: the dashboards' overview, the install snapshot,
// doctor results, and the theme/voice catalogue. (Plus the one live-activity
// mutation — flipping its on/off toggle.)

const overview = () => get('/api/overview')
// The newest file-backed entries across the harness. Its own endpoint rather than a field on
// the overview: it stats every candidate file, which the overview (fetched on every mutation)
// has no business paying for.
const recent = () => get('/api/recent')
const activity = () => get('/api/activity')
const activityDetail = (sid) => get('/api/activity/' + encodeURIComponent(sid))
const activityToggle = (enabled) => post('/api/activity', { enabled })
const setup = () => get('/api/setup')
const doctor = () => get('/api/doctor')
const themes = () => get('/api/themes')

// ── Catalog ─────────────────────────────────────────────────────────────────
// Library browsing: list a section's items, read one rendered item, or delete a
// memory fact (which also drops it from the MEMORY.md index server-side).

const catalog = (section) => get(`/api/catalog/${section}`)
const item = (type, name) => get(`/api/item/${type}/${encodeURIComponent(name)}`)
const memoryDelete = (name) => post('/api/memory/delete', { name })

// ── Diff ────────────────────────────────────────────────────────────────────
// Drift from source: read the deployed-vs-source diff, and restore (discard
// local edits for) selected files. Restore is synchronous — it returns
// { restored, deleted, errors }, not a job id.

const diff = () => get('/api/diff')
const restore = (files) => post('/api/actions/restore', { files })

// ── Jobs ────────────────────────────────────────────────────────────────────
// Long-running actions and their job lifecycle. `action` kicks off a named
// action (build, update, doctor, export, …) and returns { job_id }; the others
// poll, list, and cancel. opts (e.g. { theme, emit } for build) ride in the body.

const HTTP_CONFLICT = 409 // server is busy with another single-flight action

const job = (id) => get(`/api/jobs/${id}`)
const jobs = () => get('/api/jobs')
const cancelJob = (id) => post(`/api/jobs/${id}/cancel`)

async function action(name, opts) {
  try {
    return await post(`/api/actions/${name}`, opts || {})
  } catch (e) {
    if (e.status === HTTP_CONFLICT) throw new Error('An action is already running.')
    throw e
  }
}

// ── MCP ─────────────────────────────────────────────────────────────────────
// MCP server wiring: list configured targets/servers, and toggle one on or off
// (the server rewrites only the `mcp` block of the target config).

const mcp = () => get('/api/mcp')
const mcpToggle = (path, name, enabled) => post('/api/mcp', { path, name, enabled })

// Ask the machine running the daemon to open the FOLDER holding a target's config, so the
// tokens and URLs a preset leaves blank can actually be filled in. `path` is the target's
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
// payload's `kind` decides how the frontend renders it (markdown, cli, specs,
// glossary, about, concept) — the server's docs-page endpoint sets it.

// `harness` ('opencode' | 'claude') filters the menu and strips the other
// host's inline blocks server-side. Omitted → server uses the installed default.
const hq = (harness) => (harness ? `?harness=${encodeURIComponent(harness)}` : '')

const docs = (harness) => get(`/api/docs${hq(harness)}`)
const docsPage = (id, harness) => get(`/api/docs/page/${encodeURIComponent(id)}${hq(harness)}`)

// ── Rules ───────────────────────────────────────────────────────────────────
// User rules (user-rules.md) — the Rules page. Reads return the parsed rules,
// budget stats, and a content fingerprint; every mutation must send that
// fingerprint back and gets a 409 when the file changed under it (an agent
// session editing the same file), so the UI reloads instead of clobbering.

const rules = () => get('/api/rules')
const rulesMutate = (body) => post('/api/rules', body)
const rulesPromote = (body) => post('/api/rules/promote', body)

// ── Profile ─────────────────────────────────────────────────────────────────
// User profile (PROFILE.md) — the Profile page. The read returns the raw markdown
// and a content fingerprint; the save must send that fingerprint back and gets a 409
// when the file changed under it (an agent session editing the same file), so the UI
// reloads instead of clobbering.

const profile = () => get('/api/profile')
const profileSave = (body) => post('/api/profile', body)

// ── Excludes ────────────────────────────────────────────────────────────────
// Sovereign-repo exclusions: folders where every global harness install goes
// dormant (hooks stay silent, the preamble is not loaded). The web mirror of
// `harness exclude add|remove|list`.

const excludes = () => get('/api/excludes')
const excludeMutate = (action, path) => post('/api/excludes', { action, path })

export const api = {
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
  mcpToggle,
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
