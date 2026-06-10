// Geneseed — OpenCode runtime guard plugin.
//
// Enforces the safety Laws at the tool boundary (`tool.execute.before`), the same
// "enforce by injection, don't just instruct" stance as the context plugin:
//   - Law I  (Sealed Secrets):  block writes to private-key / credential files.
//   - Law IV (Deletion Is Deliberate):  block catastrophic shell commands.
// High-confidence patterns only, so legitimate work is never caught. Borderline cases
// (.env edits, force-push) are WARNED, not blocked.
//
// GENESEED_GUARD=off    disable entirely.
// GENESEED_GUARD=warn   downgrade every block to a warning (log, but allow).
//
// Install: dropped into the plugins dir by `build --emit opencode[-global]` (the *.js
// glob), exactly like the context and learn plugins. Errors never break a tool call.

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

export const GeneseedGuard = async () => {
  return {
    "tool.execute.before": async (input, output) => {
      if (OFF) return
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
