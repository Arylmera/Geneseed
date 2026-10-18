// Geneseed — OpenCode learn plugin.
//
// The runtime-agnostic counterpart of the Claude Code `Stop` hook: on
// `session.idle` it distils durable memories from the conversation and writes them
// into the bundle's memory/ dir, maintaining MEMORY.md — exactly what the harness's
// own `learn` verb does, but self-contained in this plugin so no separate process and
// no model CLI are required. It distils with the SAME model the session already used
// (read from the transcript), so it inherits your OpenCode provider config: no API
// key, nothing to set for the model.
//
// TIMING — `session.idle` fires after EVERY turn (it is OpenCode's "session became
// idle / response ready" signal), not only at the true end of a session. Distilling
// on the first idle would therefore mine just turn 1 and miss the rest. So each idle
// RE-ARMS a debounce timer (GENESEED_LEARN_DEBOUNCE_MS, default 60s) and the distil
// runs once the session has been quiet for that long — i.e. at the real end. A
// continued session simply re-arms and re-distils; a stored slug is never created
// twice, though a re-distil may update or archive it. (Trade-off: if OpenCode is killed inside the window the final distil
// is lost — still strictly better than capturing only turn 1, and far cheaper than
// re-distilling every turn.)
//
// Install (global — the bundle is used everywhere, so the plugin should be too):
//   copy this file to  ~/.config/opencode/plugins/geneseed-learn.js
// Or per-project: .opencode/plugins/geneseed-learn.js  (build --emit opencode
// drops it there for you).
//
// Where it writes — first match wins:
//   1. $GENESEED_MEMORY            an explicit memory dir
//   2. $GENESEED_HARNESS/memory    (or /anamnesis for the imperial theme)
//   3. ./memory  or  ./Harness/memory   (when the bundle is inside the project)
// If none resolve, it logs once and does nothing — it never blocks a session.
//
// It is intentionally conservative: trivial sessions are skipped, one session never
// has two distils in flight at once (a continued session re-distils after its next
// quiet window — see TIMING), and any error is swallowed.

import { promises as fs, realpathSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"

// The plugin's own directory. In the global install the layout is
// <cfg>/plugins/geneseed-learn.js beside <cfg>/memory, so the store can be found
// relative to this file — no manual `export GENESEED_HARNESS` needed.
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

const MAX_NOTES_CHARS = 16000          // cap the prompt; keep the most recent tail
const MIN_NOTES_CHARS = 200            // below this, the session is too trivial to mine
const MEMORY_DIR_NAMES = ["memory", "anamnesis"]   // neutral + imperial
// NaN-safe: garbage in the env var would make setTimeout fire immediately (NaN
// delay → 0), distilling after EVERY turn instead of at session end.
const _debounceRaw = Number(process.env.GENESEED_LEARN_DEBOUNCE_MS || 60000)
const DEBOUNCE_MS = Number.isFinite(_debounceRaw) && _debounceRaw >= 0 ? _debounceRaw : 60000

// SINGLE SOURCE of the distil instructions: the harness extracts this exact
// LEARN_PROMPT_HEAD template literal at runtime, so there is nothing to keep in sync.
const LEARN_PROMPT_HEAD = `You are distilling durable memories from the notes below. Output zero or more
Markdown memory files in this exact format, separated by a line containing only
'---FILE---':

---
name: <kebab-case-slug>
description: <one-line summary>
type: user | feedback | project | reference
topic: <kebab-case-slug; reuse a topic from TOPICS IN USE below when one fits>
---
<the fact, stated plainly. For 'feedback' and 'project', add **Why:** and
**How to apply:** lines.>

MERGE BEFORE YOU CREATE. The facts already stored are listed below as
'slug — description'. Never create a fact under one of those slugs. Instead:
  - If your memory refines, extends or corrects a stored fact, add the line
    'action: update' to its frontmatter and use that fact's own name. Your text
    REPLACES the stored file, so write the merged fact: keep everything the old
    one says that is still true, then add or correct what the notes show.
  - If the notes show a stored fact is now false or obsolete, output only
    frontmatter holding its 'name:' and the line 'action: archive'. It is moved
    out of the index, never deleted.
  - With no 'action:' line, the memory is a NEW fact under a NEW slug.

DEFAULT TO 'NOTHING'. Writing a memory is the rare exception, not the norm — most
sessions should yield zero. Emit AT MOST ONE, and only if it is a GENERAL, reusable
principle you would want at the START of an unrelated future task.

CAPTURE only (high altitude, cross-session):
  - a stable USER preference or working style the user showed or stated;
  - a CONVENTION or constraint that will hold across many future tasks;
  - a durable PROJECT decision or goal that outlives this session.

NEVER capture (this is the noise to cut):
  - what was done, found, fixed, or resolved this session ("fixed X", "resolved
    issue 7", "cleaned up the TODO", "renamed Y", "the landing screen redirects");
  - anything tied to one file, function, ticket, bug, or feature;
  - anything derivable from the code, the git history, or the current diff.

If you can only phrase it as "this session we …", it is NOT a memory:
  - Too specific:  "Fixed the failing test by adding await on line 42."
  - Right (meta):  "User wants async setup helpers always awaited."
  - Too specific:  "Resolved the magic-constants issue in config.js."  -> NO memory
    (a closed task, not a durable lesson).

When in doubt, output exactly: NOTHING.`

async function isDir(p) {
  try { return (await fs.stat(p)).isDirectory() } catch { return false }
}

async function resolveMemoryDir() {
  const env = process.env.GENESEED_MEMORY
  if (env && (await isDir(env))) return env
  const harness = process.env.GENESEED_HARNESS
  const bases = []
  if (harness) bases.push(harness)
  // The plugin's own dir (global install: <cfg>/plugins → <cfg>/memory) and the repo.
  bases.push(path.resolve(PLUGIN_DIR, ".."), process.cwd(), path.join(process.cwd(), "Harness"))
  for (const base of bases) {
    for (const name of MEMORY_DIR_NAMES) {
      const cand = path.join(base, name)
      if (await isDir(cand)) return cand
    }
  }
  return null
}

function partsText(parts) {
  return (parts || [])
    .filter((p) => p && p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n")
}

// ---- per-agent memory (memory/agents/<name>.md) ------------------------------
// Child subagent sessions are task fragments — never mined into the main store —
// but a lesson about how the *agent* should operate next time is durable. Kept
// deliberately conservative, like the rest of this plugin: an unresolvable agent
// name skips entirely. The harness's own twin is behaviour-identical
// so claude/bob get the same loop via their Stop/SubagentStop hooks.
const AGENT_NAME_RE = /^[a-z][a-z0-9-]{1,40}$/
const MAX_AGENT_BULLETS = 100 // hard cap, oldest dropped; no pruning heuristics

// SINGLE SOURCE — the harness extracts this exact literal (see LEARN_PROMPT_HEAD).
// Not exported: OpenCode calls every export as a plugin factory, and a string is not one.
const AGENT_LESSON_PROMPT = `The notes below are one subagent dispatch ("agent run").
Output AT MOST ONE line: a durable lesson about how this agent should operate on a
FUTURE, unrelated dispatch (a boundary that proved wrong, an input it always needs,
a method that worked). Task residue ("fixed X", file names, ticket detail) is NOT a
lesson. If there is none — the overwhelmingly common case — output exactly: NOTHING.`

function resolveAgentName(meta) {
  const raw = meta?.agent ?? meta?.agentName ?? meta?.agentID ?? null
  const name = typeof raw === "string" ? raw.trim().toLowerCase() : null
  return name && AGENT_NAME_RE.test(name) ? name : null
}

async function appendAgentLesson(memDir, agent, lesson) {
  const dir = path.join(memDir, "agents")
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, `${agent}.md`)
  let bullets = []
  try {
    bullets = (await fs.readFile(file, "utf8")).split("\n").filter((l) => l.startsWith("- "))
  } catch { /* first lesson for this agent */ }
  const day = new Date().toISOString().slice(0, 10)
  bullets.push(`- ${day}: ${lesson.replace(/\s+/g, " ").trim()}`)
  bullets = bullets.slice(-MAX_AGENT_BULLETS)
  await fs.writeFile(file, `# ${agent} — lessons\n` + bullets.join("\n") + "\n", "utf8")
  return file
}

// Flatten a session's messages into "role: text" notes, and pick the model the
// session actually used so we distil with the user's own provider config.
function flatten(messages) {
  const lines = []
  let model = null
  for (const m of messages) {
    const info = m?.info ?? {}
    const role = info.role
    if (role !== "user" && role !== "assistant") continue
    const text = partsText(m?.parts).trim()
    if (text) lines.push(`${role}: ${text}`)
    if (role === "assistant") {
      const providerID = info.providerID ?? info.provider
      const modelID = info.modelID ?? info.model
      if (providerID && modelID) model = { providerID, modelID }
    }
  }
  return { notes: lines.join("\n\n"), model }
}

function envModel() {
  const v = process.env.GENESEED_MODEL // "provider/model"
  if (v && v.includes("/")) {
    const [providerID, ...rest] = v.split("/")
    return { providerID, modelID: rest.join("/") }
  }
  return null
}

// Stems that name the store's own files, never a fact: `MEMORY` is the index, so a model
// that emitted `name: MEMORY` would overwrite it.
const RESERVED_STEMS = new Set(["memory", "readme"])

async function existingSlugs(memDir) {
  return new Set((await listMd(memDir)).map((f) => f.slice(0, -3)).filter((s) => !RESERVED_STEMS.has(s.toLowerCase())))
}

// The stored facts' lines are capped at MAX_STORED_CHARS, a twin of buildLearnPrompt in
// js/hosts/hooks-learn.mjs: a store of hundreds of facts would otherwise outgrow the notes.
// A fact past the cap is only unlisted — writeMemories still refuses to create its slug.
const MAX_STORED_CHARS = 8000
function buildPrompt(notes, facts) {
  const parts = [LEARN_PROMPT_HEAD, ""]
  if (facts.size) {
    parts.push("ALREADY STORED — 'slug — description', to update or archive, never to create:")
    let used = 0
    let shown = 0
    for (const [slug, { desc }] of facts) {
      const line = desc ? `- ${slug} — ${desc}` : `- ${slug}`
      if (used + line.length > MAX_STORED_CHARS) break
      parts.push(line)
      used += line.length + 1
      shown += 1
    }
    if (shown < facts.size) parts.push(`(${facts.size - shown} more stored facts not shown)`)
    parts.push("", "TOPICS IN USE:", [...new Set([...facts.values()].map((f) => f.topic))].sort().join(", "), "")
  }
  parts.push("NOTES:", notes)
  return parts.join("\n")
}

function parseFrontmatter(chunk) {
  const m = chunk.match(/^\s*---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!m) return {}
  const fm = {}
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":")
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "")
  }
  return fm
}

// A memory `name:` becomes a FILENAME and the model writes it, so it is a plain slug or
// nothing — no separator, no `..`, no drive. The same rule as MEMORY_SLUG_RE in
// js/hosts/memory-files.mjs, inlined because this file ships standalone.
const MEMORY_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/

// The chunk without its frontmatter `action:` line, which is an instruction, not the fact.
function stripAction(chunk) {
  const lines = chunk.split("\n")
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---")
  if (lines[0].trim() !== "---" || close < 0) return chunk
  return lines.filter((l, i) => i === 0 || i >= close || !/^\s*action\s*:/.test(l)).join("\n")
}

// A fact with a `force:` is never updated or archived by learn (the memory README's Bridge
// rule: revised inline with its supersession recorded, a constraint only by the user).
async function hasForce(memDir, slug) {
  try {
    return !!parseFrontmatter((await fs.readFile(path.join(memDir, `${slug}.md`), "utf8")).replace(/\r\n/g, "\n")).force
  } catch { return false }
}

// Move <slug>.md into archive/, never over a file already there (-2, -3, ... instead), and
// never unlink: an archived fact leaves the index but stays on disk.
async function archiveFact(memDir, slug) {
  const adir = path.join(memDir, "archive")
  await fs.mkdir(adir, { recursive: true })
  let dest = path.join(adir, `${slug}.md`)
  for (let n = 2; await fs.stat(dest).then(() => true, () => false); n += 1) dest = path.join(adir, `${slug}-${n}.md`)
  await fs.rename(path.join(memDir, `${slug}.md`), dest)
}

// The twin of writeMemories in js/hosts/memory-files.mjs: no `action:` creates a NEW slug,
// `action: update` archives the stored fact and writes the merged text in its place, `action: archive` moves it
// to archive/. An update or archive of no stored fact, or of one with a `force:`, is skipped,
// as is any other action, and each slug is acted on once. Compared lowercase: on a case-insensitive filesystem (Windows,
// macOS) `User-Prefs` and `user-prefs` are the same file, so a case variant acts on the
// stored spelling and never creates a second fact.
async function writeMemories(output, memDir, existing) {
  const stored = new Map([...existing].map((s) => [s.toLowerCase(), s]))
  const done = new Set()
  const res = { created: [], updated: [], archived: [] }
  for (let chunk of output.split(/^---FILE---\s*$/m)) {
    chunk = chunk.trim()
    if (!chunk || chunk.toUpperCase() === "NOTHING") continue
    const fm = parseFrontmatter(chunk)
    const name = (fm.name || "").trim()
    const key = name.toLowerCase()
    const action = (fm.action || "").trim().toLowerCase() || "create"
    if (!MEMORY_SLUG_RE.test(name) || RESERVED_STEMS.has(key) || done.has(key)) continue
    const slug = stored.get(key)
    if (slug && action !== "create" && (await hasForce(memDir, slug))) continue
    const body = stripAction(chunk).replace(/\n+$/, "") + "\n"
    if (action === "create" && !slug) {
      await fs.writeFile(path.join(memDir, `${name}.md`), body, "utf8")
      existing.add(name)
      stored.set(key, name)
      res.created.push(name)
    } else if (action === "update" && slug) {
      await archiveFact(memDir, slug) // the old version first: the model never saw its body
      await fs.writeFile(path.join(memDir, `${slug}.md`), body, "utf8")
      res.updated.push(slug)
    } else if (action === "archive" && slug) {
      await archiveFact(memDir, slug)
      existing.delete(slug)
      stored.delete(key)
      res.archived.push(slug)
    } else continue
    done.add(key)
  }
  if (res.created.length || res.updated.length || res.archived.length) await rebuildIndex(memDir, new Set(res.updated))
  return res
}

// The two-level index, a twin of rebuildIndex in js/hosts/memory-files.mjs (this file ships
// standalone): MEMORY.md is a map of topics, each topics/<topic>.md lists its facts. A fact
// already indexed keeps its line (title and hook), a new one gets its description, a topic
// file no fact uses is deleted, and map lines the build did not generate are carried.
const MEMORY_SEED = "# Memory Index\n"
const MAP_HINT = "Each topic file lists its facts; open the one the task needs."
const FACT_LINE_RE = /^- \[([^\]]*)\]\((?:\.\.\/)?([^/)]+)\.md\)(.*)$/
const MAP_LINE_RE = /^- \[[^\]]*\]\(topics\/[^)]+\.md\)/

const readLines = async (p) => {
  try { return (await fs.readFile(p, "utf8")).replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n") } catch { return null }
}
// The core's sortPaths/globMd rule (js/lib/paths.mjs normcase): names fold case on Windows, so
// the fact order inside a topic file, and which files count as .md, match the harness's.
const fold = (s) => (process.platform === "win32" ? s.toLowerCase() : s)
const listMd = async (dir) => {
  try {
    return (await fs.readdir(dir)).filter((f) => fold(f).endsWith(".md"))
      .sort((a, b) => (fold(a) < fold(b) ? -1 : fold(a) > fold(b) ? 1 : 0))
  } catch { return [] }
}
async function writeIfChanged(p, text) {
  const old = await readLines(p)
  if (old && old.join("\n") + "\n" === text) return
  await fs.writeFile(p, text, "utf8")
}
// `topic:`, else `type:` (a `type:` nested under `metadata:` reads the same: keys are trimmed).
function topicOf(fm) {
  const raw = (fm.topic || fm.type || "").trim()
  return raw.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "misc"
}

// Every top-level fact (never archive/ or agents/), in index order: slug -> { desc, topic }.
async function readFacts(memDir) {
  const facts = new Map()
  for (const f of await listMd(memDir)) {
    const slug = f.slice(0, -3)
    if (RESERVED_STEMS.has(slug.toLowerCase())) continue
    let fm
    try { fm = parseFrontmatter((await fs.readFile(path.join(memDir, f), "utf8")).replace(/\r\n/g, "\n")) } catch { continue }
    facts.set(slug, { desc: (fm.description || "").trim(), topic: topicOf(fm) })
  }
  return facts
}

// `fresh`: slugs just updated, whose old index line describes a fact that is gone.
async function rebuildIndex(memDir, fresh = new Set()) {
  const tdir = path.join(memDir, "topics")
  const old = new Map()
  for (const f of [path.join(memDir, "MEMORY.md"), ...(await listMd(tdir)).map((t) => path.join(tdir, t))]) {
    for (const line of (await readLines(f)) ?? []) {
      const m = FACT_LINE_RE.exec(line.trim())
      if (m) old.set(m[2], { title: m[1], rest: m[3] })
    }
  }
  const byTopic = new Map()
  for (const [slug, { desc, topic }] of await readFacts(memDir)) {
    const o = fresh.has(slug) ? null : old.get(slug)
    const line = o ? `- [${o.title}](../${slug}.md)${o.rest}` : `- [${slug}](../${slug}.md)` + (desc ? ` — ${desc}` : "")
    if (!byTopic.has(topic)) byTopic.set(topic, [])
    byTopic.get(topic).push(line)
  }
  for (const f of await listMd(tdir)) {
    if (!byTopic.has(f.slice(0, -3))) await fs.unlink(path.join(tdir, f))
  }
  if (byTopic.size) await fs.mkdir(tdir, { recursive: true })
  else await fs.rmdir(tdir).catch(() => {})
  const mapLines = []
  for (const topic of [...byTopic.keys()].sort()) {
    const lines = byTopic.get(topic)
    await writeIfChanged(path.join(tdir, `${topic}.md`), `# ${topic}\n\n${lines.join("\n")}\n`)
    mapLines.push(`- [${topic}](topics/${topic}.md) — ${lines.length} fact${lines.length === 1 ? "" : "s"}`)
  }
  const index = path.join(memDir, "MEMORY.md")
  const carried = ((await readLines(index)) ?? []).filter((l) => {
    const t = l.trim()
    return t && t !== MEMORY_SEED.trim() && t !== MAP_HINT && !MAP_LINE_RE.test(t) && !FACT_LINE_RE.test(t)
  })
  const body = [...(mapLines.length ? ["", MAP_HINT, "", ...mapLines] : []), ...(carried.length ? ["", ...carried] : [])]
  await writeIfChanged(index, body.length ? MEMORY_SEED + body.join("\n") + "\n" : MEMORY_SEED)
}

// The distil's reply into the store: a child session's one agent lesson, else memory
// files plus their two-level index. Shared by the V1 and V2 runs.
async function storeDistil(output, { isChild, memDir, agentName, existing }) {
  if (!output.trim() || output.trim().toUpperCase() === "NOTHING") return
  if (isChild) {
    const lesson = output.trim().split("\n")[0].replace(/^[-*]\s*/, "").trim()
    if (lesson.length < 10 || lesson.length > 300) return // junk / truncation guard
    const f = await appendAgentLesson(memDir, agentName, lesson)
    console.error(`[geneseed-learn] agent lesson -> ${f}`)
    return
  }
  const res = await writeMemories(output, memDir, existing)
  for (const [verb, slugs] of [["wrote", res.created], ["updated", res.updated], ["archived", res.archived]]) {
    if (slugs.length) console.error(`[geneseed-learn] ${verb} ${slugs.length} memory file(s): ${slugs.join(", ")}`)
  }
}

export const GeneseedLearn = async (ctx) => {
  const { client } = ctx ?? {}
  const ours = new Set()       // throwaway distil sessions — never mine our own output
  const timers = new Map()     // sid -> debounce timer, re-armed on each idle
  const inFlight = new Set()   // sid currently being distilled (guards against overlap)
  let warnedNoDir = false

  // The session root, as guard and context use it — not process.cwd(), which is the
  // directory OpenCode was launched from and need not be the project being served.
  const root = ctx?.worktree || ctx?.directory || process.cwd()

  async function runDistill(sid) {
    if (await sovereignBypass(root)) return
    if (inFlight.has(sid)) return   // a run is already underway; the next idle re-arms
    inFlight.add(sid)
    try {
      // A child session (carries a parent link) is a subagent dispatch: never mined
      // into the shared store, but distilled for ONE per-agent lesson if we can name
      // the agent. Field absent → top-level user session, distilled the old way.
      // Unresolvable agent on a child → skip entirely (the prior behaviour).
      const info = await client.session.get?.({ path: { id: sid } }).catch(() => null)
      const meta = info?.data ?? info
      const isChild = !!(meta?.parentID ?? meta?.parentId)
      const agentName = isChild ? resolveAgentName(meta) : null
      if (isChild && !agentName) return

      const memDir = await resolveMemoryDir()
      if (!memDir) {
        if (!warnedNoDir) {
          warnedNoDir = true
          console.error(
            "[geneseed-learn] no memory dir — set $GENESEED_HARNESS or $GENESEED_MEMORY."
          )
        }
        return
      }

      const res = await client.session.messages({ path: { id: sid } })
      const messages = Array.isArray(res) ? res : res?.data ?? []
      let { notes, model } = flatten(messages)
      if (notes.length < MIN_NOTES_CHARS) return
      notes = notes.slice(-MAX_NOTES_CHARS)
      model = model ?? envModel()
      if (!model) {
        console.error(
          "[geneseed-learn] could not determine a model — set $GENESEED_MODEL=provider/model."
        )
        return
      }

      const existing = await existingSlugs(memDir)
      const prompt = isChild
        ? [AGENT_LESSON_PROMPT, "", "NOTES:", notes].join("\n")
        : buildPrompt(notes, await readFacts(memDir))

      // Distil in a throwaway session with the session's own model, then drop it.
      const session = await client.session.create({ body: { title: "geneseed-learn (auto)" } })
      const newId = session?.id ?? session?.data?.id
      if (!newId) {
        // Prompting with {id: undefined} would 404 silently on every idle.
        console.error("[geneseed-learn] session.create returned no id — skipping this distil.")
        return
      }
      ours.add(newId)
      let output = ""
      try {
        const reply = await client.session.prompt({
          path: { id: newId },
          body: { model, parts: [{ type: "text", text: prompt }] },
        })
        output = partsText(reply?.parts ?? reply?.data?.parts) || reply?.text || ""
      } finally {
        if (newId) await client.session.delete({ path: { id: newId } }).catch(() => {})
      }

      await storeDistil(output, { isChild, memDir, agentName, existing })
    } catch (err) {
      // Never break the session over a memory write.
      console.error(`[geneseed-learn] skipped: ${err?.message ?? err}`)
    } finally {
      inFlight.delete(sid)
    }
  }

  return {
    event: async ({ event }) => {
      if (!event) return
      const sid =
        event.properties?.sessionID ??
        event.payload?.sessionID ??
        event.properties?.info?.id ??
        event.payload?.info?.id
      // A deleted session must not distil later from a stale timer (and its entry
      // must not leak in the maps for the life of the process).
      if (event.type === "session.deleted") {
        const t = timers.get(sid)
        if (t) clearTimeout(t)
        timers.delete(sid)
        ours.delete(sid)
        return
      }
      if (event.type !== "session.idle") return
      if (!sid || ours.has(sid)) return
      // session.idle fires after every turn — debounce so we distil once, at the real
      // end of the session (see header note). Each idle re-arms the timer.
      const prev = timers.get(sid)
      if (prev) clearTimeout(prev)
      timers.set(sid, setTimeout(() => { timers.delete(sid); runDistill(sid) }, DEBOUNCE_MS))
    },
  }
}

// OpenCode treats every export as a plugin and rejects non-functions; hang the test
// helpers off the factory instead — reachable via import, invisible to the loader.
Object.assign(GeneseedLearn, { writeMemories, resolveAgentName, appendAgentLesson, flattenV2 })

// ---- OpenCode 2 ----------------------------------------------------------------
// `export default { id, server, setup }` serves V1 (>= 1.3.4) and V2 from one file — why, and
// each V1 hook's V2 counterpart: adapters/opencode/HOW-OPENCODE-LOADS.md.
//
// What differs on V2:
//   - The debounce re-arms on `session.execution.succeeded`: V2 core never publishes
//     `session.idle` (deprecated in its schema), and the execution pair is its turn
//     boundary. Events are `{ type, data }`, not `{ type, properties }`.
//   - The transcript is `session.context()` — the messages after the last compaction —
//     typed `user` (text) / `assistant` (content parts, `model: { providerID, id }`).
//   - The distil is one stateless `generate.text({ prompt, model })` call with the
//     session's own model: no throwaway session to create, guard against and delete.
function flattenV2(messages) {
  const lines = []
  let model = null
  for (const m of messages || []) {
    if (m?.type === "user") {
      const text = String(m.text ?? "").trim()
      if (text) lines.push(`user: ${text}`)
    } else if (m?.type === "assistant") {
      const text = (m.content || [])
        .filter((p) => p?.type === "text" && typeof p.text === "string")
        .map((p) => p.text).join("\n").trim()
      if (text) lines.push(`assistant: ${text}`)
      if (m.model?.providerID && m.model?.id) model = m.model
    }
  }
  return { notes: lines.join("\n\n"), model }
}

async function setupV2(ctx) {
  const root = ctx?.location?.project?.directory || ctx?.location?.directory || process.cwd()
  const timers = new Map()
  const inFlight = new Set()
  let warnedNoDir = false

  async function runDistill(sid) {
    if (await sovereignBypass(root)) return
    if (inFlight.has(sid)) return
    inFlight.add(sid)
    try {
      const meta = await ctx.session.get({ sessionID: sid }).catch(() => null)
      if (String(meta?.title ?? "").startsWith("geneseed-")) return
      const isChild = !!meta?.parentID
      const agentName = isChild ? resolveAgentName(meta) : null
      if (isChild && !agentName) return

      const memDir = await resolveMemoryDir()
      if (!memDir) {
        if (!warnedNoDir) {
          warnedNoDir = true
          console.error("[geneseed-learn] no memory dir — set $GENESEED_HARNESS or $GENESEED_MEMORY.")
        }
        return
      }

      let { notes, model } = flattenV2(await ctx.session.context({ sessionID: sid }))
      if (notes.length < MIN_NOTES_CHARS) return
      notes = notes.slice(-MAX_NOTES_CHARS)
      if (!model) {
        const env = envModel()
        model = env ? { providerID: env.providerID, id: env.modelID } : null
      }
      if (!model) {
        console.error("[geneseed-learn] could not determine a model — set $GENESEED_MODEL=provider/model.")
        return
      }

      const existing = await existingSlugs(memDir)
      const prompt = isChild
        ? [AGENT_LESSON_PROMPT, "", "NOTES:", notes].join("\n")
        : buildPrompt(notes, await readFacts(memDir))
      const reply = await ctx.generate.text({
        prompt, model: { providerID: model.providerID, id: model.id, ...(model.variant ? { variant: model.variant } : {}) },
      })
      await storeDistil(String(reply?.text ?? ""), { isChild, memDir, agentName, existing })
    } catch (err) {
      console.error(`[geneseed-learn] skipped: ${err?.message ?? err}`)
    } finally {
      inFlight.delete(sid)
    }
  }

  const controller = new AbortController()
  void (async () => {
    for await (const ev of ctx.event.subscribe({ signal: controller.signal })) {
      const sid = ev?.data?.sessionID
      if (!sid) continue
      if (ev.type === "session.deleted") {
        const t = timers.get(sid)
        if (t) clearTimeout(t)
        timers.delete(sid)
        continue
      }
      if (ev.type !== "session.execution.succeeded") continue
      const prev = timers.get(sid)
      if (prev) clearTimeout(prev)
      timers.set(sid, setTimeout(() => { timers.delete(sid); runDistill(sid) }, DEBOUNCE_MS))
    }
  })().catch((err) => console.error(`[geneseed-learn] event stream ended: ${err?.message ?? err}`))
  return () => {
    controller.abort()
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
  }
}

export default { id: "geneseed-learn", server: GeneseedLearn, setup: setupV2 }
