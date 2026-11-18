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
//   2. $GENESEED_HARNESS/memory
//   3. the install's own target: a GLOBAL install uses the shared store, <machine dir>/memory,
//      when it exists, else its own memory/; a project install uses its own memory/
//   4. ./memory  or  ./Harness/memory   (the repo, last: never ahead of the install)
// If none resolve, it logs once and does nothing — it never blocks a session.
//
// It is intentionally conservative: trivial sessions are skipped, one session never
// has two distils in flight at once (a continued session re-distils after its next
// quiet window — see TIMING), and any error is swallowed.

import { promises as fs, realpathSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"
import { createHash } from "node:crypto"
import { readdirSync, statSync, existsSync, writeFileSync as writeLogSync, mkdirSync, readFileSync as readLogSync } from "node:fs"

// OpenCode 1.x paints a plugin's stderr over its TUI input box (in red); its own log API
// writes to the log file instead. The V1 entry sets LOG_CLIENT; V2 and tests have no
// client and keep stderr, as does a refused log call, so no line is lost. Never throws:
// a log line must not break a tool call.
let LOG_CLIENT = null
function say(msg, level = "warn") {
  try {
    if (LOG_CLIENT?.app?.log) {
      Promise.resolve(LOG_CLIENT.app.log({ body: { service: "geneseed-learn", level, message: msg } })).catch(() => console.error(`[geneseed-learn] ${msg}`))
      return
    }
  } catch { /* fall through to stderr */ }
  console.error(`[geneseed-learn] ${msg}`)
}

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
// The machine tier: machineDir() in js/lib/machine-dir.mjs, which a plugin cannot import.
function machineDir() {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "geneseed")
}
// A global install reads the tier: its .geneseed-emit names a -global emit, or it IS the host's config dir.
async function readsTier(dir) {
  try { if ((await fs.readFile(path.join(dir, ".geneseed-emit"), "utf8")).trim().endsWith("-global")) return true } catch { /* no marker */ }
  return isHostConfigDir(dir)
}
// Where the install's notebook is, and which loaded copy records: geneseed-guard.js is their home
// and carries the reasons (`node tests/twins.mjs --write` keeps these copies).
function notebookHome(cfg = path.dirname(PLUGIN_DIR)) {
  const isDirSync = (p) => { try { return statSync(p).isDirectory() } catch { return false } }
  if (isDirSync(path.join(cfg, "notebook"))) return cfg
  if (path.basename(cfg) === ".opencode" && isDirSync(path.join(path.dirname(cfg), "notebook"))) return path.dirname(cfg)
  return null
}
function usageHome(cfg = path.dirname(PLUGIN_DIR)) {
  const home = notebookHome(cfg)
  return home && !existsSync(path.join(home, ".usage-off")) ? home : null
}
function countingCopy(here) {
  const [directory, worktree] = here || []
  if (!directory) return null
  const start = path.resolve(directory)
  const top = worktree ? path.resolve(worktree) : start
  const rel = path.relative(top, start)
  // Nearest first. `directory` not under `worktree`: test the two and walk nothing.
  const dirs = [start]
  if (rel.startsWith("..") || path.isAbsolute(rel)) dirs.push(top)
  else for (let d = start; norm(d) !== norm(top) && path.dirname(d) !== d;) { d = path.dirname(d); dirs.push(d) }
  for (const dir of dirs) {
    const plugins = path.join(dir, ".opencode", "plugins")
    if (existsSync(path.join(plugins, "geneseed-guard.js")) && usageHome(path.join(dir, ".opencode"))) return norm(plugins)
  }
  return null
}
function anotherCopyCounts(here) {
  if (process.env.GENESEED_STACK_GLOBAL) return false
  try {
    const winner = countingCopy(here)
    return winner !== null && winner !== norm(PLUGIN_DIR)
  } catch { return false /* cannot tell: count */ }
}
async function sovereignBypass(cwd) {
  try {
    const cfg = path.dirname(PLUGIN_DIR)           // plugins/ sits directly in <cfg>
    const listOf = async (file) => {
      try { const l = JSON.parse(await fs.readFile(file, "utf8")).excludes; return Array.isArray(l) ? l : [] } catch { return [] }
    }
    const entries = await listOf(path.join(cfg, "excludes.json"))
    // Shared list (<machineDir>/excludes.json): a GLOBAL install adds it, a project install never does.
    const shared = await listOf(path.join(machineDir(), "excludes.json"))
    if (shared.length && await readsTier(cfg)) entries.push(...shared)
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
description: <one line under 90 characters that states the claim>
type: user | feedback | project | reference
topic: <kebab-case-slug; reuse a topic from TOPICS IN USE below when one fits>
---
<the fact in one or two sentences. For 'feedback' and 'project', add one-line
**Why:** and **How to apply:** lines.>

MERGE BEFORE YOU CREATE. The facts already stored are listed below as
'slug — description'. Never create a fact under one of those slugs. Instead:
  - If your memory refines, extends or corrects a stored fact, add the line
    'action: update' to its frontmatter and use that fact's own name. Your text
    REPLACES the stored file, so write the merged fact: keep everything the old
    one says that is still true, then add or correct what the notes show. Then
    write the merged fact to the same lean bar: drop what is no longer needed.
  - If the notes show a stored fact is now false or obsolete, output only
    frontmatter holding its 'name:' and the line 'action: archive'. It is moved
    out of the index, never deleted.
  - With no 'action:' line, the memory is a NEW fact under a NEW slug.

WRITE IT LEAN. Every word is re-read in later sessions.
  - description: state the claim itself, specific enough to tell it from the
    stored facts below; never a bare label.
  - body: the fact in one or two sentences; Why and How to apply, one line each.
  - no narrative, no session history, no PR or ticket numbers, no
    session-specific counts; a date only when the fact depends on it, written
    absolute.

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

// The install's own target comes BEFORE the repo: a global session in a repo that has its own
// memory/ (possibly tracked) must not learn into it. A global install (.geneseed-emit ends in
// -global, as geneseed-context.js tests it) takes the shared store when it exists, else its own
// memory/. Only "memory" names a store: a themed "anamnesis" matched Terra's Anamnesis/ vault
// by Windows case folding (B3). The shared store is machineDir() in js/lib/machine-dir.mjs,
// which a plugin cannot import.
// The host's own config dir counts as global too, whatever its marker says (the hook's
// isHostGlobalDir accepts both): OPENCODE_CONFIG_DIR, else <XDG config>/opencode.
const hostConfigDir = () => process.env.OPENCODE_CONFIG_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "opencode")
async function isHostConfigDir(dir) {
  const real = async (d) => { const r = await fs.realpath(path.resolve(d)).catch(() => path.resolve(d)); return process.platform === "win32" ? r.toLowerCase() : r }
  return (await real(dir)) === (await real(hostConfigDir()))
}

async function resolveMemoryDir(pluginDir = PLUGIN_DIR) {
  const env = process.env.GENESEED_MEMORY
  if (env && (await isDir(env))) return env
  const harness = process.env.GENESEED_HARNESS
  const own = path.resolve(pluginDir, "..")
  const cands = []
  if (harness) cands.push(path.join(harness, "memory"))
  if (await readsTier(own)) cands.push(path.join(machineDir(), "memory"))
  cands.push(path.join(own, "memory"), path.join(process.cwd(), "memory"), path.join(process.cwd(), "Harness", "memory"))
  for (const cand of cands) if (await isDir(cand)) return cand
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
    // The fold's rule (js/build/fold.mjs foldRules): a file that is not UTF-8 is left whole, the lesson dropped.
    const raw = await fs.readFile(file)
    if (!raw.equals(Buffer.from(raw.toString("utf8")))) return null
    bullets = raw.toString("utf8").split("\n").filter((l) => l.startsWith("- "))
  } catch { /* first lesson for this agent */ }
  const day = new Date().toISOString().slice(0, 10)
  bullets.push(`- ${day}: ${lesson.replace(/\s+/g, " ").trim()}`)
  bullets = bullets.slice(-MAX_AGENT_BULLETS)
  await fs.writeFile(file, `# ${agent} — lessons\n` + bullets.join("\n") + "\n", "utf8")
  return file
}

// ---- spec-feedback notes (agent-notes/<name>.md, skill-notes/<name>.md) ----------
// The `spec-feedback:` lines a subagent ends its report with go into the notes its next dispatch
// reads, and a skill's `[skill:<name>]` line into the notes that skill reads, with no model call:
// the twin of js/hosts/spec-feedback.mjs `captureSpecFeedback`, which the Claude hook runs on
// SubagentStop and Stop. The pure part below is a tool-kept copy.
// ---- spec-feedback twin: BEGIN — adapters/opencode/plugins/geneseed-learn.js carries everything down
// to the END marker verbatim, with `export ` dropped (`node tests/twins.mjs --write` after a change).

/**
 * One report line: `spec-feedback: [agent|general] <fix> [— situation: …] — seen: …`, at the start
 * of the line after an optional list marker, and optionally wrapped in backticks or bold. A line
 * that only names the protocol ("No spec-feedback.", "The reviewer's spec-feedback: …") does not
 * start with it, so it is no feedback; nor is a quoted (`>`) line or one inside a code fence: both
 * show someone else's line. Real reports write the scope four ways (`[agent]`, `agent`,
 * `agent —`, none), and some copy the template's `[agent|general]`; a missing or unchosen scope
 * reads as `agent`.
 */
const FEEDBACK_LINE_RE = /^[ \t]*(?:[-*+][ \t]+)*(\*\*|`)?spec-feedback[ \t]*:(\*\*|`)?[ \t]*(.*)$/i;
const FENCE_RE = /^[ \t]*(?:```|~~~)/;
// A bare scope word stands alone: `agent-notes/…` and `general-purpose …` open a body, not a scope.
// `[agent:project]` (or bare `agent:project`) is the agent's own line kept for this repo only, and
// `[general:project]` (or bare `general:project`) the line every agent reads in this repo only.
const FEEDBACK_SCOPE_RE = /^(?:\[[ \t]*(?<own>agent|general)[ \t]*\]|\[[ \t]*agent[ \t]*\|[ \t]*general[ \t]*\]|\[[ \t]*(?<pw>agent|general)[ \t]*:[ \t]*project[ \t]*\]|(?<pb>agent|general):project(?![\w-])|(?<bare>agent|general)(?![\w-]))[ \t]*(?:[—–:-][ \t]*)?/i;
// What opens an agent's tag at all, parsed or not: `[project]`, `[agent project]`, `[agent:local]`
// do not parse, and are dropped rather than filed, tag and all, in the machine notes.
const AGENT_OPENING_RE = /^\[[ \t]*(?:agent|general|project)\b/i;
/**
 * A skill's scope, which always names the skill: `[skill:<name>]` for that skill's own notes,
 * `[skill:<name>:general]` (or `, general` / ` general`) for the notes every skill shares, and
 * `[skill:<name>:project]` for its own notes in this repo only, and `[skill:<name>:general:project]`
 * for the notes every skill shares in this repo only. The
 * name is required because the main session's reply, where a skill's line is read, also relays
 * sub-agents' `[agent]` and `[general]` lines: only a line naming a skill is a skill's. A `|`
 * before `general` is the template's unchosen alternative, as `[agent|general]` is: own notes.
 * The bracket's content is taken whole, and a name that is no slug (the template's `<name>`, a
 * path) drops the line rather than letting `[skill:…]` fall through into an agent's notes. The
 * brackets may be dropped (`skill:debug — …`), as reports drop them around `agent`, scope and all (`skill:debug:project — …`).
 */
const SKILL_SCOPE_RE = /^(?:\[[ \t]*skill[ \t]*:[ \t]*([^\]|,; \t:]*)[ \t]*(?:([|,;:]|[ \t])[ \t]*(general[ \t]*:[ \t]*project|general|project)[ \t]*)?\]|skill:([a-z][a-z0-9-]*)(?::(general:project|general|project))?(?![\w-]))[ \t]*(?:[—–:-][ \t]*)?/i;
const SKILL_NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;
// What opens a skill's tag at all, parsed or not.
const SKILL_OPENING_RE = /^(?:\[[ \t]*skill\b|skill[ \t]*:)/i;
// "none" as the whole answer, or before punctuation or a dash; "none of the proof commands…" is feedback.
const FEEDBACK_NONE_RE = /^(?:none|n\/a|nothing|no friction)[ \t]*(?:$|[.,;:!—–-])/i;
/** The include's own template, which a report may quote: never a note. */
const FEEDBACK_PLACEHOLDER = '<the one-line fix>';
/**
 * The step-0 footprint: every dispatch reads its own notes and `_general.md`. Past the bullet cap,
 * or past the character budget, the oldest of the HOOK'S bullets drop (a hand-written line is
 * never dropped). An agent's own file keeps 100, as `memory/agents/` does; the general file 30.
 */
const MAX_FEEDBACK_BULLETS = 100;
const MAX_GENERAL_BULLETS = 30;
const MAX_NOTE_FILE_CHARS = 8000;
/** A body past this many characters is cut, so one runaway line cannot fill the file. */
const MAX_FEEDBACK_CHARS = 500;
/** The general file's name. `_` keeps it apart from every agent: an agent name starts with a letter. */
const GENERAL_NOTES = '_general.md';
/**
 * TWO SCOPES, chosen by the line, never by the install (the owner's ruling, 2026-11-15). A flaw of
 * the spec is true in every repo: `[agent]`, `[general]`, `[skill:<id>]`, `[skill:<id>:general]` go
 * to the MACHINE notes, the tier's `notes/`. A fact true only in this repo, `[agent:project]`,
 * `[general:project]`, `[skill:<id>:project]` or `[skill:<id>:general:project]`, goes to the
 * PROJECT notes, `<project root>/notebook/`, one folder for every host, with its own `_general.md`
 * files. The render names this folder relative to the project root (`{{PATH_PROJECT_NOTES}}`).
 */
const PROJECT_NOTES_DIR = 'notebook';
/**
 * THE PROJECT NOTES NEVER REACH A COMMIT, and Geneseed writes no file into the user's tree to say so
 * (the owner's ruling, 2026-11-15): the ignore entries go into the clone's own `.git/info/exclude`,
 * per clone and never committed. That covers a fresh repo, a repo whose `notebook/` is tracked, and an
 * unrelated `notebook/` folder alike, since only the notes folders and the migration's archives are
 * named. `rel` is the notebook's path from the git root, `/`-separated. The exclude file's new text,
 * or null when every entry is already there: the block is added once, and only its missing lines after.
 */
const EXCLUDE_HEAD = '# Geneseed: the project notes stay on this clone, never committed';
function excludeWithNotes(text, rel) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim());
  const want = ['agent-notes', 'skill-notes', 'archived-agent-notes', 'archived-skill-notes'].map((sub) => `/${rel}/${sub}/`);
  const missing = want.filter((w) => !lines.includes(w));
  if (!missing.length) return null;
  const old = String(text || '').replace(/\r\n?/g, '\n');
  const add = [...(lines.includes(EXCLUDE_HEAD) ? [] : [EXCLUDE_HEAD]), ...missing];
  return `${old}${old && !old.endsWith('\n') ? '\n' : ''}${add.join('\n')}\n`;
}
// A bullet's dated tail, `(2026-11-14)` or `(tester, 2026-11-14)`: not part of what it says.
const DATED_TAIL_RE = /[ \t]*\((?:[a-z][a-z0-9-]*, )?\d{4}-\d{2}-\d{2}\)[ \t]*$/;
// A bullet in the shape this capture writes: the only kind the caps may drop.
// Every bullet the hook writes names its writer beside the date, `(<agent or skill>, date)`: that
// is what tells it from a line written by hand (the notes were hand-written as `- [skill] … (date)`
// before the hook), and a hand-written line is never dropped (the owner's ruling, 2026-11-15).
// `[agent]` bullets written before the name was added read as hand lines now: kept, never pruned.
const HOOK_BULLET_RE = /^- \[(?:agent|general|skill)\] .*\([a-z][a-z0-9-]*, \d{4}-\d{2}-\d{2}\)[ \t]*$/;

/**
 * Every feedback line in `text` as `{ scope, body }`, in order, each body once. `secret` is Law
 * I's pattern: a line that carries a credential is dropped whole, never written to a note. An
 * agent's scope is `agent`, `general`, `project` or `project-general`. A skill's line also carries
 * `skill: <name>`, its scope `skill` (own notes), `general`, `project` or `project-general`.
 */
function specFeedbackOf(text, secret) {
  const found = [];
  let fenced = false;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (FENCE_RE.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = FEEDBACK_LINE_RE.exec(line);
    if (!m) continue;
    let body = m[3].trim();
    // `**spec-feedback:** …` closed its wrapper at the colon; `` `spec-feedback: …` `` closes it at the end.
    if (m[1] && !m[2] && body.endsWith(m[1])) body = body.slice(0, -m[1].length).trim();
    let scope = 'agent';
    let skill = null;
    const k = SKILL_SCOPE_RE.exec(body);
    if (k) {
      skill = (k[1] ?? k[4]).toLowerCase();
      if (!SKILL_NAME_RE.test(skill)) continue;
      // A skill line wrapped in inline code is an example the reply quotes (a summary of this very
      // format), not the reply's own line: the main session discusses the format, an agent's
      // report does not. A whole-line `spec-feedback:` in backticks stays an agent's line.
      if (m[1] === '`') continue;
      const tag = (k[3] && k[2] !== '|' ? k[3] : k[5] ?? '').toLowerCase().replace(/[ \t]/g, '');
      scope = tag === 'general:project' ? 'project-general' : tag || 'skill';
      body = body.slice(k[0].length);
    } else if (SKILL_OPENING_RE.test(body)) {
      continue; // a skill tag that does not parse (`[skill:a:b]`, `[skill:a, b]`) is no agent's line
    } else {
      const s = FEEDBACK_SCOPE_RE.exec(body);
      if (!s && AGENT_OPENING_RE.test(body)) continue;
      const g = s ? s.groups : {};
      const projectTag = g.pw || g.pb;
      if (projectTag) scope = projectTag.toLowerCase() === 'general' ? 'project-general' : 'project';
      else if (g.own || g.bare) scope = (g.own || g.bare).toLowerCase();
      if (s) body = body.slice(s[0].length);
    }
    body = body.replace(/\s+/g, ' ').trim();
    if (body.length < 10 || FEEDBACK_NONE_RE.test(body) || body.includes(FEEDBACK_PLACEHOLDER)) continue;
    if (secret && secret.test(body)) continue;
    if (body.length > MAX_FEEDBACK_CHARS) body = `${body.slice(0, MAX_FEEDBACK_CHARS).trimEnd()}…`;
    if (found.some((f) => f.body === body && (f.skill ?? null) === skill)) continue;
    found.push(skill ? { scope, skill, body } : { scope, body });
  }
  return found;
}

/**
 * The note bullets for one report: an `agent` line goes to the agent's own file, a `general` line
 * to `_general.md` only (with the agent's name), which every agent reads too. One home each. A
 * skill's line is not the agent's: `skillBullets` takes it.
 */
function feedbackBullets(items, agent, day) {
  const mine = items.filter((f) => !f.skill);
  const own = (scope) => mine.filter((f) => f.scope === scope).map((f) => `- [agent] ${f.body} (${agent}, ${day})`);
  const general = (scope) => mine.filter((f) => f.scope === scope).map((f) => `- [general] ${f.body} (${agent}, ${day})`);
  return {
    own: own('agent'),
    general: general('general'),
    // The same bullet shapes in the project's files: where a bullet sits says its scope.
    project: own('project'),
    projectGeneral: general('project-general'),
  };
}

/**
 * The same for the skills' lines, into `skill-notes/`: `own` maps each skill to its bullets,
 * `- [skill] … (<skill>, date)`; a general line goes to `skill-notes/_general.md`, which every
 * skill reads, in the same shape as `[general]`. The name beside the date is what tells a hook
 * bullet from the `- [skill] … (date)` lines written by hand before the hook: those are never
 * dropped, and the duplicate check reads past both tails, so the same words are one note.
 */
function skillBullets(items, day) {
  const own = new Map();
  const project = new Map();
  const general = [];
  const projectGeneral = [];
  for (const f of items) {
    if (!f.skill) continue;
    if (f.scope === 'general' || f.scope === 'project-general') {
      (f.scope === 'general' ? general : projectGeneral).push(`- [general] ${f.body} (${f.skill}, ${day})`);
      continue;
    }
    const into = f.scope === 'project' ? project : own;
    if (!into.has(f.skill)) into.set(f.skill, []);
    into.get(f.skill).push(`- [skill] ${f.body} (${f.skill}, ${day})`);
  }
  return { own, general, project, projectGeneral };
}

/**
 * Every file one report writes, `{ root, sub, name, bullets, cap }` in the order the capture
 * writes them: `root` is `machine` (the tier's notes) or `project` (`<project>/notebook`). A Stop
 * passes no agent, so an agent's line there (relayed from a sub-agent) has no target. The one
 * routing table: the hook and the OpenCode plugin both write what this returns.
 */
function feedbackTargets(items, agent, day) {
  const targets = [];
  const put = (root, sub, name, bullets, cap) => { if (bullets.length) targets.push({ root, sub, name, bullets, cap }); };
  if (agent) {
    const { own, general, project, projectGeneral } = feedbackBullets(items, agent, day);
    put('machine', 'agent-notes', `${agent}.md`, own, MAX_FEEDBACK_BULLETS);
    put('machine', 'agent-notes', GENERAL_NOTES, general, MAX_GENERAL_BULLETS);
    put('project', 'agent-notes', `${agent}.md`, project, MAX_FEEDBACK_BULLETS);
    put('project', 'agent-notes', GENERAL_NOTES, projectGeneral, MAX_GENERAL_BULLETS);
  }
  const skills = skillBullets(items, day);
  for (const [skill, bullets] of skills.own) put('machine', 'skill-notes', `${skill}.md`, bullets, MAX_FEEDBACK_BULLETS);
  put('machine', 'skill-notes', GENERAL_NOTES, skills.general, MAX_GENERAL_BULLETS);
  for (const [skill, bullets] of skills.project) put('project', 'skill-notes', `${skill}.md`, bullets, MAX_FEEDBACK_BULLETS);
  put('project', 'skill-notes', GENERAL_NOTES, skills.projectGeneral, MAX_GENERAL_BULLETS);
  return targets;
}

/** What a bullet says, for the duplicate check: its date and agent off, spacing and case folded. */
const feedbackKey = (bullet) => bullet.replace(DATED_TAIL_RE, '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * A notes file's new text with `bullets` appended, or null when every one is already there (a
 * second run on the same report writes nothing). The old text is kept as it was, line endings
 * folded to LF; past `cap` bullets of the hook's own shape, or past `budget` characters, the
 * oldest hook bullets drop. A hand-written line is never moved or dropped, and neither is a bullet
 * this call adds: when hand-written text alone fills the budget, the file goes over it rather
 * than lose the note just written.
 */
function mergeFeedback(old, bullets, cap = MAX_FEEDBACK_BULLETS, budget = MAX_NOTE_FILE_CHARS) {
  const text = String(old || '').replace(/\r\n?/g, '\n');
  const lines = text ? text.replace(/\n$/, '').split('\n') : [];
  let oldCount = lines.length;
  const seen = new Set(lines.filter((l) => l.startsWith('- ')).map(feedbackKey));
  let added = 0;
  for (const b of bullets) {
    const k = feedbackKey(b);
    if (seen.has(k)) continue;
    seen.add(k);
    lines.push(b);
    added += 1;
  }
  if (!added) return null;
  const size = () => lines.reduce((n, l) => n + l.length + 1, 0);
  let hooks = lines.filter((l) => HOOK_BULLET_RE.test(l)).length;
  while (hooks > cap || size() > budget) {
    const i = lines.slice(0, oldCount).findIndex((l) => HOOK_BULLET_RE.test(l));
    if (i < 0) break;
    lines.splice(i, 1);
    oldCount -= 1;
    hooks -= 1;
  }
  return `${lines.join('\n')}\n`;
}
// ---- spec-feedback twin: END

// Law I's credential pattern: a hand twin of js/hosts/hooks-prims.mjs SECRET_RE (two lines there,
// so no tool-kept line twin); tests/plugins/learn.test.mjs holds the two sources equal.
const FEEDBACK_SECRET_RE =
  /\b(?:AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-ant-[A-Za-z0-9_-]{20,}|xox[abprs]-[0-9A-Za-z-]{10,})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/

// The two notes roots, `{ machine, project }`: the twin of js/hosts/hooks-learn.mjs `notesRootsOf`,
// which says why. MACHINE is the tier's notes/ for every install. PROJECT is <project>/notebook:
// the install's parent for a project install (plugins in <repo>/.opencode/plugins), the git root
// of the session `root` for a global one, a linked worktree's main checkout either way; null for a
// global session outside any repo.
async function gitRootOf(dir) {
  for (let d = path.resolve(dir); ;) {
    try { await fs.stat(path.join(d, ".git")); return d } catch { /* walk up */ }
    const up = path.dirname(d)
    if (up === d) return null
    d = up
  }
}
// The project notes' entries in the clone's own `.git/info/exclude`: the hand twin of
// js/hosts/spec-feedback.mjs `excludeProjectNotes` (the block's text is the tool-kept
// `excludeWithNotes`). Outside a git repo nothing is written; never throws.
async function excludeProjectNotes(notebookDir) {
  try {
    const top = await gitRootOf(path.dirname(notebookDir))
    if (!top) return false
    const rel = path.relative(top, notebookDir).split(path.sep).join("/")
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false
    let gitdir = path.join(top, ".git")
    if (!(await isDir(gitdir))) {
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(await fs.readFile(gitdir, "utf8"))
      if (!m) return false
      gitdir = path.resolve(top, m[1])
      try { gitdir = path.resolve(gitdir, (await fs.readFile(path.join(gitdir, "commondir"), "utf8")).trim()) } catch { /* no commondir: a submodule's own gitdir */ }
    }
    const file = path.join(gitdir, "info", "exclude")
    const next = excludeWithNotes(await fs.readFile(file, "utf8").catch(() => ""), rel)
    if (next === null) return false
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, next, "utf8")
    return true
  } catch { return false }
}
async function notesRootsOf(pluginDir = PLUGIN_DIR, root = null) {
  const own = path.resolve(pluginDir, "..")
  let base = null
  try {
    base = (await readsTier(own)) ? (root ? await gitRootOf(root) : null) : path.dirname(own)
    const main = base ? await mainWorktreeOf(base) : null
    if (main) base = path.join(main, path.relative(await gitRootOf(base), base))
  } catch { base = null }
  return { machine: path.join(machineDir(), "notes"), project: base ? path.join(base, PROJECT_NOTES_DIR) : null }
}

// The file lock, a twin of js/hosts/spec-feedback.mjs `withLock` (async here): `<file>.lock` made
// exclusively and holding its owner's token, at most 100 waits of 10 ms, then give up silently.
// Parallel child sessions end together and would otherwise lose bullets. A lock older than 10 s
// is a dead holder's: it is broken by renaming it to a name only this caller uses (one of two
// waiters wins), a fresh lock taken that way is linked back, and a holder removes the lock on
// release only while it still holds its own token.
const feedbackLockToken = () => `${process.pid}.${Math.random().toString(36).slice(2)}`
async function breakStaleFeedbackLock(lock) {
  const taken = `${lock}.${feedbackLockToken()}.stale`
  try { await fs.rename(lock, taken) } catch { return }
  try {
    if (Date.now() - (await fs.stat(taken)).mtimeMs <= 10000) await fs.link(taken, lock) // a live lock: put it back
  } catch { /* the slot is taken again */ }
  await fs.unlink(taken).catch(() => {})
}
async function withFeedbackLock(file, fn) {
  const lock = `${file}.lock`
  const token = feedbackLockToken()
  for (let i = 0; i < 100; i += 1) {
    let handle
    try {
      handle = await fs.open(lock, "wx")
    } catch (e) {
      // Windows: a lock unlinked while a handle is still open is "delete pending", and creating it
      // again fails EPERM/EACCES, not EEXIST. A busy lock, not a fault: wait and retry.
      if (["EPERM", "EACCES", "EBUSY"].includes(e?.code)) { await new Promise((r) => setTimeout(r, 10)); continue }
      if (e?.code !== "EEXIST") return false
      let stale = false
      try { stale = Date.now() - (await fs.stat(lock)).mtimeMs > 10000 } catch { continue }
      if (stale) { await breakStaleFeedbackLock(lock); continue }
      await new Promise((r) => setTimeout(r, 10))
      continue
    }
    try {
      try { await handle.writeFile(token) } finally { await handle.close() }
      return await fn()
    } finally {
      try { if ((await fs.readFile(lock, "utf8")) === token) await fs.unlink(lock) } catch { /* broken as stale */ }
    }
  }
  return false
}

async function addFeedback(file, bullets, cap) {
  if (!bullets.length) return false
  return withFeedbackLock(file, async () => {
    let old = ""
    try {
      const raw = await fs.readFile(file)
      if (!raw.equals(Buffer.from(raw.toString("utf8")))) return false // not UTF-8: left whole
      old = raw.toString("utf8")
    } catch { /* the first note */ }
    const next = mergeFeedback(old, bullets, cap)
    if (next === null) return false
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    await fs.writeFile(tmp, next, "utf8")
    // A rename onto a file a reader holds open fails EPERM on Windows for a moment: three tries.
    for (let i = 0; ; i += 1) {
      try { await fs.rename(tmp, file); break } catch (e) {
        if (i < 2 && e?.code === "EPERM") { await new Promise((r) => setTimeout(r, 10)); continue }
        await fs.unlink(tmp).catch(() => {})
        throw e
      }
    }
    return true
  })
}

// A skill this install serves under that name: its SKILL.md names its own notes file. The twin of
// js/hosts/spec-feedback.mjs `liveSkill`, which says why (an alias folder or an older render does not).
async function liveSkill(skillsDir, name) {
  if (!skillsDir) return false
  try { return (await fs.readFile(path.join(skillsDir, name, "SKILL.md"), "utf8")).includes(`skill-notes/${name}.md`) } catch { return false }
}

// `report` is a child session's final assistant text (`agent` named), or a session's last reply
// at a turn's end (`agent` null: only `[skill:<name>]` lines count there). A skill line is kept
// only for a `liveSkill` of `skillsDir`. The twin of js/hosts/spec-feedback.mjs
// `captureSpecFeedback`, which says why. Never throws.
async function captureSpecFeedback(agent, report, roots, day = new Date().toISOString().slice(0, 10), skillsDir = null) {
  try {
    const at = typeof roots === "string" ? { machine: roots, project: roots } : (roots || {})
    const usable = async (dir) => Boolean(dir) && (await isDir(path.dirname(dir)))
    if (!(await usable(at.machine)) && !(await usable(at.project))) return []
    const items = []
    for (const f of specFeedbackOf(report, FEEDBACK_SECRET_RE)) {
      if (f.skill ? await liveSkill(skillsDir, f.skill) : agent) items.push(f)
    }
    if (!items.length) return []
    const written = []
    for (const t of feedbackTargets(items, agent, day)) {
      const root = at[t.root]
      if (!(await usable(root))) continue
      if (t.root === "project" && typeof roots !== "string") await excludeProjectNotes(root)
      const dir = path.join(root, t.sub)
      await fs.mkdir(dir, { recursive: true })
      if (await addFeedback(path.join(dir, t.name), t.bullets, t.cap)) written.push(path.join(dir, t.name))
    }
    if (written.length) say(`spec-feedback -> ${written.join(", ")}`, "info")
    return written
  } catch (err) {
    say(`spec-feedback skipped: ${err?.message ?? err}`)
    return []
  }
}

// This install's skills (`<cfg>/skills`, `<repo>/.opencode/skills`): the ones whose rendered
// machine notes are `notesRootsOf().machine`.
const SKILLS_DIR = path.join(path.dirname(PLUGIN_DIR), "skills")

// A skill runs in the main context, so its `[skill:<name>]` line is read off a session's last reply
// at EVERY turn's end (V1 `session.idle`, V2 `session.execution.succeeded`), not after the
// debounce: a skill runs mid-session, and a process closed inside the quiet window would lose the
// line. The twin of the Stop hook's capture (js/hosts/hooks-learn.mjs). One message fetch per
// turn, and none for an install that ships no skills or in an excluded folder. A child session's
// lines are read here too; the child capture writes the same bullets, which are not added twice.
// `fetchMessages` is the host's own read. Never throws.
async function captureTurn(fetchMessages, root) {
  try {
    if (!(await isDir(SKILLS_DIR)) || (await sovereignBypass(root))) return []
    return await captureSpecFeedback(null, finalAssistantText(await fetchMessages()), await notesRootsOf(PLUGIN_DIR, root), undefined, SKILLS_DIR)
  } catch (err) {
    say(`spec-feedback skipped: ${err?.message ?? err}`)
    return []
  }
}

// The last assistant message's text, V1 (`{ info: { role }, parts }`) or V2 (`{ type, content }`).
function finalAssistantText(messages) {
  for (let i = (messages || []).length - 1; i >= 0; i -= 1) {
    const m = messages[i]
    if (m?.info?.role === "assistant") return partsText(m.parts)
    if (m?.type === "assistant") return partsText(m.content)
  }
  return ""
}

// ---- agent outcome ledger (notebook/agent-runs.jsonl) ---------------------------------------
// One line per finished child session that names its agent: the twin of js/hosts/agent-runs.mjs
// `recordAgentRun`. The marker table, the spec hash and the line are tool-kept below; the walk is
// by hand, since a session's messages are not a JSONL transcript.
// ---- agent-runs twin: BEGIN — adapters/opencode/plugins/geneseed-learn.js carries everything down
// to the END marker verbatim, with `export ` dropped (`node tests/twins.mjs --write` after a change).

/**
 * A refused tool call: the result text a host or a gate gives a call it did not run. Only the
 * result's FIRST line is read, and every marker is anchored at its start (a host prefix of at most
 * 80 characters allowed for Geneseed's own words): a red test or a search that QUOTES a gate's text
 * further down its output is an error, not a refusal. One row each, with where its text comes from:
 *   - Geneseed's own refusal (`gateText` mode `refused`, js/hosts/hooks-prims.mjs), and the text
 *     said when that text fails (`GATE_UNSAID`), behind a host's prefix ("PreToolUse:Bash hook …").
 *   - The OpenCode guard: V1 throws `[geneseed-guard] blocked: …`; V2 renames the call, and core
 *     answers `No tool named "BLOCKED, not a missing tool: …"` (geneseed-guard.js, seen on 2.2.6).
 *   - Claude Code's auto-mode classifier, seen live 2026-11-14: "Permission for this action was
 *     denied by the Claude Code auto mode classifier."
 *   - Claude Code's worktree isolation, seen live 2026-11-14: "This agent is isolated in the
 *     worktree …, but this command … Refusing to run it — …".
 *   - Claude Code's permission rule deny and a user's "no" to an ask: UNVERIFIED wording.
 */
const REFUSAL_MARKERS = [
  /^.{0,80}?Tell the user this, word for word:/,
  /^.{0,80}?Geneseed could not describe this call\./,
  /^\[geneseed-guard\] blocked:/,
  /^No tool named "BLOCKED, not a missing tool:/,
  /^Permission for this action was denied\b/,
  /^This agent is isolated in the worktree .{1,600}? Refusing to run it\b/,
  /^Permission to use \S.{0,300}? has been denied\b/,
  /^The user doesn't want to (?:proceed with|take) this/,
];

/**
 * True when the first line of `text` (a tool result) says the call was refused. Each marker is
 * anchored with `^` (no `m` flag) and its `.` never crosses a line break, so a marker can only
 * match on the first line.
 */
function isRefusal(text) {
  const t = String(text ?? '').trimStart();
  return REFUSAL_MARKERS.some((re) => re.test(t));
}

/** The short hash of a rendered spec: sha256 of its text with line endings folded to LF, 12 hex. */
function specHashOf(text) {
  return createHash('sha256').update(String(text).replace(/\r\n?/g, '\n'), 'utf8').digest('hex').slice(0, 12);
}

/** The ledger line, field order fixed. `ts` is the UTC day, as `usage.jsonl` stamps it. */
function agentRunLine(run, now = new Date()) {
  return `${JSON.stringify({
    ts: now.toISOString().slice(0, 10), agent: run.agent, spec: run.spec ?? null, done: run.done ?? null,
    blocks: run.blocks ?? null, tools: run.tools ?? null, refused: run.refused ?? null,
    feedback: run.feedback ?? 0, report: Boolean(run.report),
  })}\n`;
}
// ---- agent-runs twin: END

// The child's tool calls are its `tool` parts that name their tool: V1's `{ tool, state: { status,
// error } }` (seen), and on V2 `{ name, state? }` in `session.context()`, a shape UNVERIFIED against a
// live OpenCode 2. With no such part at all the counts are null, never a confident 0: an unknown
// shape must not read as "used no tools". A refusal is an errored part whose error text
// `isRefusal` reads as one: V1's `[geneseed-guard] blocked:`, V2 core's `No tool named "BLOCKED…`.
function toolCounts(messages) {
  let tools = 0
  let refused = 0
  for (const m of messages || []) {
    for (const p of m?.parts ?? m?.content ?? []) {
      if (p?.type !== "tool" || typeof (p.tool ?? p.name) !== "string") continue
      tools += 1
      const state = p.state ?? {}
      const e = state.error ?? p.error
      const said = typeof e === "string" ? e : e?.message ?? e?.data?.message ?? ""
      if ((state.status ?? p.status) === "error" && isRefusal(said)) refused += 1
    }
  }
  return tools ? { tools, refused } : { tools: null, refused: null }
}

// The agent's rendered spec hash when this install's manifest owns `agents/<name>.md`, else null.
async function ownedSpec(cfg, agent) {
  try {
    const owned = JSON.parse(await fs.readFile(path.join(cfg, ".geneseed-manifest.json"), "utf8")).owned
    if (!Array.isArray(owned) || !owned.includes(`agents/${agent}.md`)) return null
    return specHashOf(await fs.readFile(path.join(cfg, "agents", `${agent}.md`), "utf8"))
  } catch { return null }
}

// `done` and `blocks` are null here: this host's done gate is geneseed-context.js, whose verdict
// this plugin cannot read. Into the install's notebook, as usage.jsonl (`usageHome`: <cfg> for a
// global install, <repo> for a project one) and off as it is (GENESEED_NO_USAGE, `.usage-off`);
// the spec hash still comes from the plugin's own layer, `cfg` (<repo>/.opencode holds a project
// install's manifest and agents/). Beside a live project install the global copy sees the child
// too: one copy records it, the one `countingCopy` names (`here` is [directory, worktree]). Once
// per child per process: a child idles more than once. Never throws.
const recordedRuns = new Set()
async function recordAgentRun(sid, agent, messages, cfg = path.dirname(PLUGIN_DIR), here = null) {
  try {
    if (!agent || recordedRuns.has(sid) || process.env.GENESEED_NO_USAGE) return null
    const home = usageHome(cfg)
    if (!home || anotherCopyCounts(here)) return null
    recordedRuns.add(sid)
    const report = finalAssistantText(messages)
    const line = agentRunLine({
      agent, spec: await ownedSpec(cfg, agent), done: null, blocks: null, ...toolCounts(messages),
      feedback: specFeedbackOf(report, FEEDBACK_SECRET_RE).filter((f) => !f.skill).length, report: Boolean(report.trim()),
    })
    const file = path.join(home, "notebook", "agent-runs.jsonl")
    return (await withFeedbackLock(file, async () => { await fs.appendFile(file, line); return line })) || null
  } catch { return null }
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
// A twin of isReservedStem in js/hosts/memory-files.mjs (D2): a stem written wholly in capitals is a store document too.
const isReservedStem = (stem) => RESERVED_STEMS.has(stem.toLowerCase()) || (stem === stem.toUpperCase() && stem !== stem.toLowerCase())

async function existingSlugs(memDir) {
  return new Set((await listMd(memDir)).map((f) => f.slice(0, -3)).filter((s) => !isReservedStem(s)))
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
    if (!MEMORY_SLUG_RE.test(name) || isReservedStem(name) || done.has(key)) continue
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
  // temp file + rename: two hosts can rebuild the index at once, and a reader never sees half of it
  const tmp = `${p}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp` // two sessions in one process share a pid
  await fs.writeFile(tmp, text, "utf8")
  await fs.rename(tmp, p)
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
    if (isReservedStem(slug)) continue
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
  const known = new Set()
  for (const [slug, { desc, topic }] of await readFacts(memDir)) {
    known.add(slug.toLowerCase())
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
  // A flat pointer is dropped unless it names a store document (D4): a fact's has moved into its topic file.
  const documents = new Set((await listMd(memDir)).map((f) => f.slice(0, -3).toLowerCase()).filter((s) => !known.has(s)))
  const carried = ((await readLines(index)) ?? []).filter((l) => {
    const t = l.trim()
    const flat = FACT_LINE_RE.exec(t)
    return t && t !== MEMORY_SEED.trim() && t !== MAP_HINT && !MAP_LINE_RE.test(t) && !(flat && !documents.has(flat[2].toLowerCase()))
  })
  const body = [...(mapLines.length ? ["", MAP_HINT, "", ...mapLines] : []), ...(carried.length ? ["", ...carried] : [])]
  await writeIfChanged(index, body.length ? MEMORY_SEED + body.join("\n") + "\n" : MEMORY_SEED)
}

// The store files under one home, as `path -> "size:mtime"`: stats, no reads. Twin of
// js/hosts/store-watch.mjs `storeScan`; the plugins' copies are held equal by helper_parity.
function storeScan(home, found = {}) {
  const stamp = (f) => {
    try { const s = statSync(f); if (s.isFile()) found[f] = `${s.size}:${Math.trunc(s.mtimeMs)}` } catch { /* absent */ }
  }
  for (const n of ["user-rules.md", "user-rules.draft.md", "PROFILE.md", "geneseed-wiki.jsonc", "wiki.jsonc", "wiki.json"]) stamp(path.join(home, n))
  const walk = (dir) => {
    let items = []
    try { items = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of items) {
      if (e.isDirectory()) { if (e.name !== "archive" && !e.name.startsWith("archived-")) walk(path.join(dir, e.name)) }
      else if (e.name.endsWith(".md")) stamp(path.join(dir, e.name))
    }
  }
  walk(path.join(home, "memory"))
  return found
}

// This plugin's own writes, logged so the change report does not call them unapproved: the store
// around the run, and what moved, as an exact stamp. Twin of store-watch.mjs `recordOwnWrites`.
async function recordOwnWrites(home, fn) {
  const before = storeScan(home)
  try { return await fn() } finally {
    try {
      const now = storeScan(home)
      const moved = [...new Set([...Object.keys(before), ...Object.keys(now)])].filter((f) => before[f] !== now[f])
      if (moved.length) {
        const f = path.join(home, "memory", ".own-writes.json")
        let log = {}
        try { log = JSON.parse(readLogSync(f, "utf8")) } catch { /* the first */ }
        for (const p of moved) { delete log[p]; log[p] = now[p] ?? "gone" }
        mkdirSync(path.dirname(f), { recursive: true })
        writeLogSync(f, JSON.stringify(Object.fromEntries(Object.entries(log).slice(-2000))))
      }
    } catch { /* the log never fails a write */ }
  }
}

// The distil's reply into the store: a child session's one agent lesson, else memory
// files plus their two-level index. Shared by the V1 and V2 runs.
async function storeDistil(output, opts) {
  return recordOwnWrites(path.dirname(opts.memDir), () => writeDistil(output, opts))
}
async function writeDistil(output, { isChild, memDir, agentName, existing }) {
  if (!output.trim() || output.trim().toUpperCase() === "NOTHING") return
  if (isChild) {
    const lesson = output.trim().split("\n")[0].replace(/^[-*]\s*/, "").trim()
    if (lesson.length < 10 || lesson.length > 300) return // junk / truncation guard
    const f = await appendAgentLesson(memDir, agentName, lesson)
    say(f ? `agent lesson -> ${f}` : `${agentName}'s lesson file is not UTF-8 - left as it is, lesson dropped`, "info")
    return
  }
  const res = await writeMemories(output, memDir, existing)
  for (const [verb, slugs] of [["wrote", res.created], ["updated", res.updated], ["archived", res.archived]]) {
    if (slugs.length) say(`${verb} ${slugs.length} memory file(s): ${slugs.join(", ")}`, "info")
  }
}

export const GeneseedLearn = async (ctx) => {
  const { client } = ctx ?? {}
  if (client) LOG_CLIENT = client
  const ours = new Set()       // throwaway distil sessions — never mine our own output
  const timers = new Map()     // sid -> debounce timer, re-armed on each idle
  const inFlight = new Set()   // sid currently being distilled (guards against overlap)
  const lastReply = new Map()  // sid -> id of its newest assistant message (captureTurn)
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

      const fetchMessages = async () => {
        const res = await client.session.messages({ path: { id: sid } })
        return Array.isArray(res) ? res : res?.data ?? []
      }
      // A child's report feedback first: it needs no store, no model and no minimum length. A
      // top-level session keeps the old order (no fetch before the store is known).
      let messages = null
      if (isChild) {
        messages = await fetchMessages()
        await captureSpecFeedback(agentName, finalAssistantText(messages), await notesRootsOf(PLUGIN_DIR, root), undefined, SKILLS_DIR)
        await recordAgentRun(sid, agentName, messages, undefined, [ctx?.directory, ctx?.worktree])
      }

      const memDir = await resolveMemoryDir()
      if (!memDir) {
        if (!warnedNoDir) {
          warnedNoDir = true
          say(
            "no memory dir — this install has no memory/ folder, and neither does the shared tier or this repo."
          )
        }
        return
      }

      let { notes, model } = flatten(messages ?? (await fetchMessages()))
      if (notes.length < MIN_NOTES_CHARS) return
      notes = notes.slice(-MAX_NOTES_CHARS)
      model = model ?? envModel()
      if (!model) {
        say(
          "could not determine a model — set $GENESEED_MODEL=provider/model."
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
        say("session.create returned no id — skipping this distil.")
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
      say(`skipped: ${err?.message ?? err}`)
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
      // The newest assistant message per session, for the turn's capture (`message.updated`'s
      // `info` is the Message: `id`, `role`, `sessionID`).
      if (event.type === "message.updated") {
        const info = event.properties?.info
        if (info?.role === "assistant" && info.sessionID && info.id) lastReply.set(info.sessionID, info.id)
        return
      }
      if (event.type === "session.deleted") {
        const t = timers.get(sid)
        if (t) clearTimeout(t)
        timers.delete(sid)
        ours.delete(sid)
        lastReply.delete(sid)
        return
      }
      if (event.type !== "session.idle") return
      if (!sid || ours.has(sid)) return
      // A skill's feedback line, now (captureTurn): not behind the debounce below.
      // One message, not the session: the newest assistant message `message.updated` named, read
      // by `session.message`. With none seen (a plugin loaded mid-turn), the whole history once.
      void captureTurn(async () => {
        const mid = lastReply.get(sid)
        if (mid && client.session.message) {
          const one = await client.session.message({ path: { id: sid, messageID: mid } })
          const m = one?.data ?? one
          return m ? [m] : []
        }
        const res = await client.session.messages({ path: { id: sid } })
        return Array.isArray(res) ? res : res?.data ?? []
      }, root)
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
Object.assign(GeneseedLearn, {
  resolveMemoryDir, writeMemories, resolveAgentName, appendAgentLesson, flattenV2,
  captureSpecFeedback, captureTurn, finalAssistantText, notesRootsOf, FEEDBACK_SECRET_RE,
  recordAgentRun, toolCounts, isRefusal, specHashOf, agentRunLine,
})

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

      // As on V1: a child is read first for its report feedback, a top-level session keeps the old order.
      let messages = null
      if (isChild) {
        messages = await ctx.session.context({ sessionID: sid })
        await captureSpecFeedback(agentName, finalAssistantText(messages), await notesRootsOf(PLUGIN_DIR, root), undefined, SKILLS_DIR)
        await recordAgentRun(sid, agentName, messages, undefined, [ctx?.location?.directory, ctx?.location?.project?.directory])
      }

      const memDir = await resolveMemoryDir()
      if (!memDir) {
        if (!warnedNoDir) {
          warnedNoDir = true
          say("no memory dir — this install has no memory/ folder, and neither does the shared tier or this repo.")
        }
        return
      }

      let { notes, model } = flattenV2(messages ?? (await ctx.session.context({ sessionID: sid })))
      if (notes.length < MIN_NOTES_CHARS) return
      notes = notes.slice(-MAX_NOTES_CHARS)
      if (!model) {
        const env = envModel()
        model = env ? { providerID: env.providerID, id: env.modelID } : null
      }
      if (!model) {
        say("could not determine a model — set $GENESEED_MODEL=provider/model.")
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
      say(`skipped: ${err?.message ?? err}`)
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
      // Fire and forget: an await here would hold the event stream the distil reads too.
      void captureTurn(() => ctx.session.context({ sessionID: sid }), root)
      const prev = timers.get(sid)
      if (prev) clearTimeout(prev)
      timers.set(sid, setTimeout(() => { timers.delete(sid); runDistill(sid) }, DEBOUNCE_MS))
    }
  })().catch((err) => say(`event stream ended: ${err?.message ?? err}`))
  return () => {
    controller.abort()
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
  }
}

export default { id: "geneseed-learn", server: GeneseedLearn, setup: setupV2 }
