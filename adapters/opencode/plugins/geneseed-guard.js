// Geneseed — OpenCode runtime guard plugin.
//
// Enforces the safety Laws at the tool boundary (`tool.execute.before`), the same
// "enforce by injection, don't just instruct" stance as the context plugin:
//   - Law I  (Sealed Secrets):  block writes to private-key / credential files.
//   - Law IV (Deletion Is Deliberate):  block catastrophic shell commands.
//   - Wiki (AGENT.md §7):  block mutations under a declared wiki's `protected`
//     folders — the user's knowledge base sets its own no-go zones in wiki.jsonc.
// High-confidence patterns only, so legitimate work is never caught. Borderline cases
// (.env edits, force-push) are WARNED, not blocked.
//
// GENESEED_GUARD=off    disable entirely.
// GENESEED_GUARD=warn   downgrade every block to a warning (log, but allow).
//
// Install: dropped into the plugins dir by `build --emit opencode[-global]` (the *.js
// glob), exactly like the context and learn plugins. Errors never break a tool call.

import { promises as fs } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url))

// Sovereign-repo bypass — twin of sovereign_bypass() in rituals/_harness_context.py.
// <cfg>/excludes.json (user-owned, managed by `harness exclude`) lists folders where
// this GLOBAL install goes dormant. Any error degrades to "not excluded".
const norm = (p) => {
  let s = path.resolve(String(p))
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
  /\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+(--no-preserve-root\s+)?\/(\s|$)/, // rm -rf /
  /\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+~(\/)?(\s|$)/,                     // rm -rf ~
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

// ---- protected wiki folders (AGENT.md §7) --------------------------------------
// wiki.jsonc (the machine-level knowledge-base manifest) may list `protected` folders
// per wiki. Mutating anything under one is denied. Same resolution chain as the
// context plugin: $GENESEED_WIKI -> $GENESEED_HARNESS/wiki.jsonc -> beside the install.
async function isFile(p) { try { return (await fs.stat(p)).isFile() } catch { return false } }

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

// Mutation-class tools for the wiki check — wider than WRITE_TOOLS because moving,
// renaming, or deleting a protected note is as destructive as overwriting it. Same
// substring stance: over-matching the class is harmless (see WRITE_TOOLS note).
const WIKI_MUTATE_TOOLS = [...WRITE_TOOLS, "delete", "remove", "rename", "move", "trash"]

export const GeneseedGuard = async () => {
  return {
    "tool.execute.before": async (input, output) => {
      if (OFF) return
      if (await sovereignBypass(process.cwd())) return
      const tool = (input?.tool || input?.name || "").toLowerCase()
      const args = output?.args || input?.args || {}
      const deny = (why) => {
        if (WARN_ONLY) { log(`WARN (would block): ${why}`); return false }
        log(`BLOCKED: ${why}`)
        throw new Error(`[geneseed-guard] blocked: ${why} — set GENESEED_GUARD=off to allow`)
      }
      try {
        if (hasAny(tool, WRITE_TOOLS)) {
          const p = pickPath(args)
          if (p && SECRET_RE.some((re) => re.test(p))) { deny(`write to secret/key file ${p} (Law I)`); return }
          if (p && SECRET_WARN_RE.some((re) => re.test(p))) log(`WARN: writing ${p} — keep secrets out of tracked files (Law I)`)
        }
        if (hasAny(tool, WIKI_MUTATE_TOOLS)) {
          const p = pickPath(args)
          if (p) {
            const abs = (path.isAbsolute(p) ? p : path.resolve(p)).replace(/\\/g, "/").toLowerCase()
            const hit = (await protectedPrefixes()).find(
              (x) => abs.startsWith(x.prefix) || abs === x.prefix.slice(0, -1))
            if (hit) { deny(`mutation in protected wiki folder — ${hit.label} (AGENT.md §7)`); return }
          }
        }
        // NOT else-if: a compound tool name (e.g. exec_and_save) can match both
        // classes, and the shell check must still run after the write check.
        if (hasAny(tool, SHELL_TOOLS)) {
          const c = pickCommand(args)
          if (c && SHELL_BLOCK_RE.some((re) => re.test(c))) { deny(`catastrophic command (Law IV): ${c.slice(0, 80)}`); return }
          if (c && SHELL_WARN_RE.some((re) => re.test(c))) log(`WARN: irreversible op — confirm intent (Law IV): ${c.slice(0, 80)}`)
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
