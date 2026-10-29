// Geneseed — OpenCode project-context plugin (v2, convention-glob).
//
// Enforces the project-context rule ("Load the Project Context") by INJECTION, not instruction:
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
// mirrors the harness's own `context` verb. Every error is swallowed — it never blocks
// a session. See adapters/opencode/GLOBAL-HARNESS-SPEC.md.
//
// The block also carries two best-effort self-orientation lines:
//   - COMMANDS: the repo's runnable targets (Makefile / package.json scripts /
//     justfile / Taskfile), so the agent invokes real entry points, not guesses.
//   - MODEL: the model the session is using (read from the transcript, else
//     $GENESEED_MODEL), so the agent reasons within its real limits. The model line
//     is added per request, outside the cached block; unknown -> omitted.
//
// MACHINE WIKI (AGENT.md §8): the same block also carries the user's own knowledge
// base(s) — typically an Obsidian vault — declared once per machine in `geneseed-wiki.jsonc`
// ($GENESEED_WIKI -> $GENESEED_HARNESS/geneseed-wiki.jsonc -> beside this plugin's install).
// Each wiki's eager entries inject in full and lazy entries list, drawing on the
// SAME budgets as the project context; its conventions/inbox/protected metadata is
// surfaced so the agent knows the house rules before writing. No wiki manifest, or an
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

import { promises as fs, realpathSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"
import { createHash } from "node:crypto"

const MARKER = "<!-- geneseed-context:v2 -->"
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))

// Sovereign-repo bypass — twin of the harness's own `sovereignBypass()`.
// <cfg>/excludes.json (user-owned, managed by `harness exclude`) lists folders where
// this GLOBAL install goes dormant. Any error degrades to "not excluded".
// Twin of js/hosts/hosts.mjs `resolvePath`: the absolute path with symlinks and junctions
// followed, the way the Claude/Bob hook resolves one. `norm` folds its case for matching.
function resolvePath(p) {
  // Expand a leading "~" / "~/…" to the home dir — a hand-edited excludes.json entry
  // like "~/vault" must resolve the same way here as it does for the Claude/Bob
  // hook guard.
  let raw = String(p)
  if (raw === "~" || raw.startsWith("~/") || raw.startsWith("~\\")) {
    raw = raw === "~" ? homedir() : path.join(homedir(), raw.slice(2))
  }
  let s = path.resolve(raw)
  // Symlinks and junctions followed through the deepest existing ancestor (the rest appended),
  // the rule js/hosts/hosts.mjs resolvePath applies: an exclude spelled through a link matches
  // on every host, not only on Claude/Bob.
  for (let cur = s, tail = []; ;) {
    try { s = path.join(realpathSync.native(cur), ...tail); break } catch { /* walk up */ }
    const up = path.dirname(cur)
    if (up === cur) break
    tail.unshift(path.basename(cur))
    cur = up
  }
  return s
}
const norm = (p) => {
  const s = resolvePath(p)
  return process.platform === "win32" ? s.toLowerCase() : s
}
// A linked git worktree of an excluded repo is excluded too, wherever it sits on disk — twin of
// js/hosts/gitref.mjs `mainWorktreeOf`: the worktree's `.git` FILE names its gitdir, whose
// `commondir` names the shared `.git`; that directory's parent is the main worktree. null for
// a main worktree, a submodule, a bare repo's worktree, or anything malformed.
async function mainWorktreeOf(dir) {
  try {
    let root = path.resolve(dir)
    for (;;) {
      try { await fs.stat(path.join(root, ".git")); break } catch { /* walk up */ }
      const up = path.dirname(root)
      if (up === root) return null
      root = up
    }
    const dotgit = path.join(root, ".git")
    if (!(await fs.stat(dotgit)).isFile()) return null
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(await fs.readFile(dotgit, "utf8"))
    if (!m) return null
    const gitdir = path.resolve(root, m[1])
    const common = path.resolve(gitdir, (await fs.readFile(path.join(gitdir, "commondir"), "utf8")).trim())
    return path.basename(common) === ".git" ? path.dirname(common) : null
  } catch { return null }
}
async function sovereignBypass(cwd) {
  try {
    const cfg = path.dirname(PLUGIN_DIR)           // plugins/ sits directly in <cfg>
    const raw = await fs.readFile(path.join(cfg, "excludes.json"), "utf8")
    const entries = (JSON.parse(raw).excludes) || []
    const here = norm(cwd || process.cwd())
    const main = await mainWorktreeOf(cwd || process.cwd())
    const heres = main ? [here, norm(main)] : [here]
    for (const e of entries) {
      const p = typeof e === "string" ? e : e && e.path
      if (typeof p !== "string" || !p.trim()) continue
      const base = norm(p.trim()).replace(/[\\/]+$/, "")
      if (heres.some((h) => h === base || h.startsWith(base + path.sep))) return true
    }
  } catch { /* degrade to active */ }
  return false
}

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
// Same threshold as the Claude hook's LAZY_FOLD_AT.
const LAZY_FOLD_AT = 3
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
// Root-level files injected in full. Canonical entry docs + agent-directed rules OpenCode
// does not read by itself. AGENT.md (opencode.json `instructions`), AGENTS.md and CLAUDE.md
// (OpenCode's own native roots) are deliberately absent: OpenCode already has them, and
// injecting them again re-sent the whole harness on every request until 2026-09.
const EAGER_ROOT = new Set([
  ".cursorrules", "README.md", "README.adoc", "CONTRIBUTING.md", "CONTRIBUTING.adoc",
  "user-rules.md", "PROFILE.md",
])
// Project docs are Markdown or AsciiDoc (document-project writes AsciiDoc when the user asks
// for it). Same set as js/hosts/hooks-context.mjs DOC_EXT.
const isDoc = (name) => /\.(md|adoc)$/i.test(name)
// Doc trees walked recursively; everything found is lazy (listed, not injected).
const LAZY_DIRS = ["docs", "doc", "documentation", "architecture", "adr", "ADR"]
// Never descend into these.
const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "vendor", ".next", "target",
  ".venv", "__pycache__", ".opencode", ".harness",
])

async function isFile(p) {
  try { return (await fs.stat(p)).isFile() } catch { return false }
}
async function isDir(p) {
  try { return (await fs.stat(p)).isDirectory() } catch { return false }
}

// ---- session files (the harness's own) --------------------------------------
// The files AGENT.md names for session start, relative to the HARNESS dir — the dir that
// holds the installed AGENT.md: the repo root for a project install, the config dir for a
// global one. Same list and seed hashes as SESSION_FILES/SEED_SHA256 in js/hosts/hooks.mjs;
// tests/unit/claude.test.mjs gates both copies against SESSION_SEEDS in js/build/stubs.mjs.
// context.json is not here: it is a manifest, honoured by resolveSource. geneseed-wiki.jsonc
// is not here either: the MACHINE WIKI block below already renders it in full.
const SESSION_FILES = ["user-rules.md", "PROFILE.md", "memory/MEMORY.md", "anamnesis/MEMORY.md",
  "notebook/NOTEBOOK.md"]
const SEED_SHA256 = new Set([
  "5c2e92fb1acde041e02d9ebf158460d8ff7a07cbc2b447859631604610130721", // user-rules.md
  "29e012c3c4349ea62a9082cbd04bb25599a0ec280d62c33f6e10742809471816", // PROFILE.md
  "3a82c78ccc5d745033c16c354f5eda9d79350c704e9da8d605d380fb1e108d7a", // geneseed-wiki.jsonc
  // The wiki seed before the rename: the build renames an untouched one byte for byte.
  "cccc917c34e6b990e821620bdb4739090151885ab71b6e85046f30a3b71fa5e8", // wiki.jsonc (legacy)
  "99c786049c260f6baf7aec68a5c0f59907861afe9b867da009440613bdddb907", // MEMORY.md
  "9acb5c9d9cb5dac572104480f05b48cc144e676869bd60e86d8a15b1f6308184", // NOTEBOOK.md
])

// $GENESEED_HARNESS when set, else the first of <plugin dir>/.. (global: the config dir) and
// <plugin dir>/../.. (project: .opencode/plugins -> the repo root) that holds AGENT.md.
async function harnessDir() {
  if (process.env.GENESEED_HARNESS && (await isDir(process.env.GENESEED_HARNESS))) {
    return process.env.GENESEED_HARNESS
  }
  for (const d of [path.resolve(PLUGIN_DIR, ".."), path.resolve(PLUGIN_DIR, "..", "..")]) {
    if (await isFile(path.join(d, "AGENT.md"))) return d
  }
  return null
}

// Session files present under the harness dir and changed from their seed: [{ rel, abs, text }].
async function sessionFiles(dir) {
  const found = []
  if (!dir) return found
  for (const rel of SESSION_FILES) {
    const abs = path.join(dir, rel)
    let text
    try { text = (await fs.readFile(abs, "utf8")).replace(/\r\n/g, "\n") } catch { continue }
    if (SEED_SHA256.has(createHash("sha256").update(text).digest("hex"))) continue
    text = text.replace(/\n+$/, "")
    const nudge = rel.endsWith("MEMORY.md") ? memoryNudge(text) : ""
    found.push({ rel, abs, text: nudge ? `${text}\n${nudge}` : text })
  }
  return found
}

// The memory map's curation nudge: same rule, threshold and text as memoryNudge in
// js/hosts/hooks-context.mjs (tests/unit/claude.test.mjs gates the copy). Read off the map's
// own counts; a large but curated store is never nagged.
const MAP_COUNT_RE = /^- \[([^\]]*)\]\(topics\/[^)]+\.md\) — (\d+) facts?$/
const CURATE_TOPIC_MAX = 40
const CURATE_NUDGE = "[memory] A topic holds over 40 facts, or facts sit in misc: offer the user "
  + "to dispatch the memory-curator agent to merge, re-topic and archive this store."
function memoryNudge(map) {
  for (const line of map.split("\n")) {
    const m = MAP_COUNT_RE.exec(line.trim())
    if (m && (m[1] === "misc" || Number(m[2]) > CURATE_TOPIC_MAX)) return CURATE_NUDGE
  }
  return ""
}

async function readJson(p) {
  try { return JSON.parse(await fs.readFile(p, "utf8")) } catch { return null }
}

// Strip JSONC niceties — // and /* */ comments plus trailing commas — string-aware,
// so a "https://…" or "C:/Users/…" inside quotes is untouched. the wiki manifest is
// seeded with a commented example, so its readers must tolerate comments.
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

// First heading line of a markdown or AsciiDoc file, for the lazy listing. An AsciiDoc
// title is "= Title"; the space is required so a setext "====" underline never matches.
function firstHeading(text) {
  for (const line of text.split("\n")) {
    const s = line.trim()
    if (s.startsWith("#")) return s.replace(/^#+\s*/, "").trim()
    if (/^=+\s/.test(s)) return s.replace(/^=+\s*/, "").trim()
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
    } else if (e.isFile() && isDoc(e.name)) {
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
    else if (isDoc(e.name) && e.name !== "user-rules-retired.md") add(lazy, abs)  // retired rules are never loaded   // misc root .md / .adoc
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
      for (const name of ["README.md", "README.adoc"]) {
        const readme = path.join(base, p.name, name)
        if (await isFile(readme) && !eager.has(readme)) add(lazy, readme)
      }
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

async function resolveSource(root, harness = null) {
  const explicit = process.env.GENESEED_CONTEXT
  if (explicit && (await isFile(explicit))) return { mode: "manifest", file: explicit }
  // The harness dir last: a repo's own manifest outranks the one seeded beside the install.
  const cands = [path.join(root, ".harness", "context.json"), path.join(root, "context.json")]
  if (harness) cands.push(path.join(harness, "context.json"))
  for (const p of cands) {
    if (await isFile(p)) return { mode: "manifest", file: p }
  }
  return { mode: "discover" }
}

// ---- machine wiki (geneseed-wiki.jsonc) ------------------------------------------
// The user's own knowledge base(s) — typically an Obsidian vault — declared once per
// machine, not per repo (AGENT.md §8). Same injection mechanics as project context,
// different scope. Resolution (first match wins, mirroring the learn plugin):
//   1. $GENESEED_WIKI                      explicit manifest path
//   2. $GENESEED_HARNESS/geneseed-wiki.jsonc pinned install dir
//   3. <plugin dir>/../geneseed-wiki.jsonc  auto-locate: beside the installed AGENT.md
async function resolveWikiFile() {
  const explicit = process.env.GENESEED_WIKI
  if (explicit && (await isFile(explicit))) return explicit
  // The harness dir (which honours $GENESEED_HARNESS) first: on a PROJECT install the plugin
  // sits in .opencode/plugins, so <plugin dir>/.. is .opencode, not the dir the seed landed in.
  // <plugin dir>/.. stays as the fallback for an install without an AGENT.md.
  const bases = []
  const harness = await harnessDir()
  if (harness) bases.push(harness)
  bases.push(path.resolve(PLUGIN_DIR, ".."))
  for (const base of bases) {
    // wiki.jsonc and wiki.json are the legacy names from earlier seeds — still honoured.
    for (const name of ["geneseed-wiki.jsonc", "wiki.jsonc", "wiki.json"]) {
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
const WIKI_LAZY_LIMIT = envNum("GENESEED_WIKI_LAZY_LIMIT", 200)

// Parse the wiki manifest into renderable wikis: [{ name, root, desc, conventions, inbox,
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
  const data = await readJsonc(file)   // the manifest is JSONC: stub ships commented
  const wikis = Array.isArray(data?.wikis) ? data.wikis : []
  const out = []
  for (const w of wikis) {
    if (!w?.path) continue
    if (!(await isDir(w.path))) { log(`wiki '${w.name ?? w.path}': root not found, skipped`); continue }
    const name = w.name || path.basename(w.path)

    const recs = new Map()   // abs -> { rel, abs, load, desc }
    const put = (abs, load, desc) => {
      const raw = path.relative(w.path, abs)
      // outside the root: "..", "../…" or another drive — not a name like "..cache"
      const outside = raw === ".." || raw.startsWith(".." + path.sep) || path.isAbsolute(raw)
      const rel = (outside ? abs : raw).split(path.sep).join("/")
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
async function renderSet(out, { eager, lazy }, state, { fold = false } = {}) {
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

  // The project listing folds like the Claude hook's (js/hosts/hooks-context.mjs): three or more
  // undescribed docs sharing a parent directory become one `dir/ — N docs` line — a docs/ tree
  // of 186 files was 186 lines on every session. Root files never fold. A wiki listing keeps its
  // per-note headings: a vault is navigated by them, and it carries its own cap.
  const byDir = new Map()
  if (fold) {
    for (const l of lazy) {
      const dir = path.posix.dirname(l.rel.replace(/\\/g, "/"))
      if (!l.desc && dir !== ".") byDir.set(dir, (byDir.get(dir) || 0) + 1)
    }
  }
  const folded = new Set()
  const lazyLines = []
  for (const l of lazy) {
    const dir = path.posix.dirname(l.rel.replace(/\\/g, "/"))
    if (!l.desc && byDir.get(dir) >= LAZY_FOLD_AT) {
      if (!folded.has(dir)) lazyLines.push(`  - ${dir}/ — ${byDir.get(dir)} docs`)
      folded.add(dir)
      continue
    }
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

async function buildBlock(sets, wikis = [], commands = [], session = [], done = null) {
  const state = { spent: 0, injected: 0, lazy: 0, headingsRead: 0 }

  // A session file discovery also found (user-rules.md at the root of a project install,
  // whose harness dir IS the repo root) is injected once, in the session block.
  const seen = new Set(session.map((s) => path.resolve(s.abs)))
  const fresh = (x) => !seen.has(path.resolve(x.abs))
  sets = { eager: sets.eager.filter(fresh), lazy: sets.lazy.filter(fresh) }
  const ses = []
  for (const s of session) {
    const size = Buffer.byteLength(s.text, "utf8")
    ses.push(`----- ${s.rel} -----`)
    if (size > EAGER_FILE_KB * 1024) {
      ses.push(`[demoted: ${s.rel} exceeded ${EAGER_FILE_KB} KB — read ${s.abs} on demand]`, "")
      continue
    }
    ses.push(s.text, "")
    state.spent += size
    state.injected++
  }

  // The done gate's line opens the project section, and keeps it (and the block) alive alone.
  const proj = done ? [done, ""] : []
  await renderSet(proj, sets, state, { fold: true })

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

  if (!ses.length && !proj.length && !wik.length) return null
  const out = [MARKER]
  if (ses.length) out.push("=== SESSION FILES — your harness files, injected at session start (untouched seeds skipped) ===", "", ...ses)
  if (proj.length) out.push("=== PROJECT CONTEXT — binding for this repo ===", "", ...proj)
  if (wik.length) out.push("=== MACHINE WIKI — the user's knowledge base, binding per AGENT.md §8 ===", "", ...wik)
  return { text: out.join("\n"), injected: state.injected, lazy: state.lazy, kb: kb(state.spent) }
}

// Resolve the eager/lazy sets (manifest or auto-discovery) plus the machine wikis,
// and render the injection block — shared by the session.created injection and the
// compaction hook (the transform path reuses it via cachedBlockText). `judged` false is
// OpenCode 2, which never judges a turn: its done line claims no verdict.
async function resolveBlock(root, judged = true) {
  const harness = await harnessDir()
  const src = await resolveSource(root, harness)
  const sets = src.mode === "manifest"
    ? await fromManifest(src.file, root)
    : await discover(root)
  const wikis = await wikiSets()
  const commands = await discoverCommands(root)
  const done = (await doneGateOff()) ? null : await doneLine(root, judged).catch(() => null)
  const owned = (await ownershipGateOff()) ? null : await ownershipLine(root).catch(() => null)
  const heads = [done, owned].filter(Boolean).join("\n") || null
  return { block: await buildBlock(sets, wikis, commands, await sessionFiles(harness), heads), src }
}

// Per-INSTANCE cache of the rendered block text for the transform path: the caller owns
// `cache`, one per plugin instance, because root is fixed per instance but one OpenCode
// process can serve several directories — a module-level cache served project A's
// context into B for a whole TTL. Recomputed at most once per TTL so doc edits are
// picked up.
const BLOCK_TTL_MS = 30000
async function cachedBlockText(root, cache) {
  const now = Date.now()
  if (cache.text !== null && now - cache.at < BLOCK_TTL_MS) return cache.text
  let text = ""
  try { const { block } = await resolveBlock(root, cache.judged ?? true); text = block?.text || "" } catch {}
  cache.text = text
  cache.at = now
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

// ---- The done gate (#289): the OpenCode twin of js/hosts/hooks-done.mjs ----------------
// OpenCode has no turn-end event a plugin can block on, so its ceiling is a reminder: on the
// request AFTER a turn that edited files without the project's declared checks passing
// (`.geneseed/done-checks.txt`), one invisible user message says which checks are owed. Only V1
// (`messages.transform`, whose tool parts carry `state.status` and the shell's
// `metadata.exit`); OpenCode 2's message shape for tool calls is unverified, so V2 is not
// judged and says so once. Fails open on every shape it does not recognise (ADR 0007).
// `runsUnpiped` is a hand-mirrored twin; tests/plugins/context_done.test.mjs runs both on one table.
const DONE_LIST = ".geneseed/done-checks.txt"
const DONE_EDIT_TOOLS = new Set(["edit", "write", "patch", "apply_patch", "multiedit"])
const DONE_SHELL_TOOLS = new Set(["bash", "shell"])

// Law III's gate switch (`--no-done-gate`, user decision 2026-10-18): the build writes
// `Done gate: off` into the install's AGENT.md only when the gate is off. Read ONCE, at the first
// use, from the harness dir (a switch flip takes an OpenCode restart); anything unreadable reads
// as ARMED. Off silences the reminder and the V2 notice, nothing else.
let doneGateOffOnce = null
function doneGateOff() {
  doneGateOffOnce ??= (async () => {
    const dir = await harnessDir()
    if (!dir) return false
    const text = await fs.readFile(path.join(dir, "AGENT.md"), "utf8")
    return /^Done gate:[ \t]*off[ \t]*\r?$/m.test(text)
  })().catch(() => false)
  return doneGateOffOnce
}

// null when the project has no list (or it is unreadable): then the checks are inferred.
async function readDoneChecks(root) {
  try {
    const text = await fs.readFile(path.join(root, DONE_LIST), "utf8")
    return text.split(/\r?\n/).map((l) => l.trim().replace(/\s+/g, " ")).filter((l) => l && !l.startsWith("#"))
  } catch {
    return null
  }
}

// The inference twin of js/hosts/done-checks.mjs (user decision 2026-10-29): with no list, the
// root manifests imply the checks, each a GROUP of accepted forms. Here they only shape the
// reminder's wording ("advisory"); OpenCode never blocks either way.
// tests/plugins/context_done.test.mjs runs both copies over the same fixtures.
const PM_LOCKS = [["bun.lockb", "bun"], ["bun.lock", "bun"], ["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"]]
const PM_SCRIPTS = ["test", "lint", "typecheck"]
function scriptCheck(pm, s) {
  const npm = s === "test" ? ["npm test", "npm run test", "npm t"] : [`npm run ${s}`]
  const own = pm === "npm" ? [] : pm === "bun" ? [`bun run ${s}`] : [`${pm} ${s}`, `${pm} run ${s}`]
  return { label: own[0] ?? npm[0], forms: [...own, ...npm] }
}
const wrapped = (label, bins, tasks, refuse) => ({
  label, refuse, forms: bins.flatMap((b) => tasks.flatMap((t) => [`${b} ${t}`, `${b} clean ${t}`])),
})
const MAVEN = wrapped("mvn test", ["mvn", "./mvnw", ".\\mvnw", "mvnw", "mvnw.cmd"], ["test", "verify", "install"],
  /(?:^|\s)-D(?:skipTests|maven\.test\.skip)(?=[=\s]|$)/)
const GRADLE = wrapped("gradle test", ["gradle", "./gradlew", ".\\gradlew", "gradlew", "gradlew.bat"], ["test", "build", "check"],
  /(?:^|\s)(?:-x|--exclude-task)[ =](?:\S*:)?test(?=\s|$)/)
const PYTEST = { label: "pytest", forms: ["pytest", "python -m pytest", "python3 -m pytest", "py -m pytest", "poetry run pytest"] }
const MANIFEST_CHECKS = [
  ["pom.xml", MAVEN],
  ["build.gradle", GRADLE],
  ["build.gradle.kts", GRADLE],
  ["pyproject.toml", PYTEST],
  ["Cargo.toml", { label: "cargo test", forms: ["cargo test"], refuse: /(?:^|\s)--no-run(?=\s|$)/ }],
  ["go.mod", { label: "go test", forms: ["go test"] }],
]
const exists = (p) => fs.access(p).then(() => true, () => false)
// The Node hook's `gitRootOf`: the nearest ancestor holding `.git` (a dir, or a worktree's file).
async function gitRootOf(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (await exists(path.join(d, ".git"))) return d
    if (path.dirname(d) === d) return null
  }
}
async function inferDoneChecks(root) {
  const has = (f) => exists(path.join(root, f))
  const sources = [], checks = []
  const add = (source, list) => {
    if (!list.length) return
    sources.push(source)
    for (const c of list) if (!checks.some((k) => k.label === c.label)) checks.push(c)
  }
  if (await has("package.json")) {
    let scripts = null
    try { scripts = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")).scripts } catch {}
    if (!scripts || typeof scripts !== "object") scripts = {}
    let pm = "npm"
    for (const [f, name] of PM_LOCKS) if (await has(f)) { pm = name; break }
    add("package.json", PM_SCRIPTS.filter((s) => typeof scripts[s] === "string"
      && !(s === "test" && /no test specified/.test(scripts[s]))).map((s) => scriptCheck(pm, s)))
  }
  // pytest only where it shows (the Node side's rule): a unittest-only repo could never clear it.
  const pytestShows = async () => {
    const toml = await fs.readFile(path.join(root, "pyproject.toml"), "utf8").catch(() => "")
    if (toml.includes("[tool.pytest")) return true
    for (const f of ["pytest.ini", "conftest.py", "tests"]) if (await has(f)) return true
    return false
  }
  for (const [file, check] of MANIFEST_CHECKS) {
    if (await has(file) && (check !== PYTEST || await pytestShows())) add(file, [check])
  }
  return { sources, checks }
}
// The checks of the git root above `dir`; `root` null outside a repo: no gate, as on the Node side.
async function doneChecksOf(dir) {
  const root = await gitRootOf(dir)
  if (!root) return { root, source: "", blocking: false, checks: [] }
  const listed = await readDoneChecks(root)
  if (listed) return { root, source: DONE_LIST, blocking: true, checks: listed.map((l) => ({ label: l, forms: [l] })) }
  const { sources, checks } = await inferDoneChecks(root)
  return { root, source: sources.join(", "), blocking: false, checks }
}
// The context block's one line on the done gate. "reminder", not "blocking": nothing blocks here.
// `judged` false (OpenCode 2, whose turns are never judged) claims no verdict at all.
async function doneLine(dir, judged = true) {
  const { root, source, blocking, checks } = await doneChecksOf(dir)
  if (!root) return null
  const names = checks.map((c) => c.label).join(", ")
  const how = (verdict) => (judged ? verdict : "not judged on this host")
  if (blocking) return checks.length ? `Done gate: from ${source} — ${names} (${how("reminder")})` : `Done gate: off — ${source} lists no checks`
  return checks.length ? `Done gate: inferred from ${source} — ${names} (${how("advisory")})` : "Done gate: no checks could be inferred"
}

// ---- The ownership decline reminder: the twin of js/hosts/ownership-gate.mjs `ownershipLine` ----
// In an application repo (a git root holding a build manifest) whose root AGENTS.md has no
// `## Ownership` section outside the Geneseed block, the developer's `Setup: declined <date>`
// line in `.geneseed/ownership.md` gets one context line, so the decline stays visible. Same
// manifests, strip, section and decline patterns as the hook (and geneseed-guard.js, whose gate
// defers on that line). `--no-ownership-gate` (`Ownership gate: off` in AGENT.md) prints nothing.
const OWN_MANIFESTS = new Set(["package.json", "pom.xml", "pyproject.toml", "go.mod", "Cargo.toml",
  "composer.json", "Gemfile"])
const isOwnManifest = (n) => OWN_MANIFESTS.has(n) || n.startsWith("build.gradle") || n.endsWith(".csproj")
const OWN_BLOCK_RE = /<!-- BEGIN GENESEED -->[\s\S]*?<!-- END GENESEED -->/g
const OWN_SECTION_RE = /^## Ownership[ \t]*\r?$/m
const OWN_DECLINED_RE = /^Setup:[ \t]*declined[ \t]+(\d{4}-\d{2}-\d{2})[ \t]*\r?$/m
let ownershipGateOffOnce = null
function ownershipGateOff() {
  ownershipGateOffOnce ??= (async () => {
    const dir = await harnessDir()
    if (!dir) return false
    const text = await fs.readFile(path.join(dir, "AGENT.md"), "utf8")
    return /^Ownership gate:[ \t]*off[ \t]*\r?$/m.test(text)
  })().catch(() => false)
  return ownershipGateOffOnce
}
async function ownershipLine(dir) {
  const root = await gitRootOf(dir)
  if (!root || !(await fs.readdir(root)).some(isOwnManifest)) return null
  const agents = await fs.readFile(path.join(root, "AGENTS.md"), "utf8").catch(() => "")
  if (OWN_SECTION_RE.test(agents.replace(OWN_BLOCK_RE, ""))) return null
  // The decline lives in the MAIN worktree (a fresh linked worktree per session must not lose it).
  const home = (await mainWorktreeOf(root)) ?? root
  const personal = await fs.readFile(path.join(home, ".geneseed", "ownership.md"), "utf8").catch(() => "")
  const since = OWN_DECLINED_RE.exec(personal.replace(/^\uFEFF/, ""))?.[1]
  return since ? `Ownership: setup declined since ${since} — not set up; say "set up ownership" to run it` : null
}

function runsUnpiped(command, line) {
  const cmd = String(command).replace(/[ \t]+/g, " ")
  for (let i = cmd.indexOf(line); i !== -1; i = cmd.indexOf(line, i + 1)) {
    const next = cmd[i + line.length]
    if (next !== undefined && !/[\s;&|]/.test(next)) continue
    const head = cmd.slice(0, i)
    if (!/(^|&&|\|\||;|\n) ?$/.test(head)) continue
    let quote = "", esc = false
    for (const ch of head) {
      if (esc) esc = false
      else if (ch === "\\" && quote !== "'") esc = true
      else if (quote) { if (ch === quote) quote = "" }
      else if (ch === '"' || ch === "'") quote = ch
    }
    if (quote) continue
    const rest = cmd.slice(i + line.length)
    let piped = false
    for (let j = 0; j < rest.length; j += 1) {
      const two = rest.slice(j, j + 2)
      if (two === "&&" || two === "||" || rest[j] === ";" || rest[j] === "\n") break
      if (rest[j] === "|") { piped = true; break }
    }
    if (!piped && !/\|\||[;\n] ?(?:true|:|exit(?: 0)?)(?= ?(?:$|[;&|\n]))/.test(rest)) return true
  }
  return false
}

// The twin of hooks-done.mjs's `groupPasses`: a form runs unpiped, and no flag in `refuse`
// skips the tests in the segment that ran it. Held equal by tests/plugins/context_done.test.mjs.
function groupPasses(command, g) {
  if (!g.forms.some((f) => runsUnpiped(command, f))) return false
  if (!g.refuse) return true
  return String(command).replace(/[ \t]+/g, " ").split(/&&|\|\||;|\n/).map((s) => s.trim())
    .some((s) => !s.includes("|") && !g.refuse.test(s)
      && g.forms.some((f) => s === f || s.startsWith(`${f} `)))
}

// An `apply_patch` call names its targets only in `patchText` markers. Copied from
// geneseed-guard.js (tests/plugins/helper_parity.test.mjs holds the copies equal); `from` is
// the pre-move path of an `Update File` + `Move to`, `path` where the file lands.
function patchSections(patchText) {
  const out = []
  let current = null
  const flush = () => { if (current) out.push(current) }
  const lines = String(patchText).split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let m = /^\*\*\* (?:Add|Delete) File:\s*(.+)$/.exec(line)
    if (m) { flush(); current = { from: "", path: m[1].trim(), added: [] }; continue }
    m = /^\*\*\* Update File:\s*(.+)$/.exec(line)
    if (m) {
      flush()
      let from = "", p = m[1].trim()
      const mv = /^\*\*\* Move to:\s*(.+)$/.exec(lines[i + 1] || "")
      if (mv) { from = p; p = mv[1].trim(); i++ }
      current = { from, path: p, added: [] }
      continue
    }
    if (current && line.startsWith("+") && !line.startsWith("+++")) current.added.push(line.slice(1))
  }
  flush()
  return out
}

// The checks still owed, judged over the previous turn and the current one: a reminder lasts
// one turn, not the whole session. Our own injected messages (`geneseed-*` ids) open no turn.
function doneOwed(messages, checks, root) {
  const groups = checks.map((c) => (typeof c === "string" ? { label: c, forms: [c] } : c))
  const prompts = []
  messages.forEach((m, i) => {
    if (m?.info?.role === "user" && !String(m.info.id ?? "").startsWith("geneseed-")) prompts.push(i)
  })
  const from = prompts.length >= 2 ? prompts[prompts.length - 2] : 0
  const tools = []
  for (const m of messages.slice(from)) {
    for (const p of m?.parts ?? []) if (p?.type === "tool" && p.state) tools.push(p)
  }
  // The Node hook's `within()`: `..cache/x` is inside the root, `../x` is not.
  const inside = (fp) => {
    const rel = path.relative(root, path.resolve(root, fp))
    return !(rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel))
  }
  let lastEdit = -1
  tools.forEach((p, i) => {
    if (!DONE_EDIT_TOOLS.has(String(p.tool).toLowerCase()) || p.state.status === "error") return
    const input = p.state.input ?? {}
    const fp = input.filePath ?? input.file_path
    const targets = typeof fp === "string" && fp ? [fp]
      : typeof input.patchText === "string" ? patchSections(input.patchText).flatMap((s) => [s.from, s.path]).filter(Boolean)
      : []
    // No derivable target: counted — the reminder is fail-open, a missed one is the worse error.
    if (targets.length && !targets.some(inside)) return
    lastEdit = i
  })
  if (lastEdit === -1) return []
  const passed = new Set()
  for (const p of tools.slice(lastEdit + 1)) {
    const command = DONE_SHELL_TOOLS.has(String(p.tool).toLowerCase()) && p.state.input?.command
    if (typeof command !== "string" || p.state.status !== "completed") continue
    const exit = p.state.metadata?.exit
    if (typeof exit === "number" && exit !== 0) continue
    for (const g of groups) if (groupPasses(command, g)) passed.add(g.label)
  }
  return groups.map((g) => g.label).filter((l) => !passed.has(l))
}

// The session-scope rule, once for both majors and both deliveries: a child/subagent session
// inherits its parent's context, and a geneseed-* session (learn distils, geneseed-wf:*
// children) must stay clean.
const isSkippedSession = (meta) =>
  Boolean(meta?.parentID ?? meta?.parentId) || String(meta?.title ?? "").startsWith("geneseed-")

// The rule as a per-sid cached filter over `getMeta(sid)` (each major's own session.get shape).
// Cached because the transform runs on EVERY request; a failed lookup is NOT cached, so the
// next request re-checks.
function sessionSkipper(getMeta) {
  const cache = new Map()
  return async (sid) => {
    if (!sid) return false
    const hit = cache.get(sid)
    if (hit !== undefined) return hit
    try {
      const skip = isSkippedSession(await getMeta(sid))
      cache.set(sid, skip)
      return skip
    } catch {
      return false
    }
  }
}

export const GeneseedContext = async (ctx) => {
  const { client } = ctx
  const done = new Set()
  const root = repoRoot(ctx)
  const blockCache = { text: null, at: 0 }

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
      let meta
      try {
        const info = await client.session.get({ path: { id: sid } })
        meta = info?.data ?? info
      } catch {}
      if (isSkippedSession(meta)) { log("skipped: child/subagent or geneseed-* session"); return }

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

  // Session-scope filter for the INVISIBLE delivery, the same rule as injectVisible's
  // guards — without it the transform prepends the full context block to every request of
  // every session in-process.
  const skipSession = sessionSkipper(async (sid) => {
    const info = await client.session.get({ path: { id: sid } })
    return info?.data ?? info
  })

  return {
    event: async ({ event }) => {
      if (!event || INJECT_OFF) return
      if (await sovereignBypass(root)) return
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
    // Re-push the eager docs into the compaction context so the project context
    // outlives the summary. Only needed when delivery is visible
    // (forced or fallback); the transform re-sends per request. Experimental
    // OpenCode hook; if it is absent in a build this key is simply never called.
    "experimental.session.compacting": async (_input, output) => {
      if (INJECT_OFF || (TRANSFORM && !fallbackVisible)) return
      if (await sovereignBypass(root)) return
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
      // One scope decision per request, shared by the done gate and the context block:
      // both end on an empty request, an excluded repo, or a skipped session.
      if (!output || !Array.isArray(output.messages) || !output.messages.length) return
      const sid = output.messages[0]?.info?.sessionID
      if (await sovereignBypass(root) || await skipSession(sid)) return
      // The done gate's reminder: FIRST, and independent of the context block:
      // INJECT_OFF and the visible delivery leave it on, and no early return below can skip it.
      // Its own function, so its early returns end the reminder, never the context injection.
      await (async () => {
        if (await doneGateOff()) return
        const { root: gitRoot, source, blocking, checks } = await doneChecksOf(root)
        if (!checks.length) return
        const owed = doneOwed(output.messages, checks, gitRoot)
        if (!owed.length) return
        const stamp = Date.now()
        output.messages.unshift({
          info: { id: `geneseed-done-${stamp}`, role: "user", sessionID: sid, time: { created: stamp } },
          parts: [{ id: `geneseed-done-part-${stamp}`, type: "text", text:
            `Geneseed (Verify Before Asserting) — files were edited, and these checks ${blocking ? "from" : "(advisory) inferred from"} `
            + `${source} have not passed since the last edit: ${owed.join("; ")}. Run them unpiped `
            + "before reporting the work done, or say plainly that they were not run and why." }],
        })
        log("transform: done-gate reminder injected")
      })().catch((err) => log(`done-gate error: ${err?.message ?? err}`))
      if (INJECT_OFF || !TRANSFORM || fallbackVisible) return
      try {
        // Already present this request? (idempotent across plugin copies / retries.)
        const present = output.messages.some((m) =>
          (m?.parts ?? []).some((p) => typeof p?.text === "string" && p.text.includes(MARKER)))
        if (present) return
        const cached = await cachedBlockText(root, blockCache)
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

// ---- OpenCode 2 ----------------------------------------------------------------
// `export default { id, server, setup }` serves V1 (>= 1.3.4) and V2 from one file — why, and
// each V1 hook's V2 counterpart: adapters/opencode/HOW-OPENCODE-LOADS.md.
//
// V2 has no `messages.transform`: `session.hook("context")` is its stable per-request
// equivalent (the outgoing system + messages, mutable), so the invisible delivery needs
// no fallback detection there. Messages are `LLM.Message` class instances, not V1's
// `{info, parts}`. A V2 hook that throws is a defect that fails the whole request,
// so every callback below swallows its own errors.

// Build a user message the request will accept: reuse the class of a message already in
// it (LLM.Message validates on construction), else a plain object of the same shape.
function v2UserMessage(messages, text) {
  const content = [{ type: "text", text }]
  const Ctor = messages.find((m) => m && m.constructor && m.constructor !== Object)?.constructor
  if (Ctor) { try { return new Ctor({ role: "user", content }) } catch {} }
  return { role: "user", content }
}
const v2HasMarker = (messages) => messages.some((m) =>
  (m?.content ?? []).some((p) => typeof p?.text === "string" && p.text.includes(MARKER)))
const v2Model = (ref) => (ref?.providerID && ref?.id ? `${ref.providerID}/${ref.id}` : null)

async function setupV2(ctx) {
  const root = repoRoot({ worktree: ctx?.location?.project?.directory, directory: ctx?.location?.directory })
  // `judged: false`: OpenCode 2 never judges a turn, so the done line claims no verdict.
  const blockCache = { text: null, at: 0, judged: false }
  // Same scope rule as V1's skipSession. V2's info names the parent `parentID` only, so only
  // that and the title are passed on.
  const skipSession = sessionSkipper(async (sid) => {
    const info = await ctx.session.get({ sessionID: sid })
    return { parentID: info?.parentID, title: info?.title }
  })

  // The done gate is not judged on OpenCode 2 (see `doneOwed`): said once, where its log goes.
  // The listed gate only: an inferred one would log in every repo with a manifest.
  if (!(await doneGateOff()) && await doneChecksOf(root).then((d) => d.blocking && d.checks.length, () => false)) {
    console.error(`[geneseed-context] done gate: ${DONE_LIST} found, but OpenCode 2 turns are not judged.`)
  }

  if (!VISIBLE) {
    await ctx.session.hook("context", async (event) => {
      if (INJECT_OFF) return
      try {
        if (await sovereignBypass(root)) return
        if (!Array.isArray(event?.messages) || v2HasMarker(event.messages)) return
        if (await skipSession(event.sessionID)) return
        const cached = await cachedBlockText(root, blockCache)
        if (!cached) return
        event.messages.unshift(v2UserMessage(event.messages, withModel(cached, v2Model(event.model) || envModelStr())))
        log("context hook: injected context invisibly")
      } catch (err) {
        log(`context hook error: ${err?.message ?? err}`)
      }
    })
    return
  }

  // Visible delivery (GENESEED_CONTEXT_VISIBLE): one synthetic message when a session is
  // created, re-pushed into the compaction request so it outlives the summary.
  await ctx.session.hook("compaction", async (event) => {
    if (INJECT_OFF) return
    try {
      if (await sovereignBypass(root)) return
      if (!Array.isArray(event?.messages) || await skipSession(event.sessionID)) return
      const { block } = await resolveBlock(root, false)
      if (block) event.messages.unshift(v2UserMessage(event.messages, block.text))
    } catch (err) {
      log(`compaction error: ${err?.message ?? err}`)
    }
  })
  const controller = new AbortController()
  void (async () => {
    for await (const ev of ctx.event.subscribe({ signal: controller.signal })) {
      if (ev?.type !== "session.created" || INJECT_OFF) continue
      const d = ev.data ?? {}
      try {
        if (isSkippedSession({ parentID: d.parentID, title: d.title })) continue
        if (await sovereignBypass(root)) continue
        const { block } = await resolveBlock(root, false)
        if (!block) continue
        await ctx.session.synthetic({
          sessionID: d.sessionID, text: withModel(block.text, v2Model(d.model) || envModelStr()),
          description: "Geneseed project context", resume: false,
        })
      } catch (err) {
        log(`visible injection error: ${err?.message ?? err}`)
      }
    }
  })().catch((err) => log(`event stream ended: ${err?.message ?? err}`))
  return () => controller.abort()
}

export default { id: "geneseed-context", server: GeneseedContext, setup: setupV2 }
