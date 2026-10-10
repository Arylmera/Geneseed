// Geneseed — OpenCode runtime guard plugin.
//
// Enforces the safety Laws at the tool boundary (`tool.execute.before`), the same
// "enforce by injection, don't just instruct" stance as the context plugin:
//   - Sealed Secrets:  block writes to private-key / credential files.
//   - Deletion Is Deliberate:  block catastrophic shell commands.
//   - Persist Insight (rule vs memory):  speed-bump the first write to user-rules.md
//     memory file — that choice belongs to the user, via the rule skill.
//   - Wiki (AGENT.md §8):  block mutations under a declared wiki's `protected`
//     folders — the user's knowledge base sets its own no-go zones in geneseed-wiki.jsonc.
// High-confidence patterns only, so legitimate work is never caught. Borderline cases
// (.env edits, force-push) are WARNED, not blocked.
//
// GENESEED_GUARD=off    disable entirely.
// GENESEED_GUARD=warn   downgrade every block to a warning (log, but allow).
//
// Install: dropped into the plugins dir by `build --emit opencode[-global]` (the *.js
// glob), exactly like the context and learn plugins. Errors never break a tool call.
//
// No `permission.ask` hook (OpenCode verdict I-2). Upstream declares one in its plugin
// types but never triggers it: `Permission.ask` evaluates the rules and publishes the
// `permission.asked` bus event with no plugin hook in between. The loop/* exemption this
// plugin once hung there (downgrade the static `git commit*`/`git push*` ask to allow on a
// launched loop branch, the twin of js/hosts/hooks.mjs's `loopExempt`) therefore never ran,
// and is gone. Lost behaviour, stated plainly: an OpenCode loop gets the static ask on every
// commit and push. That fails safe — one prompt, never a silent allow. The `permission.asked`
// event + SDK reply route was not taken: it races the TUI's own prompt and is unverified from
// inside a plugin. The upgrade path is a session-level `permission` ruleset set by the loop
// launcher when it creates the loop session (`session.create` accepts one) allowing exactly
// its `git push <remote> HEAD:<branch>` form.

import { promises as fs, realpathSync, existsSync, readFileSync } from "node:fs"
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

// Twin of js/hosts/hooks.mjs's SECRET_RE (Law I's boundary half) — scans WRITE CONTENT for a
// credential-shaped string, not the target path (SECRET_RE above is the path twin, file names
// only). High-precision vendor prefixes only, same rationale as the Node side: a generic
// "looks like entropy" scan fires on every hash and lockfile. Kept byte-identical by the parity
// test in tests/plugins/guard.test.mjs — simple enough to literally diff, unlike SHELL_WARN_RE's
// hand-mirrored git acts. `.env*` is exempt (SECRET_WARN_RE above already names it as where a
// secret may legitimately live) via the same path check used for the WARN tier.
const SECRET_CONTENT_RE =
  /\b(?:AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-ant-[A-Za-z0-9_-]{20,}|xox[abprs]-[0-9A-Za-z-]{10,})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/

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
// History-rewriting / irreversible git ops (Deletion Is Deliberate) → WARN, never BLOCK:
// `tool.execute.before` has no ask tier, so these are a speed bump rather than a wall. The
// same acts js/hosts/hooks.mjs's `DESTRUCTIVE_GIT_RE` asks about — mirrored by hand rather
// than shared, since this plugin is copied whole into an OpenCode install, outside this
// repo's module graph. `clean`
// and `--delete` need `--force` alongside them to count, EITHER order (`--force --delete` is
// the same act as `--delete --force`) — an un-forced `clean`/`branch --delete` already refuses
// or only removes what is reproducible. `-D --force`/`--delete -f`/`-d --force`/`-df` are the
// same act again and are a known ceiling this does not chase. `git switch -h` lists `-f,
// --force` and `--discard-changes` as two SEPARATE options, not one flag's long/short spelling,
// so both are listed. `restore` and `stash drop`/`clear` are anchored to the VERB position
// (`\bgit\s+restore\b`, not `\bgit\s+.*restore\b`) — every other row needs a flag that is
// vanishingly unlikely in a commit message or filename, but `restore` needs none and
// `drop`/`clear` are ordinary English, so a message like "restore working behavior" or "clear
// old state" must never warn. `restore` matches UNLESS `--staged` appears on the line, EXCEPT
// `--staged --worktree` together, which restores the working tree too and so discards exactly
// like plain `restore` (see the twin rationale and tests in js/hosts/hooks.mjs).
const SHELL_WARN_RE = [
  /\bgit\s+push\b[^\n]*(--force\b|-f\b|\+\S|\s--delete\b|\s:\S)/,   // forced, mirror, or delete push
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\b[^\n]*\s(-[a-zA-Z]*f|--force\b)/,
  /\bgit\s+branch\b[^\n]*\s(-D\b|--delete\b[^\n]*--force\b|--force\b[^\n]*--delete\b)/,
  /\bgit\s+checkout\s+--\s/,
  /\bgit\s+checkout\b[^\n]*\s(-[a-zA-Z]*f\b|--force\b)/,
  /\bgit\s+switch\b[^\n]*\s(-[a-zA-Z]*f\b|--force\b|--discard-changes\b)/,
  /\bgit\s+restore\b(?:(?![^\n]*--staged\b)|(?=[^\n]*--staged\b)(?=[^\n]*--worktree\b))/,
  /\bgit\s+stash\s+(drop|clear)\b/,
  /\bgit\s+worktree\b[^\n]*\bremove\b[^\n]*(-[a-zA-Z]*f\b|--force\b)/,
  /\bgit\s+reflog\b[^\n]*\bexpire\b/,
  /\bgit\s+gc\b[^\n]*--prune\b/,
]

// `apply_patch`'s only argument is `patchText` (OpenCode verdict I-1): every gpt-5*
// model gets ONLY this tool, never `edit`/`write`, so a path that lives inside the
// patch text — not in `filePath`/`path`/etc — must still hit every gate below, or
// Sealed Secrets, the protected-check gate, the rule store and the wiki gate all go
// dark for that model class. Markers match upstream's own parser
// (`packages/opencode/src/patch/index.ts` `parsePatchHeader`): `*** Add File:`,
// `*** Update File:` (optionally followed by `*** Move to:`, both the old and the new
// path count) and `*** Delete File:`. The `+`-prefixed body lines are the new file
// content, never a path, and are not scanned here — no gate in this file inspects
// write content, only the target path.
function parsePatchPaths(patchText) {
  const out = []
  const lines = String(patchText).split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    let m = /^\*\*\* (?:Add|Delete) File:\s*(.+)$/.exec(line)
    if (m) { out.push(m[1].trim()); continue }
    m = /^\*\*\* Update File:\s*(.+)$/.exec(line)
    if (m) {
      out.push(m[1].trim())
      const mv = /^\*\*\* Move to:\s*(.+)$/.exec(lines[i + 1] || "")
      if (mv) { out.push(mv[1].trim()); i++ }
    }
  }
  return out.filter(Boolean)
}

// Returns every candidate path for this call, normalized (backslashes -> `/`) and,
// for an `apply_patch` call, resolved against `cwd` (the session's `ctx.directory` —
// the same root `apply_patch.ts:72` resolves against upstream) since a patch marker
// is worktree-relative. Non-patch tools keep the single-path shape every other gate
// already expects, just wrapped in an array.
function pickPath(args, cwd) {
  if (args && typeof args.patchText === "string") {
    return parsePatchPaths(args.patchText)
      .map((p) => path.resolve(cwd || process.cwd(), p).replace(/\\/g, "/"))
  }
  for (const k of ["filePath", "path", "file", "target", "filename"]) {
    // Normalize Windows backslashes to `/` so the secret-path patterns (which use `/`
    // as the segment separator) match `C:\Users\me\.ssh\id_rsa` the same as a POSIX path.
    if (args && typeof args[k] === "string") return [args[k].replace(/\\/g, "/")]
  }
  return []
}
// The content a write/edit/apply_patch call would actually land on disk — what the content
// secret scan runs against. `write` carries `content`, `edit` carries `newString`
// (OpenCode tool Parameters, packages/opencode/src/tool/{write,edit}.ts). For `apply_patch`
// only the `+`-prefixed hunk lines are NEW content — a `-` line is text being REMOVED, so a
// secret there is leaving the file, not landing in it, and must not block the call.
function pickAddedContent(args) {
  if (args && typeof args.patchText === "string") {
    return String(args.patchText).split(/\r?\n/)
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
      .map((l) => l.slice(1))
      .join("\n")
  }
  if (args && typeof args.content === "string") return args.content
  if (args && typeof args.newString === "string") return args.newString
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
// geneseed-wiki.jsonc (the machine-level knowledge-base manifest) may list `protected` folders
// per wiki. Mutating anything under one is denied. Same resolution chain as the
// context plugin: $GENESEED_WIKI -> $GENESEED_HARNESS/geneseed-wiki.jsonc -> beside the install.
async function isFile(p) { try { return (await fs.stat(p)).isFile() } catch { return false } }
async function isDir(p) { try { return (await fs.stat(p)).isDirectory() } catch { return false } }

// The wiki manifest is JSONC (the seeded stub carries a commented example): strip // and
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
    // wiki.jsonc and wiki.json are the legacy names from earlier seeds — still honoured.
    for (const name of ["geneseed-wiki.jsonc", "wiki.jsonc", "wiki.json"]) {
      const p = path.join(base, name)
      if (await isFile(p)) return p
    }
  }
  return null
}

// Cached absolute prefixes, refreshed on a short TTL so a manifest edit lands
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

// ---- protected checks (External Gate) ------------------------------------------
// Twin of js/hosts/hooks.mjs's `protectedCheck` — keep in step. A project lists the checks its agent
// must not edit in `.geneseed/protected-checks.txt` at its git root, one repo-relative path per
// line; the list protects itself. Found from the WRITE TARGET up to the first `.git`, re-read on
// every write (a short file, read only on a write call). No ask tier here, so a hit is a deny.
const SENSOR_LIST = ".geneseed/protected-checks.txt"
function protectedCheck(p) {
  try {
    const target = path.resolve(p)
    let root = path.dirname(target)
    while (!existsSync(path.join(root, ".git"))) {
      const up = path.dirname(root)
      if (up === root) return null
      root = up
    }
    const text = readFileSync(path.join(root, SENSOR_LIST), "utf8")
    const fold = (s) => nocase(s.replace(/\\/g, "/"))
    const rel = fold(path.relative(root, target))
    const entries = [SENSOR_LIST, ...text.split(/\r?\n/).map((l) => l.trim().replace(/[\\/]+$/, ""))
      .filter((l) => l && !l.startsWith("#"))]
    return entries.find((e) => rel === fold(e) || rel.startsWith(fold(e) + "/")) ?? null
  } catch {
    return null // no list (the common case) or an unreadable one: nothing is protected
  }
}

// Mutation-class tools for the wiki check — wider than WRITE_TOOLS because moving,
// renaming, or deleting a protected note is as destructive as overwriting it. Same
// substring stance: over-matching the class is harmless (see WRITE_TOOLS note).
const WIKI_MUTATE_TOOLS = [...WRITE_TOOLS, "delete", "remove", "rename", "move", "trash"]

export const GeneseedGuard = async (ctx) => {
  // The session's working directory, the same resolution the context plugin uses.
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
        // `apply_patch`'s own tool resolves every marker path against `instance.directory`
        // (`apply_patch.ts:72` in the verdict's evidence), NOT the worktree root `root()`
        // uses for the sovereign-repo bypass above — a worktree session started in a
        // subdirectory of its git root must see the same (narrower) root the write
        // actually lands under, or a protected-check/wiki/secret hit one directory up
        // would be missed.
        const cwd = ctx?.directory || process.cwd()
        if (hasAny(tool, WRITE_TOOLS)) {
          // `apply_patch` (gpt-5*) can carry several marker paths in one call — every
          // one of them is a write target, so every one runs every gate; the first hit
          // blocks the whole call (see `pickPath` for why this is not a single path).
          const paths = pickPath(args, cwd)
          for (const p of paths) {
            if (SECRET_RE.some((re) => re.test(p))) { await deny(`write to secret/key file ${p} (Sealed Secrets)`, "law-1"); return }
            if (SECRET_WARN_RE.some((re) => re.test(p))) log(`WARN: writing ${p} — keep secrets out of tracked files (Sealed Secrets)`)
            const sensor = protectedCheck(p)
            if (sensor) { await deny(`${p} is a protected check (${sensor}, listed in ${SENSOR_LIST}) — a check the agent can edit is not a check (External Gate)`, "rigor-5"); return }
            const store = ruleStoreTarget(p)
            if (store && !RULE_STORE_BUMPED.has(p)) {
              RULE_STORE_BUMPED.add(p)
              await deny(`writing to ${store} — a standing rule, or a fact to remember? That ` +
                   `choice is the user's (Persist Insight). Settle it through the rule skill, ` +
                   `then re-issue this write`, "process-1")
              return
            }
          }
          // Content scan (Sealed Secrets, the twin of js/hosts/hooks.mjs's ruleDecide): skipped
          // when the target is itself a `.env*` file, same exemption as the path WARN tier above.
          const added = pickAddedContent(args)
          if (added && !paths.some((p) => SECRET_WARN_RE.some((re) => re.test(p))) && SECRET_CONTENT_RE.test(added)) {
            await deny("write would carry a credential-shaped string (Sealed Secrets) — secrets "
              + "live in .env or a secret manager, never in a tracked file", "law-1")
            return
          }
        }
        if (hasAny(tool, WIKI_MUTATE_TOOLS)) {
          for (const p of pickPath(args, cwd)) {
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
  }
}

export default GeneseedGuard
