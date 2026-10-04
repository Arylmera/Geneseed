// Geneseed — OpenCode runtime guard plugin.
//
// Enforces the safety Laws at the tool boundary (`tool.execute.before`), the same
// "enforce by injection, don't just instruct" stance as the context plugin:
//   - Sealed Secrets:  block writes to private-key / credential files.
//   - Deletion Is Deliberate:  block catastrophic shell commands.
//   - Persist Insight (rule vs memory):  speed-bump the first write to user-rules.md
//     memory file — that choice belongs to the user, via the rule skill.
//   - Wiki (AGENT.md §8):  block mutations under a declared wiki's `protected`
//     folders — the user's knowledge base sets its own no-go zones in wiki.jsonc.
// High-confidence patterns only, so legitimate work is never caught. Borderline cases
// (.env edits, force-push) are WARNED, not blocked.
//
// GENESEED_GUARD=off    disable entirely.
// GENESEED_GUARD=warn   downgrade every block to a warning (log, but allow).
//
// Install: dropped into the plugins dir by `build --emit opencode[-global]` (the *.js
// glob), exactly like the context and learn plugins. Errors never break a tool call.
//
// `permission.ask` — the loop/* exemption (Consent Before Push). OpenCode's static
// `permission.bash` globs (`git commit*`/`git push*` = "ask", written by
// js/hosts/settings.mjs) cannot see which branch is checked out — they are a build-time
// string match with no request-time context. This hook is the ONLY seam where Geneseed can
// look at the live branch, and it only DOWNGRADES an ask to allow: only a fixed set of
// commit/push forms (see `loopExempt` below, the twin of js/hosts/hooks.mjs's) on a `loop/*`
// branch a loop was actually LAUNCHED on — not just named `loop/...`. It is a WHITELIST, not
// a blacklist: a false ask costs one prompt, a false allow publishes. It never raises the
// bar: anything not on the whitelist, anything off a launched loop branch, a status this hook
// did not itself leave as the default "ask", or any non-bash permission leaves `output.status`
// untouched and OpenCode's own ask (or another hook's deny) stands. A host version that never
// fires `permission.ask` simply never reaches this hook — the static ask still fires, so the
// failure mode is one extra prompt, never a silent allow.

import { promises as fs, existsSync, statSync, lstatSync, readFileSync, openSync, readSync, closeSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))

// Sovereign-repo bypass — twin of the harness's own `sovereignBypass()`.
// <cfg>/excludes.json (user-owned, managed by `harness exclude`) lists folders where
// this GLOBAL install goes dormant. Any error degrades to "not excluded".
const norm = (p) => {
  // Expand a leading "~" / "~/…" to the home dir — a hand-edited excludes.json entry
  // like "~/vault" must resolve the same way here as it does for the Claude/Bob
  // hook guard.
  let raw = String(p)
  if (raw === "~" || raw.startsWith("~/") || raw.startsWith("~\\")) {
    raw = raw === "~" ? homedir() : path.join(homedir(), raw.slice(2))
  }
  let s = path.resolve(raw)
  return process.platform === "win32" ? s.toLowerCase() : s
}
async function sovereignBypass(cwd) {
  try {
    const cfg = path.dirname(PLUGIN_DIR)           // plugins/ sits directly in <cfg>
    const raw = await fs.readFile(path.join(cfg, "excludes.json"), "utf8")
    const entries = (JSON.parse(raw).excludes) || []
    const here = norm(cwd || process.cwd())
    for (const e of entries) {
      const p = typeof e === "string" ? e : e && e.path
      if (typeof p !== "string" || !p.trim()) continue
      const base = norm(p.trim()).replace(/[\\/]+$/, "")
      if (here === base || here.startsWith(base + path.sep)) return true
    }
  } catch { /* degrade to active */ }
  return false
}

const MODE = (process.env.GENESEED_GUARD || "on").toLowerCase()
const OFF = ["off", "0", "false", "no"].includes(MODE)
const WARN_ONLY = MODE === "warn"

function log(msg) { console.error(`[geneseed-guard] ${msg}`) }

// ---- the gate ledger ------------------------------------------------------------
// The twin of `ledger()` in js/hosts/hooks.mjs: one JSON line per BLOCK into
// `<cfg>/notebook/gates.jsonl`, the rule and never the content, so `geneseed status` can
// count what the boundary actually caught on an OpenCode install too. Until this the
// recommended install was the one with no gate evidence at all. A warning is not recorded
// (nothing was refused) and neither is `GENESEED_GUARD=warn`. `notebook/` is never created
// here — an install without one (or a test importing this file) records nothing. Capped
// at the newest MAX_LEDGER_LINES like the hook's; never throws, never decides.
const MAX_LEDGER_LINES = 1000
async function ledger(rule) {
  try {
    const bases = []
    if (process.env.GENESEED_HARNESS) bases.push(process.env.GENESEED_HARNESS)
    bases.push(path.dirname(PLUGIN_DIR))
    for (const base of bases) {
      const dir = path.join(base, "notebook")
      if (!(await isDir(dir))) continue
      const file = path.join(dir, "gates.jsonl")
      await fs.appendFile(file, `${JSON.stringify({
        ts: new Date().toISOString(), verb: "guard", rule, cwd: process.cwd(),
      })}\n`)
      const lines = (await fs.readFile(file, "utf8")).split("\n").filter(Boolean)
      if (lines.length > MAX_LEDGER_LINES) {
        await fs.writeFile(file, `${lines.slice(-MAX_LEDGER_LINES).join("\n")}\n`)
      }
      return
    }
  } catch { /* the ledger never decides */ }
}

// Files the agent must not write (secrets / private keys) → BLOCK.
const SECRET_RE = [
  /(^|\/)id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$/i,
  /\.(pem|key|p12|pfx|kdbx|keystore|jks)$/i,
  /(^|\/)\.aws\/credentials$/i,
  /(^|\/)\.ssh\//i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)\.pypirc$/i,
]
// .env files are often edited legitimately → WARN, don't hard-block.
const SECRET_WARN_RE = [/(^|\/)\.env(\.[\w.-]+)?$/i]

// Catastrophic, effectively irreversible shell → BLOCK. Both Unix and Windows shells,
// since OpenCode runs natively on Windows and the agent may emit cmd / PowerShell.
const SHELL_BLOCK_RE = [
  // rm -rf /, ~, /*, ~/* — flags may be split (-r -f), long (--recursive), or end with
  // `--`; the lookahead insists one of them recurses. The target must be the root or
  // home itself (optionally globbed), so `rm -rf /tmp/x` and `rm -rf ./build` pass.
  /\brm\s+(?=(?:(?:-[a-zA-Z]+|--[a-z-]*)\s+)*?(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\s)(?:(?:-[a-zA-Z]+|--[a-z-]*)\s+)+(?:\/|~\/?)\*?(\s|$)/,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,                         // fork bomb
  /\bmkfs\.\w+\s+\/dev\//,                                            // format a device
  /\bdd\b[^\n]*\bof=\/dev\/(sd|nvme|hd|disk)/,                        // dd over a raw disk
  /\bformat\s+[a-z]:/i,                                              // Windows: format a drive
  /\b(rmdir|rd)\b[^\n]*\/s\b[^\n]*\b[a-z]:[\\/]?(\s|"|$)/i,          // Windows: rd /s /q C:\
  /\bdel\b[^\n]*\/s\b[^\n]*\b[a-z]:[\\/]?(\s|"|$)/i,                 // Windows: del /s /q C:\
  /\bremove-item\b[^\n]*-recurse\b[^\n]*-force\b/i,                  // PowerShell rm -rf
  /\bremove-item\b[^\n]*-force\b[^\n]*-recurse\b/i,                  // (either flag order)
]
// History-rewriting / irreversible git ops → WARN.
const SHELL_WARN_RE = [/\bgit\s+push\b[^\n]*(--force\b|-f\b)/, /\bgit\s+reset\s+--hard\b/]

function pickPath(args) {
  for (const k of ["filePath", "path", "file", "target", "filename"]) {
    // Normalize Windows backslashes to `/` so the secret-path patterns (which use `/`
    // as the segment separator) match `C:\Users\me\.ssh\id_rsa` the same as a POSIX path.
    if (args && typeof args[k] === "string") return args[k].replace(/\\/g, "/")
  }
  return ""
}
function pickCommand(args) {
  for (const k of ["command", "cmd", "script"]) {
    if (args && typeof args[k] === "string") return args[k]
  }
  return ""
}

// Tool-name classes, matched as SUBSTRINGS so a host's variant names
// (write_file, str_replace_editor, apply_patch, run_command, execute_bash, …) are
// still covered as the tool surface evolves. Over-matching the class is harmless:
// the inner guards act only when a real path/command argument is present AND matches
// a high-confidence secret/catastrophe pattern, so a misclassified tool with no such
// argument simply does nothing.
const WRITE_TOOLS = ["write", "edit", "patch", "create", "save", "insert", "replace"]
const SHELL_TOOLS = ["bash", "shell", "exec", "command", "terminal", "run"]
const hasAny = (name, parts) => parts.some((s) => name.includes(s))

// ---- protected wiki folders (AGENT.md §8) --------------------------------------
// wiki.jsonc (the machine-level knowledge-base manifest) may list `protected` folders
// per wiki. Mutating anything under one is denied. Same resolution chain as the
// context plugin: $GENESEED_WIKI -> $GENESEED_HARNESS/wiki.jsonc -> beside the install.
async function isFile(p) { try { return (await fs.stat(p)).isFile() } catch { return false } }
async function isDir(p) { try { return (await fs.stat(p)).isDirectory() } catch { return false } }

// wiki.jsonc is JSONC (the seeded stub carries a commented example): strip // and
// /* */ comments plus trailing commas before parsing — string-aware, so quoted
// "https://…" or "C:/…" values are untouched. Kept in sync with the context plugin's
// copy (plugins stay self-contained, like the other shared helpers).
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

async function wikiFile() {
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

// Cached absolute prefixes, refreshed on a short TTL so a wiki.jsonc edit lands
// without a restart. Compared slash-normalized and case-insensitive — vault paths on
// Windows and macOS are case-insensitive in practice, and for a guard the rare
// case-only over-match is the safe direction.
let _prot = { at: 0, prefixes: [] }
const PROT_TTL_MS = 30000
async function protectedPrefixes() {
  const now = Date.now()
  if (now - _prot.at < PROT_TTL_MS) return _prot.prefixes
  const prefixes = []
  try {
    const file = await wikiFile()
    if (file) {
      const data = JSON.parse(stripJsonc(await fs.readFile(file, "utf8")))
      for (const w of Array.isArray(data?.wikis) ? data.wikis : []) {
        if (!w?.path || !Array.isArray(w.protected)) continue
        for (const d of w.protected) {
          if (typeof d !== "string" || !d) continue
          const abs = path.resolve(w.path, d).replace(/\\/g, "/").replace(/\/+$/, "")
          prefixes.push({ prefix: abs.toLowerCase() + "/",
                          label: `${w.name || path.basename(w.path)}: ${d}` })
        }
      }
    }
  } catch { /* unreadable manifest = no extra protection; never break a tool call */ }
  _prot = { at: now, prefixes }
  return prefixes
}

// ---- the rule / memory stores (Persist Insight) --------------------------------
// Whether something the user wants kept is a standing rule or a durable fact is THEIR
// call, settled through the rule skill. `tool.execute.before` can only allow or throw —
// it has no "ask the user" tier like the Claude/Bob rule-gate hook —
// so this is a SPEED BUMP, not a wall: the first write to a given path is refused with
// the Law and the skill named, and a re-issued write goes through. One beat of
// reconsideration, and a legitimate write is never trapped.
//
// Install folder and file names are theme-independent by design, so the match is on
// literal names. `user-rules.md` / `MEMORY.md` are Geneseed's own coinage and match
// anywhere; other markdown matches only inside this install's own memory/ dir, so a
// project's unrelated memory/ folder is never caught.
const RULE_STORE_BUMPED = new Set()
const nocase = (s) => (process.platform === "win32" ? s.toLowerCase() : s)
function ruleStoreTarget(p) {
  const abs = (path.isAbsolute(p) ? p : path.resolve(p)).replace(/\\/g, "/")
  const base = path.basename(abs).toLowerCase()
  if (base === "user-rules.md") return "user-rules.md"
  if (base === "memory.md") return "the memory index"
  if (!base.endsWith(".md")) return null
  const mem = path.join(path.dirname(PLUGIN_DIR), "memory").replace(/\\/g, "/")
  return nocase(abs).startsWith(nocase(mem) + "/") ? "memory" : null
}

// Mutation-class tools for the wiki check — wider than WRITE_TOOLS because moving,
// renaming, or deleting a protected note is as destructive as overwriting it. Same
// substring stance: over-matching the class is harmless (see WRITE_TOOLS note).
const WIKI_MUTATE_TOOLS = [...WRITE_TOOLS, "delete", "remove", "rename", "move", "trash"]

// ---- the loop/* exemption (Consent Before Push) --------------------------------
// Twin of js/hosts/gitref.mjs (currentBranch/loopLaunched) and js/hosts/hooks.mjs's
// git-gate (the rest) — keep in step. Node's native sync `fs` (not the `fs.promises`
// import above): a worktree's `.git` is read the same way the Claude/Bob hook reads it, so
// the two decide the exemption identically. This plugin cannot import from `js/` at all
// (it is copied whole into an OpenCode install, outside this repo's module graph), so it
// keeps its own standalone copy rather than the single shared owner the Node side has.

const GIT_GATE_RE = /\bgit\b[^\n]*\b(?:commit|push)\b/

// No newline, backtick, or `$(` substitution anywhere, no `<`/`>` redirect, and no single
// `&` (a shell runs `a & b` as two commands exactly like `a && b`) — these can smuggle a
// second command (or a shared-branch target) past every check below. `(?<!&)&(?!&)` matches
// a lone `&` without matching either half of a doubled `&&`.
const UNSAFE_CHARS_RE = /[\n`<>]|\$\(|(?<!&)&(?!&)/

// The only three git shapes a loop's own automation ever needs — see js/hosts/hooks.mjs's
// identically-named constants for the full rationale. The token class `[\w./:@^~=+,-]`
// excludes quotes, braces, `!`, `*`, `$` and `&` — a brace/glob expansion is exactly how a
// shell turns one whitelisted-looking token into several unknown ones, which is also why the
// `-F`/`--file` path uses this same class rather than the looser `[^\s'"]+` it once did: that
// loose class let `git commit -F {m,--amend}` brace-expand into an amend of the last commit.
const ARG_RE = "[\\w./:@^~=+,-]+"
const SEG_ADD_RE = new RegExp(`^git\\s+add(\\s+${ARG_RE})*$`)
const SEG_COMMIT_RE = new RegExp(`^git\\s+commit(\\s+-q)?\\s+(-F\\s+|--file[=\\s])${ARG_RE}(\\s+-q)?$`)
const SEG_READONLY_RE = new RegExp(`^git\\s+(status|diff|log|rev-parse|show)(\\s+${ARG_RE})*$`)

/**
 * `git push`, exactly: `[-u|--set-upstream] <remote> HEAD:<branch>` or
 * `HEAD:refs/heads/<branch>` — the ONLY exempt form, same as js/hosts/hooks.mjs's
 * `pushSegmentOk`. An explicit refspec is immune to `push.default`/`remote.*.push`
 * redirection and refuses to coexist with a mirror/`+`/`:`-prefixed form; nothing else is.
 */
function pushSegmentOk(seg, branch) {
  const m = /^git\s+push(?:\s+(.*))?$/.exec(seg)
  if (!m) return false
  const rest = (m[1] || "").trim()
  if (!rest) return false
  const tokens = rest.split(/\s+/)
  let i = 0
  if (tokens[i] === "-u" || tokens[i] === "--set-upstream") i += 1
  const remote = tokens[i]
  if (remote === undefined || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)) return false
  i += 1
  const ref = tokens[i]
  i += 1
  if (ref === undefined || i !== tokens.length) return false
  return ref === `HEAD:${branch}` || ref === `HEAD:refs/heads/${branch}`
}

const LOOP_STATE_MARKER = "<!-- loop-state:begin -->"

/**
 * Whether `<root>/LOOP.md` carries the engine's state marker — read at most 64 KB.
 * `lstatSync` (never `statSync`, which follows a link) must find an ordinary file: a FIFO
 * would block the read, a symlink could point anywhere outside the repo.
 */
function loopLaunched(gitRoot) {
  let fd
  try {
    const p = path.join(gitRoot, "LOOP.md")
    if (!lstatSync(p).isFile()) return false
    fd = openSync(p, "r")
    const buf = Buffer.alloc(65536)
    const n = readSync(fd, buf, 0, buf.length, 0)
    return buf.toString("utf8", 0, n).includes(LOOP_STATE_MARKER)
  } catch {
    return false
  } finally {
    if (fd !== undefined) { try { closeSync(fd) } catch { /* already gone */ } }
  }
}

/**
 * The branch checked out in `cwd`, and the directory holding `.git` for it, read from
 * .git/HEAD without spawning git — a worktree's `.git` is a FILE naming its gitdir, so both
 * shapes are followed. `{ branch: null, root: null }` on anything unexpected (detached HEAD,
 * no repo, unreadable): the caller then leaves the ask alone.
 */
function currentBranch(cwd) {
  try {
    let dir = path.resolve(cwd)
    for (;;) {
      const dotgit = path.join(dir, ".git")
      if (existsSync(dotgit)) {
        let gitdir = dotgit
        if (statSync(dotgit).isFile()) {
          const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotgit, "utf8"))
          if (!m) return { branch: null, root: null }
          gitdir = path.resolve(dir, m[1])
        }
        const ref = /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(readFileSync(path.join(gitdir, "HEAD"), "utf8"))
        return { branch: ref ? ref[1] : null, root: dir }
      }
      const up = path.dirname(dir)
      if (up === dir) return { branch: null, root: null }
      dir = up
    }
  } catch {
    return { branch: null, root: null }
  }
}

/**
 * Consent Before Push's loop/* exemption — the twin of js/hosts/hooks.mjs's `loopExempt`.
 * True only when the command carries none of the unsafe characters, every `&&`/`;`/`||`/`|`
 * segment is one of the three whitelisted git shapes (every push segment also passing
 * `pushSegmentOk`), and the branch checked out in `cwd` starts with `loop/` AND its git root
 * carries a launched LOOP.md.
 */
function loopExempt(command, cwd) {
  if (typeof command !== "string" || UNSAFE_CHARS_RE.test(command)) return false
  const { branch, root } = currentBranch(cwd)
  if (!branch || !branch.startsWith("loop/")) return false
  if (!root || !loopLaunched(root)) return false
  const segments = command.split(/&&|\|\||[;|]/).map((s) => s.trim()).filter(Boolean)
  if (!segments.length) return false
  return segments.every((seg) => SEG_ADD_RE.test(seg) || SEG_COMMIT_RE.test(seg)
    || SEG_READONLY_RE.test(seg) || pushSegmentOk(seg, branch))
}

export const GeneseedGuard = async (ctx) => {
  // The session's working directory, the same resolution the context plugin uses — a
  // worktree session's `.git` is a FILE, which `currentBranch` already follows.
  const root = () => ctx?.worktree || ctx?.directory || process.cwd()
  return {
    "tool.execute.before": async (input, output) => {
      if (OFF) return
      if (await sovereignBypass(root())) return
      const tool = (input?.tool || input?.name || "").toLowerCase()
      const args = output?.args || input?.args || {}
      // `rule` is the ledger key, spelled as js/hosts/hooks.mjs spells it (`law-1`,
      // `law-4`, `process-1`) plus `wiki`, so status counts one vocabulary across hosts.
      const deny = async (why, rule) => {
        if (WARN_ONLY) { log(`WARN (would block): ${why}`); return false }
        log(`BLOCKED: ${why}`)
        await ledger(rule)
        throw new Error(`[geneseed-guard] blocked: ${why} — set GENESEED_GUARD=off to allow`)
      }
      try {
        if (hasAny(tool, WRITE_TOOLS)) {
          const p = pickPath(args)
          if (p && SECRET_RE.some((re) => re.test(p))) { await deny(`write to secret/key file ${p} (Sealed Secrets)`, "law-1"); return }
          if (p && SECRET_WARN_RE.some((re) => re.test(p))) log(`WARN: writing ${p} — keep secrets out of tracked files (Sealed Secrets)`)
          const store = p && ruleStoreTarget(p)
          if (store && !RULE_STORE_BUMPED.has(p)) {
            RULE_STORE_BUMPED.add(p)
            await deny(`writing to ${store} — a standing rule, or a fact to remember? That ` +
                 `choice is the user's (Persist Insight). Settle it through the rule skill, ` +
                 `then re-issue this write`, "process-1")
            return
          }
        }
        if (hasAny(tool, WIKI_MUTATE_TOOLS)) {
          const p = pickPath(args)
          if (p) {
            const abs = (path.isAbsolute(p) ? p : path.resolve(p)).replace(/\\/g, "/").toLowerCase()
            const hit = (await protectedPrefixes()).find(
              (x) => abs.startsWith(x.prefix) || abs === x.prefix.slice(0, -1))
            if (hit) { await deny(`mutation in protected wiki folder — ${hit.label} (AGENT.md §8)`, "wiki"); return }
          }
        }
        // NOT else-if: a compound tool name (e.g. exec_and_save) can match both
        // classes, and the shell check must still run after the write check.
        if (hasAny(tool, SHELL_TOOLS)) {
          const c = pickCommand(args)
          if (c && SHELL_BLOCK_RE.some((re) => re.test(c))) { await deny(`catastrophic command (Deletion Is Deliberate): ${c.slice(0, 80)}`, "law-4"); return }
          if (c && SHELL_WARN_RE.some((re) => re.test(c))) log(`WARN: irreversible op — confirm intent (Deletion Is Deliberate): ${c.slice(0, 80)}`)
        }
      } catch (err) {
        // Our own deny must propagate; any inspection error must never break a tool call.
        if (err && String(err.message || "").startsWith("[geneseed-guard]")) throw err
        log(`inspect error (ignored): ${err?.message ?? err}`)
      }
    },
    "permission.ask": async (input, output) => {
      // Never throw from a permission hook — leave `output.status` untouched on any
      // error, exactly as a crashed check here must default to the static ask standing.
      try {
        if (OFF) return
        // Never loosen anything but the plain "ask" this hook itself would otherwise leave
        // alone — a deny (or any other status another hook already set) is never overwritten.
        if (output?.status && output.status !== "ask") return
        if (input?.type !== "bash") return
        // ONLY `input.metadata?.command` — no pattern/title fallback. A value this hook did
        // not itself read in full is a value it must not reason about.
        const command = input?.metadata?.command
        if (typeof command !== "string" || !command || !GIT_GATE_RE.test(command)) return
        if (await sovereignBypass(root())) return
        if (loopExempt(command, root())) output.status = "allow"
      } catch { /* leave output.status untouched */ }
    },
  }
}

export default GeneseedGuard
