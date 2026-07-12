// Geneseed — OpenCode project-context plugin (v2, convention-glob).
//
// Enforces Law XVIII ("Load the Project Context") by INJECTION, not instruction:
// on `session.created` it puts the repo's documentation in context before your
// first turn, rather than trusting the agent to read it. v2 removes the need for a
// committed `context.json` — it AUTO-DISCOVERS the current repo's docs by
// convention (so the harness can live entirely in the global config dir, with zero
// per-repo files), while still honouring an explicit manifest when one exists.
//
// Source resolution (first match wins):
//   1. $GENESEED_CONTEXT                explicit manifest path  -> declarative mode
//   2. <repo>/.harness/context.json     per-repo override       -> declarative mode
//   3. <repo>/context.json              legacy per-repo manifest -> declarative mode
//   4. (none)                           -> AUTO-DISCOVERY (convention glob)
// A manifest may set "extend": true to run auto-discovery first, then add/override.
//
// Eager docs are injected in full (budget-capped, oversized ones demoted to lazy);
// lazy docs are only listed (path + first heading) to be read on demand. Output
// mirrors `rituals/harness.py context`. Every error is swallowed — it never blocks
// a session. See adapters/opencode/GLOBAL-HARNESS-SPEC.md.
//
// The block also carries two best-effort self-orientation lines:
//   - COMMANDS: the repo's runnable targets (Makefile / package.json scripts /
//     justfile / Taskfile), so the agent invokes real entry points, not guesses.
//   - MODEL: the model the session is using (read from the transcript, else
//     $GENESEED_MODEL), so the agent reasons within its real limits. The model line
//     is added per request, outside the cached block; unknown -> omitted.
//
// MACHINE WIKI (AGENT.md §7): the same block also carries the user's own knowledge
// base(s) — typically an Obsidian vault — declared once per machine in `wiki.jsonc`
// ($GENESEED_WIKI -> $GENESEED_HARNESS/wiki.jsonc -> beside this plugin's install).
// Each wiki's eager entries inject in full and lazy entries list, drawing on the
// SAME budgets as the project context; its conventions/inbox/protected metadata is
// surfaced so the agent knows the house rules before writing. No wiki.jsonc, or an
// empty `wikis` list, costs nothing.
//
// DELIVERY (invisible by default): the context rides into each request's message
// array via `experimental.chat.messages.transform` — nothing shows in the
// conversation, and it survives compaction inherently (re-sent per request). The
// hook is experimental; on a build that lacks it the plugin notices (a request
// completes without the hook ever firing) and FALLS BACK to the classic visible
// delivery — a `session.created` noReply message — so no build is left without
// context. GENESEED_CONTEXT_VISIBLE=1 forces the visible block up front (legacy
// GENESEED_CONTEXT_TRANSFORM=0/off does the same; =1 matches the default).
//
// Quiet: by default it logs NOTHING (OpenCode shows a plugin's stderr as red text).
// GENESEED_DEBUG=1 re-enables discovery/inject logs. GENESEED_CONTEXT_INJECT=off
// disables injection entirely — no PROJECT CONTEXT in any form — leaving project
// context to the AGENT.md Law (soft, agent-discipline) instead of injection.
//
// Install: copy into ~/.config/opencode/plugins/ (global) — `build --emit
// opencode-global` and `--emit opencode` both place it for you. Keep ONE copy:
// OpenCode dedups plugins by npm name+version only, so two local copies both load.

import { promises as fs } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const MARKER = "<!-- geneseed-context:v2 -->"
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))

// ---- tunable budgets (env-overridable) -------------------------------------
// Garbage in the env var must fall back to the default, not poison the budget as
// NaN — every `>` comparison against NaN is false, which silently DISABLES the
// demotion checks and injects oversized docs unbounded on every request.
const envNum = (name, dflt) => {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? n : dflt
}
const EAGER_FILE_KB = envNum("GENESEED_EAGER_FILE_KB", 16)
const EAGER_TOTAL_KB = envNum("GENESEED_EAGER_TOTAL_KB", 48)
const MAX_FILES_SCANNED = 2000
const MAX_DEPTH = 6
// Bounds on lazy-listing cost: read at most this many headings per session, and only
// the head of each file (enough for an H1) rather than the whole thing — a large
// docs/ tree must not cost one full-file read per entry on every session start.
const LAZY_HEADING_LIMIT = envNum("GENESEED_LAZY_HEADINGS", 64)
const HEADING_SLICE_BYTES = 4096

// Quiet by default — OpenCode surfaces a plugin's stderr in the UI (red text). Set
// GENESEED_DEBUG=1 to see discovery/inject logs. Set GENESEED_CONTEXT_INJECT=off to
// disable injection entirely and lean on the AGENT.md project-context Law instead
// (no PROJECT CONTEXT delivered at all; enforcement becomes soft/agent-discipline).
const DEBUG = !!process.env.GENESEED_DEBUG
const INJECT_OFF = ["off", "0", "false", "no"].includes(
  (process.env.GENESEED_CONTEXT_INJECT || "on").toLowerCase())
// Delivery — INVISIBLE by default: the context is prepended to each request's message
// array via `experimental.chat.messages.transform`, so no PROJECT CONTEXT block shows
// in the conversation and compaction survival is inherent (re-sent per request).
// GENESEED_CONTEXT_VISIBLE=1 forces the classic visible session.created message
// instead; legacy GENESEED_CONTEXT_TRANSFORM=0/off is honoured the same way (=1, the
// old opt-in, now matches the default). The transform hook is experimental — when a
// build lacks it the event handler detects that and engages the visible fallback, so
// no build is left without context.
const VISIBLE =
  ["1", "on", "true", "yes"].includes(
    (process.env.GENESEED_CONTEXT_VISIBLE || "").toLowerCase()) ||
  ["0", "off", "false", "no"].includes(
    (process.env.GENESEED_CONTEXT_TRANSFORM || "").toLowerCase())
const TRANSFORM = !VISIBLE
// Fallback state (module-level — OpenCode keeps ONE copy of the plugin loaded):
// `transformSeen` flips the first time the experimental hook fires; if a request
// completes (session.idle) while it is still false, the build lacks the hook and
// `fallbackVisible` switches delivery to the classic visible injection.
let transformSeen = false
let fallbackVisible = false
function log(msg) { if (DEBUG) console.error(`[geneseed-context] ${msg}`) }

// ---- convention --------------------------------------------------------------
// Root-level files injected in full. Agent-directed rules + canonical entry docs.
const EAGER_ROOT = new Set([
  "AGENTS.md", "AGENT.md", "CLAUDE.md", ".cursorrules",
  "README.md", "CONTRIBUTING.md", "user-rules.md", "PROFILE.md",
])
// Doc trees walked recursively; everything found is lazy (listed, not injected).
const LAZY_DIRS = ["docs", "doc", "documentation", "architecture", "adr", "ADR"]
// Never descend into these.
const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "vendor", ".next", "target",
  ".venv", "__pycache__", ".opencode", ".harness",
])

async function isFile(p) { try { return (await fs.stat(p)).isFile() } catch { return false } }
async function isDir(p) { try { return (await fs.stat(p)).isDirectory() } catch { return false } }

async function readJson(p) {
  try { return JSON.parse(await fs.readFile(p, "utf8")) } catch { return null }
}

// Strip JSONC niceties — // and /* */ comments plus trailing commas — string-aware,
// so a "https://…" or "C:/Users/…" inside quotes is untouched. wiki.jsonc is seeded
// with a commented example, so its readers must tolerate comments.
function stripJsonc(text) {
  let out = "", inStr = false, esc = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      out += c
      if (esc) esc = false
      else if (c === "\\") esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') { inStr = true; out += c; continue }
    if (c === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; continue }
    if (c === "/" && text[i + 1] === "*") { i += 2; while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++; i++; continue }
    out += c
  }
  let res = ""
  inStr = false; esc = false
  for (let i = 0; i < out.length; i++) {
    const c = out[i]
    if (inStr) {
      res += c
      if (esc) esc = false
      else if (c === "\\") esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') { inStr = true; res += c; continue }
    if (c === ",") {
      let j = i + 1
      while (j < out.length && /\s/.test(out[j])) j++
      if (out[j] === "]" || out[j] === "}") continue
    }
    res += c
  }
  return res
}

async function readJsonc(p) {
  try { return JSON.parse(stripJsonc(await fs.readFile(p, "utf8"))) } catch { return null }
}

// Minimal glob -> RegExp: ** spans path separators, * does not.
function globToRegExp(glob) {
  let re = ""
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === "*") {
      if (glob[i + 1] === "*") { re += ".*"; i++ } else { re += "[^/]*" }
    } else if ("\\^$+?.()|[]{}".includes(c)) {
      re += "\\" + c
    } else {
      re += c
    }
  }
  return new RegExp("^" + re + "$")
}

// First H1 / heading line of a markdown file, for the lazy listing.
function firstHeading(text) {
  for (const line of text.split("\n")) {
    const s = line.trim()
    if (s.startsWith("#")) return s.replace(/^#+\s*/, "").trim()
  }
  return ""
}

// Read only the head of a file (enough to find an H1) instead of the whole thing —
// bounds per-file cost when listing a large docs/ tree.
async function readHeadSlice(p, max = HEADING_SLICE_BYTES) {
  let fh
  try {
    fh = await fs.open(p, "r")
    const buf = Buffer.alloc(max)
    const { bytesRead } = await fh.read(buf, 0, max, 0)
    return buf.subarray(0, bytesRead).toString("utf8")
  } catch {
    return ""
  } finally {
    if (fh) await fh.close().catch(() => {})
  }
}

function kb(bytes) { return (bytes / 1024).toFixed(0) }

function repoRoot(ctx) {
  return ctx?.worktree || ctx?.directory || process.cwd()
}

// ---- model self-awareness (best-effort) --------------------------------------
// Surface the model the session is actually using so the agent reasons within its
// real limits (awesome-opencode "Model Announcer"). Sources, first hit wins: an
// assistant message's info.providerID/modelID in the outgoing transcript — the same
// fields the learn plugin reads — then $GENESEED_MODEL ("provider/model"). Unknown ->
// no line (graceful: the first turn often has no assistant message yet). It is added
// per request, OUTSIDE the cached block, so one cache serves every model.
function modelFromMessages(messages) {
  if (!Array.isArray(messages)) return null
  let found = null
  for (const m of messages) {
    const info = m?.info ?? {}
    if (info.role !== "assistant") continue
    const providerID = info.providerID ?? info.provider
    const modelID = info.modelID ?? info.model
    if (providerID && modelID) found = `${providerID}/${modelID}`   // last wins (latest turn)
  }
  return found
}
function envModelStr() {
  const v = process.env.GENESEED_MODEL
  return v && v.includes("/") ? v : null
}
// Insert the model line just after the MARKER (first line) of an already-rendered
// block, leaving the model-agnostic cache untouched.
function withModel(text, model) {
  if (!model || !text) return text
  const nl = text.indexOf("\n")
  if (nl === -1) return text
  const line = `current model: ${model} — reason within this model's real limits`
  return `${text.slice(0, nl + 1)}${line}\n${text.slice(nl + 1)}`
}

// ---- command discovery -------------------------------------------------------
// List the project's runnable command targets (awesome-opencode "Command Inject")
// so the agent invokes the repo's real entry points instead of guessing — Makefile
// targets, package.json scripts (with the right runner per lockfile), justfile
// recipes, Taskfile tasks. Root-level only, best-effort parse, capped. Each group is
// one rendered line: "make — build, test, lint".
const COMMANDS_CAP = 40
async function discoverCommands(root) {
  const groups = []
  const readSafe = async (p) => { try { return await fs.readFile(p, "utf8") } catch { return null } }

  for (const name of ["Makefile", "makefile", "GNUmakefile"]) {
    const text = await readSafe(path.join(root, name))
    if (text == null) continue
    const targets = []
    for (const line of text.split("\n")) {
      const m = /^([a-zA-Z0-9][\w.-]*)\s*:(?!=)/.exec(line)   // target: (not := assignment)
      if (m && !m[1].startsWith(".") && !line.includes("%") && !targets.includes(m[1])) targets.push(m[1])
      if (targets.length >= COMMANDS_CAP) break
    }
    if (targets.length) groups.push(`make — ${targets.join(", ")}`)
    break
  }

  const pkgText = await readSafe(path.join(root, "package.json"))
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText)
      const scripts = pkg && typeof pkg.scripts === "object" ? Object.keys(pkg.scripts) : []
      if (scripts.length) {
        let mgr = "npm run"
        if (await isFile(path.join(root, "bun.lockb"))) mgr = "bun run"
        else if (await isFile(path.join(root, "pnpm-lock.yaml"))) mgr = "pnpm"
        else if (await isFile(path.join(root, "yarn.lock"))) mgr = "yarn"
        groups.push(`${mgr} — ${scripts.slice(0, COMMANDS_CAP).join(", ")}`)
      }
    } catch {}
  }

  for (const name of ["justfile", "Justfile", ".justfile"]) {
    const text = await readSafe(path.join(root, name))
    if (text == null) continue
    const recipes = []
    for (const line of text.split("\n")) {
      const m = /^([a-zA-Z0-9][\w-]*)(?:[ \t][^\n:]*)?:(?!=)/.exec(line)   // recipe name [args]:
      if (m && !recipes.includes(m[1])) recipes.push(m[1])
      if (recipes.length >= COMMANDS_CAP) break
    }
    if (recipes.length) groups.push(`just — ${recipes.join(", ")}`)
    break
  }

  for (const name of ["Taskfile.yml", "Taskfile.yaml"]) {
    const text = await readSafe(path.join(root, name))
    if (text == null) continue
    const tasks = []
    let inTasks = false
    for (const line of text.split("\n")) {
      if (/^tasks:\s*$/.test(line)) { inTasks = true; continue }
      if (inTasks) {
        if (/^\S/.test(line)) break                            // dedented to a new top-level key
        const m = /^\s{2}([a-zA-Z0-9][\w:.-]*):/.exec(line)    // two-space-indented task key
        if (m && !tasks.includes(m[1])) tasks.push(m[1])
      }
      if (tasks.length >= COMMANDS_CAP) break
    }
    if (tasks.length) groups.push(`task — ${tasks.join(", ")}`)
    break
  }

  return groups
}

// ---- discovery ---------------------------------------------------------------
async function walkMd(dir, root, depth, acc) {
  if (depth > MAX_DEPTH || acc.length >= MAX_FILES_SCANNED) return
  let entries
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (acc.length >= MAX_FILES_SCANNED) return
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue
      await walkMd(full, root, depth + 1, acc)
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
      acc.push(full)
    }
  }
}

// Targeted convention discovery — never walks the whole tree (skips node_modules
// etc.). Returns { eager:[{rel,abs}], lazy:[{rel,abs}] }, deduped, eager wins.
async function discover(root) {
  const eager = new Map()   // abs -> {rel, abs}
  const lazy = new Map()
  const add = (map, abs) => {
    const rel = path.relative(root, abs).split(path.sep).join("/")
    map.set(abs, { rel, abs })
  }

  // 1. Root-level files.
  let rootEntries
  try { rootEntries = await fs.readdir(root, { withFileTypes: true }) } catch { rootEntries = [] }
  for (const e of rootEntries) {
    if (!e.isFile()) continue
    const abs = path.join(root, e.name)
    if (EAGER_ROOT.has(e.name)) add(eager, abs)
    else if (e.name.toLowerCase().endsWith(".md")) add(lazy, abs)   // misc root .md
  }

  // 2. Doc trees (recursive) -> lazy.
  for (const d of LAZY_DIRS) {
    const dir = path.join(root, d)
    if (await isDir(dir)) {
      const acc = []
      await walkMd(dir, root, 1, acc)
      for (const abs of acc) if (!eager.has(abs)) add(lazy, abs)
    }
  }

  // 3. Monorepo package entry docs -> lazy.
  for (const group of ["packages", "apps"]) {
    const base = path.join(root, group)
    if (!(await isDir(base))) continue
    let pkgs
    try { pkgs = await fs.readdir(base, { withFileTypes: true }) } catch { continue }
    for (const p of pkgs) {
      if (!p.isDirectory() || EXCLUDE_DIRS.has(p.name)) continue
      const readme = path.join(base, p.name, "README.md")
      if (await isFile(readme) && !eager.has(readme)) add(lazy, readme)
    }
  }

  const sortByRel = (a, b) => a.rel.localeCompare(b.rel)
  return {
    eager: [...eager.values()].sort(sortByRel),
    lazy: [...lazy.values()].filter((x) => !eager.has(x.abs)).sort(sortByRel),
  }
}

// ---- declarative manifest (override / extend) --------------------------------
// Returns { eager, lazy } from a manifest. Each entry: { path, load, description }
// where load is eager | lazy | exclude and path may be absolute, repo-relative, or
// a glob (a glob only reclassifies files already discovered). With "extend": true,
// auto-discovery runs first and entries add to / override / exclude its results;
// otherwise the manifest is the complete list (legacy semantics).
async function fromManifest(manifestFile, root) {
  const data = await readJson(manifestFile)
  const entries = Array.isArray(data?.context) ? data.context : []
  const recs = new Map()   // abs -> { rel, abs, load, desc }

  const put = (abs, load, desc) => {
    const rel = path.relative(root, abs).split(path.sep).join("/")
    const prev = recs.get(abs)
    recs.set(abs, { rel, abs, load, desc: desc || prev?.desc || "" })
  }

  if (data?.extend) {
    const d = await discover(root)
    for (const x of d.eager) put(x.abs, "eager", "")
    for (const x of d.lazy) put(x.abs, "lazy", "")
  }

  for (const entry of entries) {
    const raw = entry?.path ?? ""
    const load = entry?.load ?? "eager"
    const desc = entry?.description ?? ""
    if (!raw) continue
    if (raw.includes("*")) {
      const re = globToRegExp(raw)
      for (const [abs, x] of recs) if (re.test(x.rel)) put(abs, load, desc)
      continue   // a glob reclassifies discovered files; it does not add new ones
    }
    // Relative entry paths resolve against the REPO ROOT (matches the context.json
    // stub's documented "relative to the repo root" — important when the manifest
    // lives in .harness/, whose dir is not the root).
    const abs = path.isAbsolute(raw) ? raw : path.resolve(root, raw)
    put(abs, load, desc)
  }

  const eager = [], lazy = []
  for (const x of recs.values()) {
    if (x.load === "exclude") continue
    ;(x.load === "lazy" ? lazy : eager).push(x)
  }
  const byRel = (a, b) => a.rel.localeCompare(b.rel)
  return { eager: eager.sort(byRel), lazy: lazy.sort(byRel) }
}

async function resolveSource(root) {
  const explicit = process.env.GENESEED_CONTEXT
  if (explicit && (await isFile(explicit))) return { mode: "manifest", file: explicit }
  for (const rel of [path.join(".harness", "context.json"), "context.json"]) {
    const p = path.join(root, rel)
    if (await isFile(p)) return { mode: "manifest", file: p }
  }
  return { mode: "discover" }
}

// ---- machine wiki (wiki.jsonc) --------------------------------------------------
// The user's own knowledge base(s) — typically an Obsidian vault — declared once per
// machine, not per repo (AGENT.md §7). Same injection mechanics as project context,
// different scope. Resolution (first match wins, mirroring the learn plugin):
//   1. $GENESEED_WIKI                      explicit manifest path
//   2. $GENESEED_HARNESS/wiki.jsonc         pinned install dir
//   3. <plugin dir>/../wiki.jsonc           auto-locate: beside the installed AGENT.md
async function resolveWikiFile() {
  const explicit = process.env.GENESEED_WIKI
  if (explicit && (await isFile(explicit))) return explicit
  const bases = []
  if (process.env.GENESEED_HARNESS) bases.push(process.env.GENESEED_HARNESS)
  bases.push(path.resolve(PLUGIN_DIR, ".."))
  for (const base of bases) {
    // wiki.json is the legacy name from earlier seeds — still honoured.
    for (const name of ["wiki.jsonc", "wiki.json"]) {
      const p = path.join(base, name)
      if (await isFile(p)) return p
    }
  }
  return null
}

// Walk a vault folder for .md notes — like the project walk, but dot-folders are
// skipped too (.obsidian, .trash — a vault keeps its config and trash inside).
// Shares the global MAX_DEPTH / MAX_FILES_SCANNED bounds.
async function walkWikiDir(dir, depth, acc) {
  if (depth > MAX_DEPTH || acc.length >= MAX_FILES_SCANNED) return
  let entries
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (acc.length >= MAX_FILES_SCANNED) return
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name) || e.name.startsWith(".")) continue
      await walkWikiDir(full, depth + 1, acc)
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
      acc.push(full)
    }
  }
}

// How many lazy notes one wiki may LIST per session — a `.` (whole-vault) folder
// entry on a large vault would otherwise inject thousands of listing lines. Beyond
// the cap the listing truncates with a visible count and the agent explores the
// folders on demand instead.
const WIKI_LAZY_LIMIT = Number(process.env.GENESEED_WIKI_LAZY_LIMIT || 200)

// Parse wiki.jsonc into renderable wikis: [{ name, root, desc, conventions, inbox,
// protected, eager:[{rel,abs,desc}], lazy:[...], truncated }]. Entry paths resolve
// against the wiki's own root and may name a single note OR a folder — a folder
// applies its load mode to every note beneath it (`.` covers the whole vault).
// Folders are processed first so a specific file entry always overrides the mode
// its folder gave it, regardless of manifest order; within each class, later
// entries win; `load: "exclude"` prunes. A missing root skips that wiki (never
// blocks the session).
async function wikiSets() {
  const file = await resolveWikiFile()
  if (!file) return []
  const data = await readJsonc(file)   // wiki.jsonc is JSONC: stub ships commented
  const wikis = Array.isArray(data?.wikis) ? data.wikis : []
  const out = []
  for (const w of wikis) {
    if (!w?.path) continue
    if (!(await isDir(w.path))) { log(`wiki '${w.name ?? w.path}': root not found, skipped`); continue }
    const name = w.name || path.basename(w.path)

    const recs = new Map()   // abs -> { rel, abs, load, desc }
    const put = (abs, load, desc) => {
      let rel = path.relative(w.path, abs).split(path.sep).join("/")
      if (rel.startsWith("..")) rel = abs.split(path.sep).join("/")   // outside the root
      const prev = recs.get(abs)
      recs.set(abs, { rel: `${name}/${rel}`, abs, load, desc: desc || prev?.desc || "" })
    }

    const resolved = []
    for (const e of Array.isArray(w.entries) ? w.entries : []) {
      if (!e?.path) continue
      const abs = path.isAbsolute(e.path) ? e.path : path.resolve(w.path, e.path)
      const load = e.load === "lazy" || e.load === "exclude" ? e.load : "eager"
      resolved.push({ abs, load, desc: e.description || "", dir: await isDir(abs) })
    }
    for (const folderPhase of [true, false]) {   // folders first, then files
      for (const e of resolved) {
        if (e.dir !== folderPhase) continue
        if (e.dir) {
          const acc = []
          await walkWikiDir(e.abs, 1, acc)
          for (const f of acc) e.load === "exclude" ? recs.delete(f) : put(f, e.load, "")
        } else {
          e.load === "exclude" ? recs.delete(e.abs) : put(e.abs, e.load, e.desc)
        }
      }
    }

    const byRel = (a, b) => a.rel.localeCompare(b.rel)
    const eager = [], lazy = []
    for (const r of recs.values()) (r.load === "lazy" ? lazy : eager).push(r)
    eager.sort(byRel)
    lazy.sort(byRel)
    let truncated = 0
    if (lazy.length > WIKI_LAZY_LIMIT) {
      truncated = lazy.length - WIKI_LAZY_LIMIT
      lazy.length = WIKI_LAZY_LIMIT
      log(`wiki '${name}': lazy listing truncated (${truncated} beyond the ${WIKI_LAZY_LIMIT} cap)`)
    }
    out.push({
      name, root: w.path, desc: w.description || "",
      conventions: w.conventions || "", inbox: w.inbox || "",
      protected: Array.isArray(w.protected) ? w.protected : [],
      eager, lazy, truncated,
    })
  }
  return out
}

// ---- injection block ---------------------------------------------------------
// Render one eager+lazy set into `out`. The budget state (eager bytes, heading
// reads) is SHARED across segments — project context and every wiki draw from the
// same caps, so the whole block stays bounded no matter how many wikis are declared.
async function renderSet(out, { eager, lazy }, state) {
  const perFile = EAGER_FILE_KB * 1024
  const total = EAGER_TOTAL_KB * 1024
  const demoted = []

  for (const e of eager) {
    let text
    try { text = await fs.readFile(e.abs, "utf8") } catch (err) {
      out.push(`----- ${e.rel}${e.desc ? ` — ${e.desc}` : ""} -----`)
      out.push(`[context] MISSING eager file: ${err?.message ?? err}`, "")
      continue
    }
    const size = Buffer.byteLength(text, "utf8")
    if (size > perFile) {
      demoted.push(`[demoted: ${e.rel} exceeded ${EAGER_FILE_KB} KB — read on demand]`)
      log(`demoted ${e.rel} -> lazy (${kb(size)} KB > ${EAGER_FILE_KB} KB cap)`)
      continue
    }
    if (state.spent + size > total) {
      demoted.push(`[demoted: ${e.rel} — eager budget (${EAGER_TOTAL_KB} KB) reached]`)
      continue
    }
    out.push(`----- ${e.rel}${e.desc ? ` — ${e.desc}` : ""} -----`)
    out.push(text.replace(/\n+$/, ""), "")
    state.spent += size
    state.injected++
  }

  const lazyLines = []
  for (const l of lazy) {
    let head = l.desc
    // Only crack open files we have no description for, and cap how many — bounded by
    // a head-slice read so a big docs/ tree stays cheap on every session start.
    if (!head && state.headingsRead < LAZY_HEADING_LIMIT) {
      head = firstHeading(await readHeadSlice(l.abs))
      state.headingsRead++
    }
    lazyLines.push(`  - ${l.rel}${head ? ` — ${head}` : ""}`)
  }
  if (lazyLines.length || demoted.length) {
    out.push("--- Lazy entries (load only when the task needs them) ---")
    out.push(...lazyLines)
    if (demoted.length) out.push(...demoted.map((d) => `  ${d}`))
    out.push("")
  }
  state.lazy += lazyLines.length
}

async function buildBlock(sets, wikis = [], commands = []) {
  const state = { spent: 0, injected: 0, lazy: 0, headingsRead: 0 }

  const proj = []
  await renderSet(proj, sets, state)

  if (commands.length) {
    proj.push("--- Project commands (runnable targets discovered in the repo root) ---")
    for (const g of commands) proj.push(`  ${g}`)
    proj.push("")
  }

  const wik = []
  for (const w of wikis) {
    wik.push(`--- wiki: ${w.name}${w.desc ? ` — ${w.desc}` : ""} (root: ${w.root}) ---`)
    if (w.conventions) wik.push(`  conventions: ${w.conventions} (read before your first write there)`)
    if (w.inbox) wik.push(`  inbox: ${w.inbox} (drop notes you cannot confidently file)`)
    if (w.protected.length) wik.push(`  protected (never write): ${w.protected.join(", ")}`)
    wik.push("")
    await renderSet(wik, { eager: w.eager, lazy: w.lazy }, state)
    if (w.truncated) wik.push(`  [+${w.truncated} more notes in this wiki — explore its folders on demand]`, "")
  }

  if (!proj.length && !wik.length) return null
  const out = [MARKER]
  if (proj.length) out.push("=== PROJECT CONTEXT — binding for this repo per Law XVIII ===", "", ...proj)
  if (wik.length) out.push("=== MACHINE WIKI — the user's knowledge base, binding per AGENT.md §7 ===", "", ...wik)
  return { text: out.join("\n"), injected: state.injected, lazy: state.lazy, kb: kb(state.spent) }
}

// Resolve the eager/lazy sets (manifest or auto-discovery) plus the machine wikis,
// and render the injection block — shared by the session.created injection and the
// compaction hook (the transform path reuses it via cachedBlockText).
async function resolveBlock(root) {
  const src = await resolveSource(root)
  const sets = src.mode === "manifest"
    ? await fromManifest(src.file, root)
    : await discover(root)
  const wikis = await wikiSets()
  const commands = await discoverCommands(root)
  return { block: await buildBlock(sets, wikis, commands), src }
}

// Per-process cache of the rendered block text for the transform path (root is fixed
// per plugin instance). Recomputed at most once per TTL so doc edits are picked up.
let _blockCache = { text: null, at: 0 }
const BLOCK_TTL_MS = 30000
async function cachedBlockText(root) {
  const now = Date.now()
  if (_blockCache.text !== null && now - _blockCache.at < BLOCK_TTL_MS) return _blockCache.text
  let text = ""
  try { const { block } = await resolveBlock(root); text = block?.text || "" } catch {}
  _blockCache = { text, at: now }
  return text
}

// ---- cross-instance idempotency ----------------------------------------------
async function alreadyInjected(client, sid) {
  try {
    const msgs = await client.session.messages({ path: { id: sid } })
    const arr = Array.isArray(msgs) ? msgs : (msgs?.data ?? [])
    for (const m of arr) {
      const parts = m?.parts ?? m?.info?.parts ?? []
      for (const p of parts) {
        if (typeof p?.text === "string" && p.text.includes(MARKER)) return true
      }
    }
  } catch {}
  return false
}

export const GeneseedContext = async (ctx) => {
  const { client } = ctx
  const done = new Set()
  const root = repoRoot(ctx)

  // Visible delivery — post the block as a noReply session message. Used when
  // GENESEED_CONTEXT_VISIBLE forces it, and by the transform fallback below.
  async function injectVisible(sid) {
    if (!sid || done.has(sid)) return
    try {
      // Don't pollute the learn plugin's throwaway distil sessions, and don't
      // re-inject into native subagent child sessions (they inherit the parent's
      // context). The sid is only marked done AFTER the guards pass — marking it
      // earlier would permanently skip a session when a transient session.get
      // failure let it through the title check.
      let title = "", parent
      try {
        const info = await client.session.get({ path: { id: sid } })
        const meta = info?.data ?? info
        title = meta?.title ?? ""
        parent = meta?.parentID ?? meta?.parentId
      } catch {}
      if (parent) { log("skipped: child/subagent session"); return }
      if (title.startsWith("geneseed-")) { log("skipped: geneseed-* session"); return }

      if (await alreadyInjected(client, sid)) { log("skipped: already injected (marker present)"); return }
      done.add(sid)

      const { block, src } = await resolveBlock(root)
      if (!block) { log(`no docs discovered in ${root}`); return }

      // Best-effort model line: read the session transcript, else $GENESEED_MODEL.
      let model = null
      try {
        const msgs = await client.session.messages({ path: { id: sid } })
        model = modelFromMessages(Array.isArray(msgs) ? msgs : (msgs?.data ?? []))
      } catch {}
      const text = withModel(block.text, model || envModelStr())

      await client.session.prompt({
        path: { id: sid },
        body: { noReply: true, parts: [{ type: "text", text }] },
      })
      const via = src.mode === "manifest" ? `manifest ${src.file}` : `auto-discovery [${root}]`
      log(`injected: ${block.injected} eager (${block.kb} KB), ${block.lazy} lazy listed — via ${via}`)
    } catch (err) {
      log(`error: ${err?.message ?? err}`)
    }
  }

  // Session-scope filter for the INVISIBLE delivery, mirroring injectVisible's
  // guards: child/subagent sessions inherit the parent's context, and geneseed-*
  // sessions (learn distils, geneseed-wf:* children) must stay clean — without this
  // the transform prepends the full context block to every request of every session
  // in-process. Cached per sid (the transform runs on EVERY request); a transient
  // session.get failure is NOT cached so the next request re-checks.
  const sessionSkip = new Map()
  async function skipSession(sid) {
    if (!sid) return false
    const hit = sessionSkip.get(sid)
    if (hit !== undefined) return hit
    try {
      const info = await client.session.get({ path: { id: sid } })
      const meta = info?.data ?? info
      const skip = Boolean(meta?.parentID ?? meta?.parentId) ||
        String(meta?.title ?? "").startsWith("geneseed-")
      sessionSkip.set(sid, skip)
      return skip
    } catch {
      return false
    }
  }

  return {
    event: async ({ event }) => {
      if (!event || INJECT_OFF) return
      const sid =
        event.properties?.sessionID ?? event.payload?.sessionID ??
        event.properties?.info?.id ?? event.payload?.info?.id
      if (event.type === "session.created") {
        if (TRANSFORM && !fallbackVisible) return   // invisible delivery handles it
        await injectVisible(sid)
        return
      }
      // Transform fallback: the session went idle (a request completed) yet the
      // experimental hook never fired in this process — this build lacks it. Engage
      // the visible delivery so context still arrives, injecting into THIS session
      // right away (one turn late) rather than waiting for the next session.
      if (event.type === "session.idle" && TRANSFORM && !transformSeen && !fallbackVisible) {
        fallbackVisible = true
        log("transform hook absent on this build — falling back to visible injection")
        await injectVisible(sid)
      }
    },

    // Survive compaction. The visible injection above is a conversation message, so
    // OpenCode summarises it away when a long session compacts (the AGENT.md rules
    // persist — they load via opencode.json `instructions`, not the conversation).
    // Re-push the eager docs into the compaction context so the project context —
    // Law XVIII — outlives the summary. Only needed when delivery is visible
    // (forced or fallback); the transform re-sends per request. Experimental
    // OpenCode hook; if it is absent in a build this key is simply never called.
    "experimental.session.compacting": async (_input, output) => {
      if (INJECT_OFF || (TRANSFORM && !fallbackVisible)) return
      try {
        const { block } = await resolveBlock(root)
        if (block && output && Array.isArray(output.context)) {
          output.context.push(block.text)
          log(`compaction: re-pushed ${block.injected} eager doc(s)`)
        }
      } catch (err) {
        log(`compaction error: ${err?.message ?? err}`)
      }
    },

    // Invisible delivery (the default). Prepend the context to each request's
    // outgoing message array — no persisted/visible session message, and it survives
    // compaction because it is re-sent every request. Experimental OpenCode hook;
    // never called on a build that lacks it — the session.idle fallback above
    // detects that and takes over with the visible delivery.
    "experimental.chat.messages.transform": async (_input, output) => {
      transformSeen = true                  // the hook exists on this build
      if (INJECT_OFF || !TRANSFORM || fallbackVisible) return
      try {
        if (!output || !Array.isArray(output.messages) || !output.messages.length) return
        const sid = output.messages[0]?.info?.sessionID
        if (await skipSession(sid)) return
        // Already present this request? (idempotent across plugin copies / retries.)
        const present = output.messages.some((m) =>
          (m?.parts ?? []).some((p) => typeof p?.text === "string" && p.text.includes(MARKER)))
        if (present) return
        const cached = await cachedBlockText(root)
        if (!cached) return
        // Model line is request-specific (kept out of the cache): prefer the live
        // transcript on this request, fall back to $GENESEED_MODEL.
        const text = withModel(cached, modelFromMessages(output.messages) || envModelStr())
        const stamp = Date.now()
        output.messages.unshift({
          info: { id: `geneseed-context-${stamp}`, role: "user", sessionID: sid, time: { created: stamp } },
          parts: [{ id: `geneseed-context-part-${stamp}`, type: "text", text }],
        })
        log("transform: injected context invisibly")
      } catch (err) {
        log(`transform error: ${err?.message ?? err}`)
      }
    },
  }
}

export default GeneseedContext
