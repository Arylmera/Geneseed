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
// MACHINE WIKI (AGENT.md §7): the same block also carries the user's own knowledge
// base(s) — typically an Obsidian vault — declared once per machine in `wiki.json`
// ($GENESEED_WIKI -> $GENESEED_HARNESS/wiki.json -> beside this plugin's install).
// Each wiki's eager entries inject in full and lazy entries list, drawing on the
// SAME budgets as the project context; its conventions/inbox/protected metadata is
// surfaced so the agent knows the house rules before writing. No wiki.json, or an
// empty `wikis` list, costs nothing.
//
// Quiet: by default it logs NOTHING (OpenCode shows a plugin's stderr as red text).
// GENESEED_DEBUG=1 re-enables discovery/inject logs. GENESEED_CONTEXT_INJECT=off
// disables injection entirely — no visible PROJECT CONTEXT block — leaving project
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
const EAGER_FILE_KB = Number(process.env.GENESEED_EAGER_FILE_KB || 16)
const EAGER_TOTAL_KB = Number(process.env.GENESEED_EAGER_TOTAL_KB || 48)
const MAX_FILES_SCANNED = 2000
const MAX_DEPTH = 6
// Bounds on lazy-listing cost: read at most this many headings per session, and only
// the head of each file (enough for an H1) rather than the whole thing — a large
// docs/ tree must not cost one full-file read per entry on every session start.
const LAZY_HEADING_LIMIT = Number(process.env.GENESEED_LAZY_HEADINGS || 64)
const HEADING_SLICE_BYTES = 4096

// Quiet by default — OpenCode surfaces a plugin's stderr in the UI (red text). Set
// GENESEED_DEBUG=1 to see discovery/inject logs. Set GENESEED_CONTEXT_INJECT=off to
// disable injection entirely and lean on the AGENT.md project-context Law instead
// (no visible PROJECT CONTEXT block; enforcement becomes soft/agent-discipline).
const DEBUG = !!process.env.GENESEED_DEBUG
const INJECT_OFF = ["off", "0", "false", "no"].includes(
  (process.env.GENESEED_CONTEXT_INJECT || "on").toLowerCase())
// Opt-in invisible delivery: when on, inject the context into each request's message
// array via `experimental.chat.messages.transform` instead of a visible session.created
// noReply message — no PROJECT CONTEXT block shows in the conversation, and it survives
// compaction inherently (re-sent per request). Default OFF → today's behaviour is
// unchanged. Experimental OpenCode hook; verify it on your build before relying on it.
const TRANSFORM = ["1", "on", "true", "yes"].includes(
  (process.env.GENESEED_CONTEXT_TRANSFORM || "").toLowerCase())
function log(msg) { if (DEBUG) console.error(`[geneseed-context] ${msg}`) }

// ---- convention --------------------------------------------------------------
// Root-level files injected in full. Agent-directed rules + canonical entry docs.
const EAGER_ROOT = new Set([
  "AGENTS.md", "AGENT.md", "CLAUDE.md", ".cursorrules",
  "README.md", "CONTRIBUTING.md",
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
// so a "https://…" or "C:/Users/…" inside quotes is untouched. wiki.json is seeded
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

// ---- machine wiki (wiki.json) --------------------------------------------------
// The user's own knowledge base(s) — typically an Obsidian vault — declared once per
// machine, not per repo (AGENT.md §7). Same injection mechanics as project context,
// different scope. Resolution (first match wins, mirroring the learn plugin):
//   1. $GENESEED_WIKI                      explicit manifest path
//   2. $GENESEED_HARNESS/wiki.json         pinned install dir
//   3. <plugin dir>/../wiki.json           auto-locate: beside the installed AGENT.md
async function resolveWikiFile() {
  const explicit = process.env.GENESEED_WIKI
  if (explicit && (await isFile(explicit))) return explicit
  const harness = process.env.GENESEED_HARNESS
  if (harness) {
    const p = path.join(harness, "wiki.json")
    if (await isFile(p)) return p
  }
  const local = path.resolve(PLUGIN_DIR, "..", "wiki.json")
  if (await isFile(local)) return local
  return null
}

// Parse wiki.json into renderable wikis: [{ name, root, desc, conventions, inbox,
// protected, eager:[{rel,abs,desc}], lazy:[...] }]. Entry paths resolve against the
// wiki's own root; a missing root skips that wiki (never blocks the session).
async function wikiSets() {
  const file = await resolveWikiFile()
  if (!file) return []
  const data = await readJsonc(file)   // wiki.json is JSONC: stub ships commented
  const wikis = Array.isArray(data?.wikis) ? data.wikis : []
  const out = []
  for (const w of wikis) {
    if (!w?.path) continue
    if (!(await isDir(w.path))) { log(`wiki '${w.name ?? w.path}': root not found, skipped`); continue }
    const name = w.name || path.basename(w.path)
    const eager = [], lazy = []
    for (const e of Array.isArray(w.entries) ? w.entries : []) {
      if (!e?.path || e.load === "exclude") continue
      const abs = path.isAbsolute(e.path) ? e.path : path.resolve(w.path, e.path)
      const rec = { rel: `${name}/${e.path}`.split(path.sep).join("/"), abs, desc: e.description || "" }
      ;(e.load === "lazy" ? lazy : eager).push(rec)
    }
    const byRel = (a, b) => a.rel.localeCompare(b.rel)
    out.push({
      name, root: w.path, desc: w.description || "",
      conventions: w.conventions || "", inbox: w.inbox || "",
      protected: Array.isArray(w.protected) ? w.protected : [],
      eager: eager.sort(byRel), lazy: lazy.sort(byRel),
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

async function buildBlock(sets, wikis = []) {
  const state = { spent: 0, injected: 0, lazy: 0, headingsRead: 0 }

  const proj = []
  await renderSet(proj, sets, state)

  const wik = []
  for (const w of wikis) {
    wik.push(`--- wiki: ${w.name}${w.desc ? ` — ${w.desc}` : ""} (root: ${w.root}) ---`)
    if (w.conventions) wik.push(`  conventions: ${w.conventions} (read before your first write there)`)
    if (w.inbox) wik.push(`  inbox: ${w.inbox} (drop notes you cannot confidently file)`)
    if (w.protected.length) wik.push(`  protected (never write): ${w.protected.join(", ")}`)
    wik.push("")
    await renderSet(wik, { eager: w.eager, lazy: w.lazy }, state)
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
  return { block: await buildBlock(sets, wikis), src }
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

  return {
    event: async ({ event }) => {
      if (!event || event.type !== "session.created") return
      if (INJECT_OFF) return          // opt-out: rely on the AGENT.md Law, no visible block
      if (TRANSFORM) return           // invisible delivery via messages.transform handles it
      const sid =
        event.properties?.sessionID ?? event.payload?.sessionID ??
        event.properties?.info?.id ?? event.payload?.info?.id
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

        await client.session.prompt({
          path: { id: sid },
          body: { noReply: true, parts: [{ type: "text", text: block.text }] },
        })
        const via = src.mode === "manifest" ? `manifest ${src.file}` : `auto-discovery [${root}]`
        log(`injected: ${block.injected} eager (${block.kb} KB), ${block.lazy} lazy listed — via ${via}`)
      } catch (err) {
        log(`error: ${err?.message ?? err}`)
      }
    },

    // Survive compaction. The session.created injection above is a conversation
    // message, so OpenCode summarises it away when a long session compacts (the
    // AGENT.md rules persist — they load via opencode.json `instructions`, not the
    // conversation). Re-push the eager docs into the compaction context so the
    // project context — Law XVIII — outlives the summary. Experimental OpenCode hook;
    // if it is absent in a build this key is simply never called.
    "experimental.session.compacting": async (_input, output) => {
      if (INJECT_OFF || TRANSFORM) return   // transform re-injects each request; nothing to patch
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

    // Invisible delivery (opt-in, GENESEED_CONTEXT_TRANSFORM=1). Prepend the context to
    // each request's outgoing message array — no persisted/visible session message, and
    // it survives compaction because it is re-sent every request. Experimental OpenCode
    // hook; never called on a build that lacks it, so the default path is unaffected.
    "experimental.chat.messages.transform": async (_input, output) => {
      if (INJECT_OFF || !TRANSFORM) return
      try {
        if (!output || !Array.isArray(output.messages) || !output.messages.length) return
        const sid = output.messages[0]?.info?.sessionID
        // Already present this request? (idempotent across plugin copies / retries.)
        const present = output.messages.some((m) =>
          (m?.parts ?? []).some((p) => typeof p?.text === "string" && p.text.includes(MARKER)))
        if (present) return
        const text = await cachedBlockText(root)
        if (!text) return
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
