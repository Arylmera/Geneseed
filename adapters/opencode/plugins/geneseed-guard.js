// Geneseed — OpenCode runtime guard plugin.
//
// Enforces the safety Laws at the tool boundary (`tool.execute.before`), the same
// "enforce by injection, don't just instruct" stance as the context plugin:
//   - Sealed Secrets:  block writes to private-key / credential files, and any write whose
//     added content carries a credential-shaped string (`.env`-shaped targets exempt).
//   - External Gate:  block writes to a check listed in `.geneseed/protected-checks.txt`,
//     and to the done gate's own list `.geneseed/done-checks.txt`.
//   - Deletion Is Deliberate:  block catastrophic shell commands, and every command that would
//     really lose data, judged against the repository's state (`lossReason`, below).
//   - Commands Must Return:  block a recursive scan rooted at a whole filesystem (find /).
//   - Persist Insight (rule vs memory):  a write to user-rules.md or a memory file needs the
//     HOST's own prompt (`permission.edit`; on V2 the `evaluate` hook too); with none, it is refused.
//   - Wiki (AGENT.md §8):  block mutations under a declared wiki's `protected`
//     folders — the user's knowledge base sets its own no-go zones in geneseed-wiki.jsonc.
//   - Ownership:  in an application repo whose root AGENTS.md has no `## Ownership` section,
//     refuse the session's first write once, so the agent proposes the setup first — unless
//     the developer's personal `.geneseed/ownership.md` holds `Setup: declined <date>`.
// High-confidence patterns only, so legitimate work is never caught. Borderline cases
// (.env edits) are WARNED, not blocked. Every block is recorded in the gate
// ledger (`<cfg>/notebook/gates.jsonl`) under the hook's rule key (`law-1`, `rigor-5`,
// `law-4`, `ops-2`, `process-1`, `wiki`, `ownership`); every skill or subagent call, blocked or not, is
// counted in `<cfg>/notebook/usage.jsonl` when that `notebook/` exists and `.usage-off` does not.
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
// and is gone. Lost behaviour, stated plainly: an OpenCode loop's COMMIT gets the static ask
// every time — that fails safe, one prompt, never a silent allow. The `permission.asked`
// event + SDK reply route was not taken: it races the TUI's own prompt and is unverified from
// inside a plugin.
//
// The PUSH half is recovered differently (user decision, 2026-10-10): pushing a `loop/*`
// branch is not pushing `main`/`master`, so it is allowed STATICALLY rather than dynamically —
// js/hosts/settings.mjs's `LOOP_PUSH_ALLOW` wires an unconditional `permission.bash` allow for
// the loop engine's own refspec shapes (`git push [-u] <remote> HEAD:loop/*` and its
// `refs/heads/` spelling), ordered so a force push, a `+refspec`, or a `--delete`/bare-`:`
// push to `loop/*` still asks (`LAW_IV_BASH` comes after it, and `findLast` wins on the last
// match). This plugin has no part in that — it is a `permission.bash` key, read before any
// `tool.execute.before` hook runs — so there is nothing to change here for the push half; this
// comment only keeps this file's account in step. The commit still has no static equivalent:
// a commit's content cannot be named by a glob the way a push's target branch can, so the
// upgrade path there is still a session-level `permission` ruleset set by the loop launcher
// when it creates the loop session (`session.create` accepts one).

import { promises as fs, realpathSync, existsSync, readFileSync, readdirSync, readlinkSync, statSync, lstatSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { homedir } from "node:os"

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

const MODE = (process.env.GENESEED_GUARD || "on").toLowerCase()
const OFF = ["off", "0", "false", "no"].includes(MODE)
const WARN_ONLY = MODE === "warn"

// The gate switches (`--no-deletion-gate` 2026-10-17, `--no-secrets-gate` 2026-10-18, user
// decisions). The build writes `Deletion gate: off` / `Secrets gate: off` into the install's
// AGENT.md only when that gate is off; this reads the carrier ONCE at load, from the same
// harness dir the context plugin resolves ($GENESEED_HARNESS, else <plugin dir>/.. for a global
// install, else <plugin dir>/../.. for a project one), so flipping a switch takes an OpenCode
// restart. Anything unreadable or unexpected reads as ARMED. Each stands down only its own check
// below (the real-loss check; the Sealed Secrets path block and content scan) — catastrophic
// commands, root scans and protected checks still block.
// Every dir the carrier may come from, in read order; the gate-config check protects AGENT.md in each.
const CARRIER_DIRS = [...(process.env.GENESEED_HARNESS ? [process.env.GENESEED_HARNESS] : []),
  path.resolve(PLUGIN_DIR, ".."), path.resolve(PLUGIN_DIR, "..", "..")]
function carrierText() {
  try {
    for (const d of CARRIER_DIRS) {
      try { return readFileSync(path.join(d, "AGENT.md"), "utf8") } catch { continue }
    }
  } catch { /* fall through: armed */ }
  return ""
}
const CARRIER_TEXT = carrierText()
const gateOff = (marker) => new RegExp(`^${marker}:[ \\t]*off[ \\t]*\\r?$`, "m").test(CARRIER_TEXT)
const DELETION_GATE_OFF = gateOff("Deletion gate")
const SECRETS_GATE_OFF = gateOff("Secrets gate")
// `--no-ownership-gate` (ruling D25): the ownership first-write gate below stands down.
const OWNERSHIP_GATE_OFF = gateOff("Ownership gate")

// OpenCode 1.x paints a plugin's stderr over its TUI input box (in red); its own log API
// writes to the log file instead. The V1 entry sets LOG_CLIENT; V2 and tests have no
// client and keep stderr, as does a refused log call, so no line is lost. Never throws:
// a log line must not break a tool call.
let LOG_CLIENT = null
function say(msg, level = "warn") {
  try {
    if (LOG_CLIENT?.app?.log) {
      Promise.resolve(LOG_CLIENT.app.log({ body: { service: "geneseed-guard", level, message: msg } })).catch(() => console.error(`[geneseed-guard] ${msg}`))
      return
    }
  } catch { /* fall through to stderr */ }
  console.error(`[geneseed-guard] ${msg}`)
}
const log = (msg) => say(msg)

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
  // `geneseed doctor --probe` blocks on purpose; its blocks are not the user's (the twin of
  // the same line in js/hosts/hooks.mjs). The record only — never the decision.
  if (process.env.GENESEED_GATE_PROBE) return
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
// .env files are often edited legitimately → WARN, don't hard-block. Considered aligning this
// with js/hosts/hooks.mjs's DOTENV_RE (`/(^|[\\/])\.env(\.[^\\/]*)?$/`) the way SECRET_CONTENT_RE
// is aligned with SECRET_RE below — but the two diverge beyond case/slash-style: DOTENV_RE's
// suffix is `*` (zero-or-more, any non-slash char — matches `.env.` and `.env!`), this one's is
// `+` over `[\w.-]` (one-or-more, word/dot/hyphen only). Widening to DOTENV_RE's shape would
// change which filenames warn instead of block on THIS host, not just fold case, so it is left
// as-is rather than silently changing guard behaviour for a parity task.
const SECRET_WARN_RE = [/(^|\/)\.env(\.[\w.-]+)?$/i]

// Twin of js/hosts/hooks-prims.mjs's SECRET_RE (Law I's boundary half) — scans WRITE CONTENT for a
// credential-shaped string, not the target path (SECRET_RE above is the path twin, file names
// only). High-precision vendor prefixes only, same rationale as the Node side: a generic
// "looks like entropy" scan fires on every hash and lockfile. Kept byte-identical by the parity
// test in tests/plugins/guard.test.mjs — simple enough to literally diff, like the loss twin
// block below. `.env*` is exempt (SECRET_WARN_RE above already names it as where a
// secret may legitimately live) via the same path check used for the WARN tier.
const SECRET_CONTENT_RE =
  /\b(?:AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-ant-[A-Za-z0-9_-]{20,}|xox[abprs]-[0-9A-Za-z-]{10,})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/

// Catastrophic, effectively irreversible shell → BLOCK. Both Unix and Windows shells,
// since OpenCode runs natively on Windows and the agent may emit cmd / PowerShell.
// The catastrophic class itself is `catastrophic()` in the loss twin block below — one definition,
// shared with the hook (js/hosts/loss.mjs), judged in program position and run whatever the
// deletion gate's switch says. This raw text match is OpenCode's own stricter layer on top of it:
// it also blocks a command that only quotes one (a heredoc fed to `cat` included) and any
// `Remove-Item -Recurse -Force`, whatever its target.
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
// Deletion Is Deliberate, calibrated to REAL loss — the twin of js/hosts/loss.mjs (the plugin is
// copied whole into an OpenCode install, so it cannot import it). The static `permission.bash`
// globs (js/hosts/settings.mjs `LAW_IV_BASH`) keep only what loses data in EVERY state
// (`reflog expire`, `gc --prune`); a glob cannot read a work tree, so everything that depends
// on state is decided here. `tool.execute.before` has no ask tier, so a real loss is BLOCKED —
// the Bob behaviour — and `GENESEED_GUARD=warn` downgrades it to a log line.
//
// The fs-only readers below are the twins of js/hosts/gitref.mjs (gitRootOf, gitDirOf,
// gitCommonDirOf, currentBranch, protectedBranches, stashExists) — tests/plugins/guard.test.mjs
// compares each with its gitref.mjs original, quotes, semicolons and layout aside; the block
// between the twin markers is js/hosts/loss.mjs verbatim, and the same file diffs it.
function gitRootOf(cwd) {
  try {
    let dir = path.resolve(cwd)
    for (;;) {
      if (existsSync(path.join(dir, ".git"))) return dir
      const up = path.dirname(dir)
      if (up === dir) return null
      dir = up
    }
  } catch { return null }
}
function gitDirOf(root) {
  const dotgit = path.join(root, ".git")
  if (statSync(dotgit).isFile()) {
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotgit, "utf8"))
    if (!m) throw new Error(`${dotgit} does not name a gitdir`)
    return path.resolve(root, m[1])
  }
  return dotgit
}
function gitCommonDirOf(root) {
  const gitdir = gitDirOf(root)
  try { return path.resolve(gitdir, readFileSync(path.join(gitdir, "commondir"), "utf8").trim()) } catch { return gitdir }
}
function currentBranch(cwd) {
  try {
    const root = gitRootOf(cwd)
    if (!root) return null
    const ref = /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(readFileSync(path.join(gitDirOf(root), "HEAD"), "utf8"))
    return ref ? ref[1] : null
  } catch { return null }
}
function protectedBranches(root) {
  const names = new Set(["main", "master"])
  const remotes = path.join(gitCommonDirOf(root), "refs", "remotes")
  let dirs = []
  try { dirs = readdirSync(remotes) } catch { /* no remotes */ }
  for (const r of dirs) {
    try {
      const m = /^ref:\s*refs\/remotes\/[^/]+\/(.+?)\s*$/m.exec(readFileSync(path.join(remotes, r, "HEAD"), "utf8"))
      if (m) names.add(m[1])
    } catch { /* this remote has no HEAD symref */ }
  }
  return names
}
function stashExists(root) {
  const common = gitCommonDirOf(root)
  if (existsSync(path.join(common, "refs", "stash"))) return true
  try { return /^[0-9a-f]+ refs\/stash$/m.test(readFileSync(path.join(common, "packed-refs"), "utf8")) } catch { return false }
}

// ---- loss twin: BEGIN — adapters/opencode/plugins/geneseed-guard.js carries everything down to
// the END marker verbatim, with `export ` dropped (tests/plugins/guard.test.mjs diffs the two).

/**
 * The cheap prefilter: a command that matches neither alternative never reaches the parser or
 * a spawn. A git destructive VERB anywhere after `git` on the same line, or a removal program
 * as a word at a command boundary. Deliberately loose — the parse decides; this only has to be
 * a superset of what the parse acts on.
 */
const LOSS_CANDIDATE_RE =
  /\bgit\b[^\n]*\b(?:reset|clean|branch|checkout|switch|restore|stash|reflog|gc|push)\b|(?:^|[\s;&|("'`])(?:rm|rmdir|unlink|del|erase|remove-item|ri|rd)(?:\.exe)?(?=[\s;&|)"'`]|$)|(?:^|\s)-delete(?=\s|$)/im;

class Unverified extends Error {}
const unverified = (why) => { throw new Unverified(why); };

const RM_PROGS = new Set(['rm', 'rmdir', 'unlink', 'del', 'erase', 'remove-item', 'ri', 'rd']);
// cmd.exe's own removal verbs take `/s` `/q` switches, which are not paths.
const CMD_SWITCH_PROGS = new Set(['rmdir', 'del', 'erase', 'rd']);
const CD_PROGS = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl']);
// A wrapper runs the command after its own flags: `<short flags taking a value>|<short flags taking
// none>`. A flag in neither list (`env -S` runs a string, `env -C`/`sudo -D` change directory,
// `command -v` only looks up) is not guessed at — the segment asks if it names a removal.
const WRAPPERS = new Map([['sudo', 'ughpCUrtT|AbEHiknPSs'], ['doas', 'uC|ns'], ['command', '|p'],
  ['builtin', '|'], ['\\builtin', '|'], ['time', 'fo|pav'], ['nice', 'n|'], ['nohup', '|'],
  ['exec', 'a|cl'], ['env', 'u|i0v'], ['timeout', 'sk|v'], ['ionice', 'cn|t'], ['stdbuf', 'ioe|']]);
const WRAPPER_LONG = new Set(['--preserve-status', '--foreground', '--verbose', '--login', '--preserve-env',
  '--non-interactive', '--ignore-environment', '--null']);
// Shell grammar that may stand before the program word (`(cd x && rm y)`, `if …; then rm y; fi`).
const STRUCTURE = new Set(['(', '((', '{', '!', 'if', 'then', 'elif', 'else', 'do', 'while', 'until']);
// The only programs this reader does not parse that may still name a removal word and pass: their
// `rm`/`del` is their own subcommand (a package, a container), or they never run their arguments
// (a substitution in one is judged on its own). Any other program over a removal word asks.
const INERT = new Set(['npm', 'pnpm', 'yarn', 'bun', 'cargo', 'brew', 'docker', 'podman', 'echo', 'printf',
  'grep', 'egrep', 'fgrep', 'rg', 'findstr', 'select-string', 'which', 'where', 'type', 'man', 'get-command',
  'get-help']);
// Programs that run ANOTHER command from their arguments or stdin: what they would remove is
// not on this command line in a form the parse can read, so a removal word inside one asks.
const INDIRECT = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'pwsh', 'powershell', 'cmd',
  'eval', 'xargs', 'find', 'parallel', 'watch', 'invoke-expression', 'iex']);

const OPAQUE = '\u0000';
const GIT_TIMEOUT_MS = 5000;

/**
 * `git -C <dir> …` — THE spawn. Returns `{ status, stdout, stderr }`; throws `Unverified` when
 * git could not run to completion (missing, timed out, output too large), so the caller asks.
 */
function git(dir, args) {
  /** @type {Record<string, string | undefined>} */
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE;
  const r = spawnSync('git', ['-C', dir, '-c', 'core.fsmonitor=false', ...args], {
    encoding: 'utf8', shell: false, windowsHide: true, timeout: GIT_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env,
  });
  if (r.error || r.status === null) {
    unverified(`git ${args[0]} did not finish (${r.error ? /** @type {any} */ (r.error).code || r.error.message : 'killed'})`);
  }
  return r;
}

const firstLine = (s) => String(s || '').trim().split(/\r?\n/)[0] || 'no output';

/** A raw token with its quotes removed, or `OPAQUE`-marked when the shell would rewrite it. */
function word(raw) {
  const opaque = /[`$]|^~|[{}]/.test(raw);
  const s = raw.replace(/"([^"]*)"?|'([^']*)'?/g, (_, a, b) => a ?? b ?? '');
  return opaque ? `${OPAQUE}${s}` : s;
}

/** The segment's words, redirections dropped (`2>/dev/null`, `> out.log`) — they are not operands. */
function words(rawTokens) {
  const out = [];
  for (let i = 0; i < rawTokens.length; i++) {
    const t = rawTokens[i];
    if (/^(?:\d*|&)(?:>>?|<)&?$/.test(t)) { i += 1; continue; }   // a bare operator: drop its target too
    if (/^(?:\d*|&)(?:>>?|<)/.test(t)) continue;
    out.push(word(t));
  }
  return out;
}

/** `p` resolved against `dir`. On Windows a Git Bash `/c/…` path maps to `C:/…`; any other POSIX root cannot. */
function resolveIn(dir, p) {
  if (p.includes(OPAQUE)) unverified(`\`${p.replace(OPAQUE, '')}\` expands in the shell`);
  let q = p;
  if (process.platform === 'win32') {
    const m = /^\/([a-zA-Z])(\/.*)?$/.exec(q);
    if (m) q = `${m[1]}:${m[2] || '/'}`;
    else if (/^\/(?!\/)/.test(q)) unverified(`${p} is a POSIX path this host cannot map`);
  }
  if (!dir && !path.isAbsolute(q)) unverified('the working directory is unknown after a `cd` the gate cannot follow');
  return path.resolve(dir || '', q);
}

function repoRoot(dir) {
  if (!dir) unverified('the working directory is unknown after a `cd` the gate cannot follow');
  return gitRootOf(dir) || unverified(`${dir} is not inside a git repository`);
}

/** Ask if `git status` shows a tracked change (staged or not) under `paths` (all when empty). */
function dirty(dir, paths, act) {
  for (const p of paths) if (p.includes(OPAQUE)) unverified(`\`${p.replace(OPAQUE, '')}\` expands in the shell`);
  repoRoot(dir);
  const r = git(dir, ['status', '--porcelain', '-z', '--untracked-files=no', '--', ...paths]);
  if (r.status !== 0) unverified(`git status failed: ${firstLine(r.stderr)}`);
  const first = r.stdout.split('\0').find(Boolean);
  return first ? `${act} would discard uncommitted changes (${first.slice(3)})` : null;
}

const isCluster = (a) => /^-[a-zA-Z]+$/.test(a);
const hasShort = (a, c) => isCluster(a) && a.includes(c);

/** `git push` — asks only when a protected branch would be force-pushed or deleted. */
function pushAct(rest, dir) {
  let force = false; let del = false; let all = false; let mirror = false; let prune = false;
  const pos = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--') { pos.push(...rest.slice(i + 1)); break; }
    if (['-o', '--push-option', '--repo', '--receive-pack', '--exec'].includes(a)) { i += 1; continue; }
    if (a.startsWith('--')) {
      if (/^--force(?:-with-lease)?(?:=|$)/.test(a)) force = true;
      else if (a === '--delete') del = true;
      else if (a === '--all' || a === '--branches') all = true;
      else if (a === '--mirror') mirror = true;
      else if (a === '--prune') prune = true;
      continue;
    }
    if (isCluster(a)) { if (a.includes('f')) force = true; if (a.includes('d')) del = true; continue; }
    pos.push(a);
  }
  const specs = pos.slice(1);
  const forcedSpec = (s) => force || del || s.startsWith('+') || s.startsWith(':');
  if (!force && !del && !mirror && !prune && !specs.some(forcedSpec)) return null;
  if (mirror) return '`git push --mirror` force-pushes and deletes every remote branch to match this repository';
  if (prune) return '`git push --prune` deletes every remote branch with no local counterpart';
  if (all && force) return 'a forced `git push --all` force-pushes every branch, protected ones included';
  const root = repoRoot(dir);
  const protectedSet = protectedBranches(root);
  const verb = del ? 'delete' : 'force-push';
  let targets;
  if (specs.length) {
    targets = [];
    for (const spec of specs) {
      if (spec.includes(OPAQUE)) unverified(`the refspec \`${spec.replace(OPAQUE, '')}\` expands in the shell`);
      if (!forcedSpec(spec)) continue;
      const s = spec.replace(/^\+/, '');
      const colon = s.indexOf(':');
      if (!del && colon === 0) {
        const dst = s.slice(1).replace(/^refs\/heads\//, '');
        if (protectedSet.has(dst)) return `\`git push ${spec}\` would delete the protected branch ${dst}`;
        continue;
      }
      targets.push(del || colon < 0 ? s : s.slice(colon + 1));
    }
  } else {
    targets = defaultPushTargets(dir);
  }
  for (let t of targets) {
    if (t === 'HEAD' || t === '@') t = currentBranch(dir) || unverified('HEAD is detached, so the pushed branch is unknown');
    t = t.replace(/^refs\/heads\//, '');
    if (t.startsWith('refs/')) continue;   // a tag or another namespace, not a branch
    if (/[*?]/.test(t)) unverified(`the refspec target \`${t}\` is a pattern`);
    if (protectedSet.has(t)) return `\`git push\` would ${verb} the protected branch ${t}`;
  }
  return null;
}

/**
 * What a refspec-less forced push targets: the current branch (`simple`/`current`) and its
 * upstream (`upstream`). `matching` pushes every branch and a `remote.*.push` rewrites the
 * target — neither is something this read can bound, so both ask.
 */
function defaultPushTargets(dir) {
  const cur = currentBranch(dir) || unverified('HEAD is detached, so the pushed branch is unknown');
  const esc = cur.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const r = git(dir, ['config', '--get-regexp', `^(push\\.default|remote\\..*\\.push|branch\\.${esc}\\.merge)$`]);
  if (r.status !== 0 && r.status !== 1) unverified(`git config failed: ${firstLine(r.stderr)}`);
  const targets = [cur];
  for (const line of r.stdout.split(/\r?\n/).filter(Boolean)) {
    const [key, value = ''] = line.split(/\s+/, 2);
    if (/^remote\..*\.push$/i.test(key)) unverified(`${key} rewrites what a bare push targets`);
    if (/^push\.default$/i.test(key) && value === 'matching') unverified('push.default=matching pushes every branch');
    if (/\.merge$/i.test(key)) targets.push(value);
  }
  return targets;
}

/**
 * The checked-out branch when it is protected, null when HEAD is detached or unreadable, and
 * undefined when it is a known unprotected branch — read off disk, so a feature branch passes the
 * protected-branch-only forms below without running git (user ruling, 2026-10-17).
 */
function protectedHead(dir) {
  const cur = currentBranch(dir);
  return cur && !protectedBranches(repoRoot(dir)).has(cur) ? undefined : cur;
}

/** `lost` on the protected branch `cur`; an unknown HEAD cannot be cleared as unprotected, so it asks. */
function onProtected(cur, lost) {
  if (!lost) return null;
  if (!cur) unverified('HEAD is detached or unreadable, so the gate cannot tell whether a protected branch is checked out');
  return `${lost} on the protected branch ${cur}`;
}

/**
 * `branch -f`, `checkout -B`, `switch -C` moving `name` to `start` (HEAD when absent): stops when
 * `name` is protected and its old tip holds a commit neither `start` nor any remote ref reaches.
 * A branch that does not exist yet is created, which loses nothing.
 */
function forceMove(dir, name, start, act) {
  if (name === undefined) return null;   // git refuses the command on its own
  if (name.includes(OPAQUE)) unverified(`the branch name \`${name.replace(OPAQUE, '')}\` expands in the shell`);
  if (!protectedBranches(repoRoot(dir)).has(name)) return null;
  const tip = git(dir, ['rev-parse', '-q', '--verify', `refs/heads/${name}`]);
  if (tip.status === 1) return null;
  if (tip.status !== 0) unverified(`cannot read the branch ${name}: ${firstLine(tip.stderr)}`);
  const to = start ?? 'HEAD';
  if (to.includes(OPAQUE)) unverified(`the start point \`${to.replace(OPAQUE, '')}\` expands in the shell`);
  const r = git(dir, ['rev-list', '-n1', `refs/heads/${name}`, '--not', to, '--remotes']);
  if (r.status !== 0) unverified(`cannot compare ${name} with ${to}: ${firstLine(r.stderr)}`);
  return r.stdout.trim() ? `${act} ${name} would strand commits no remote and not ${to} holds` : null;
}

/**
 * `git checkout` with no `--` and no force: `-B <protected>` force-moves it; otherwise, on a
 * protected branch, positionals naming files (the first one is not a commit, or follows one)
 * discard their changes. A lone commit-ish is a branch switch, which refuses to overwrite work.
 */
function checkoutAct(rest, dir) {
  const pos = [];
  let reset;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '-b' || a === '--orphan') return null;   // a new branch: additive
    if (a === '-B') { reset = rest[i + 1]; i += 1; continue; }
    if (a.startsWith('--pathspec-from-file')) unverified('checkout reads its paths from a file');
    if (!a.startsWith('-')) pos.push(a);
  }
  if (reset !== undefined) return forceMove(dir, reset, pos[0], '`git checkout -B`');
  if (!pos.length) return null;
  const cur = protectedHead(dir);
  if (cur === undefined) return null;
  let paths = pos;
  if (!pos[0].includes(OPAQUE) && git(dir, ['rev-parse', '-q', '--verify', `${pos[0]}^{commit}`]).status === 0) {
    if (pos.length === 1) return null;
    paths = pos.slice(1);
  }
  return onProtected(cur, dirty(dir, paths, '`git checkout <paths>`'));
}

/** `git branch` — a forced delete asks for a protected branch or one whose commits live nowhere else. */
function branchAct(rest, dir) {
  const opts = rest.filter((a) => a.startsWith('-'));
  const del = opts.some((a) => a === '--delete' || a === '-D' || hasShort(a, 'd') || hasShort(a, 'D'));
  const force = opts.some((a) => a === '--force' || a === '-D' || hasShort(a, 'f') || hasShort(a, 'D'));
  if (!force) return null;   // an un-forced delete refuses an unmerged branch on its own
  const names = rest.filter((a) => !a.startsWith('-'));
  if (!del) {
    // `branch -f <name> [<start>]`; a forced rename or copy (-M, -C) is another form.
    if (opts.some((a) => a === '--move' || a === '--copy' || [...'mMcC'].some((c) => hasShort(a, c)))) return null;
    return forceMove(dir, names[0], names[1], '`git branch -f`');
  }
  if (opts.some((a) => a === '-r' || a === '--remotes')) return null;   // a remote-tracking ref; `fetch` restores it
  const root = repoRoot(dir);
  const protectedSet = protectedBranches(root);
  for (const n of names) {
    if (n.includes(OPAQUE)) unverified(`the branch name \`${n.replace(OPAQUE, '')}\` expands in the shell`);
    if (protectedSet.has(n)) return `\`git branch -D ${n}\` deletes the protected branch ${n}`;
    // Empty output: every commit of `n` is reachable from a remote ref or from HEAD.
    const r = git(dir, ['rev-list', '-n1', `refs/heads/${n}`, '--not', '--remotes', 'HEAD']);
    if (r.status !== 0) unverified(`cannot read the branch ${n}: ${firstLine(r.stderr)}`);
    if (r.stdout.trim()) return `\`git branch -D ${n}\` deletes commits no remote and no HEAD holds`;
  }
  return null;
}

/**
 * `git reset --hard [<target>]` — asks only when it would abandon COMMITS: one HEAD reaches that
 * neither `<target>` nor any remote ref does. The uncommitted work it discards passes: what is in
 * progress may break, what exists must be protected (user decision, 2026-10-18). No target is
 * HEAD itself, which abandons nothing.
 */
function resetHardAct(rest, dir) {
  const dd = rest.indexOf('--');
  const target = (dd < 0 ? rest : rest.slice(0, dd)).find((a) => !a.startsWith('-'));
  if (target === undefined) return null;
  if (target.includes(OPAQUE)) unverified(`the target \`${target.replace(OPAQUE, '')}\` expands in the shell`);
  repoRoot(dir);
  const t = git(dir, ['rev-parse', '-q', '--verify', `${target}^{commit}`]);
  if (t.status !== 0) unverified(`cannot resolve ${target} to a commit`);
  const r = git(dir, ['rev-list', '-n1', 'HEAD', '--not', t.stdout.trim(), '--remotes']);
  if (r.status !== 0) unverified(`cannot compare HEAD with ${target}: ${firstLine(r.stderr)}`);
  return r.stdout.trim() ? `\`git reset --hard ${target}\` would abandon commits no remote and not ${target} holds` : null;
}

/** `git clean` — forced, it asks when `git clean -n` with the same selection lists anything. */
function cleanAct(rest, dir) {
  const forced = rest.some((a) => a === '--force' || hasShort(a, 'f'));
  if (!forced) return null;
  const dry = [];
  for (const a of rest) {
    if (a.includes(OPAQUE)) unverified(`\`${a.replace(OPAQUE, '')}\` expands in the shell`);
    if (a === '--force' || a === '--interactive') continue;
    if (isCluster(a)) {
      const kept = a.replace(/[fin]/g, '');
      if (kept !== '-') dry.push(kept);
      continue;
    }
    dry.push(a);
  }
  repoRoot(dir);
  const r = git(dir, ['clean', '-n', ...dry]);
  if (r.status !== 0) unverified(`git clean -n failed: ${firstLine(r.stderr)}`);
  const first = firstLine(r.stdout);
  return r.stdout.trim() ? `\`git clean\` would delete untracked files (${first.replace(/^Would remove /, '')})` : null;
}

/** One `git …` segment: the verdict for its verb, or null. */
function gitAct(args, dir, always) {
  let d = dir;
  let i = 0;
  let redirected = false;
  for (; i < args.length; i++) {
    const a = args[i];
    // A `-C` the gate cannot resolve leaves the directory unknown; only a destructive verb asks for it.
    if (a === '-C') { try { d = resolveIn(d, args[i + 1] ?? OPAQUE); } catch { d = null; } i += 1; continue; }
    if (a === '-c') { i += 1; continue; }
    if (/^--(?:git-dir|work-tree)(?:=|$)/.test(a)) { redirected = true; if (!a.includes('=')) i += 1; continue; }
    if (a.startsWith('-')) continue;
    break;
  }
  const verb = args[i];
  const rest = args.slice(i + 1);
  const act = () => {
    switch (verb) {
      case 'reset':
        return rest.includes('--hard') ? resetHardAct(rest, d) : null;
      case 'checkout': {
        const forced = rest.some((a) => a === '--force' || hasShort(a, 'f')) && dirty(d, [], '`git checkout --force`');
        if (forced) return forced;
        const dd = rest.indexOf('--');
        if (dd < 0) return checkoutAct(rest, d);
        const paths = rest.slice(dd + 1);
        return paths.length ? dirty(d, paths, '`git checkout --`') : null;
      }
      case 'switch': {
        const c = rest.findIndex((a) => a === '-C' || a === '--force-create');
        const pos = c < 0 ? [] : rest.slice(c + 1).filter((a) => !a.startsWith('-'));
        return (c >= 0 && forceMove(d, pos[0], pos[1], '`git switch -C`'))
          || (rest.some((a) => a === '--force' || a === '--discard-changes' || hasShort(a, 'f'))
            ? dirty(d, [], '`git switch --discard-changes`') : null);
      }
      case 'rm': {
        // Only a forced removal discards changes: git refuses a modified file without -f, and
        // `--cached` or `-n` keep the file. Protected branch only (user ruling, 2026-10-17).
        if (!rest.some((a) => a === '--force' || hasShort(a, 'f'))) return null;
        if (rest.some((a) => a === '--cached' || a === '--dry-run' || hasShort(a, 'n'))) return null;
        if (rest.some((a) => a.startsWith('--pathspec-from-file'))) unverified('git rm reads its paths from a file');
        const paths = rest.filter((a) => !a.startsWith('-'));
        const cur = paths.length ? protectedHead(d) : undefined;
        return cur === undefined ? null : onProtected(cur, dirty(d, paths, '`git rm -f`'));
      }
      case 'restore': {
        const staged = rest.some((a) => a === '--staged' || hasShort(a, 'S'));
        const worktree = rest.some((a) => a === '--worktree' || hasShort(a, 'W'));
        if (staged && !worktree) return null;   // unstaging only: the change stays in the tree
        if (rest.some((a) => a.startsWith('--pathspec-from-file'))) unverified('restore reads its paths from a file');
        const paths = [];
        for (let j = 0; j < rest.length; j++) {
          const a = rest[j];
          if (a === '-s' || a === '--source') { j += 1; continue; }
          if (a === '--') continue;
          if (!a.startsWith('-')) paths.push(a);
        }
        return paths.length ? dirty(d, paths, '`git restore`') : null;
      }
      case 'clean':
        return cleanAct(rest, d);
      case 'stash': {
        const sub = rest.find((a) => !a.startsWith('-'));
        if (sub !== 'drop' && sub !== 'clear') return null;
        return stashExists(repoRoot(d)) ? `\`git stash ${sub}\` deletes stashed work` : null;
      }
      case 'reflog':
        return always && rest.includes('expire') ? '`git reflog expire` deletes the reflog recovery depends on' : null;
      case 'gc':
        return always && rest.some((a) => a.startsWith('--prune'))
          ? '`git gc --prune` deletes the unreachable commits recovery depends on' : null;
      case 'branch':
        return branchAct(rest, d);
      case 'push':
        return pushAct(rest, d);
      default:
        return null;
    }
  };
  const verdict = act();
  if (verdict && redirected) return `${verdict} (and --git-dir/--work-tree points it at a repository the gate did not read)`;
  return verdict;
}

/** One removal segment: asks unless every operand is tracked AND unmodified in a git work tree. */
function rmAct(prog, args, dir) {
  const targets = [];
  let opts = true;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (opts && a === '--') { opts = false; continue; }
    if (opts && /^-(?:path|literalpath)$/i.test(a)) { targets.push(args[i + 1] ?? OPAQUE); i += 1; continue; }
    const bound = opts && /^-(?:path|literalpath)[:=](.+)$/i.exec(a);
    if (bound) { targets.push(bound[1]); continue; }
    if (opts && /^-(?:filter|include|exclude)(?:[:=]|$)/i.test(a)) unverified(`\`${prog} ${a}\` selects files the gate cannot list`);
    if (opts && a.length > 1 && a.startsWith('-')) continue;
    if (opts && CMD_SWITCH_PROGS.has(prog) && /^\/[a-zA-Z?]$/.test(a)) continue;
    targets.push(a);
  }
  // `… | Remove-Item`, `ri -Force`: the paths come from the pipe, which this reader cannot see.
  if (!targets.length) unverified(`\`${prog}\` names no path, so what it removes comes from elsewhere`);
  const groups = new Map();
  for (const t of targets) {
    const shown = t.replace(OPAQUE, '');
    if (t.includes(OPAQUE) || /[*?[\],]/.test(t)) unverified(`\`${shown}\` expands in the shell, so the gate cannot list what it names`);
    const abs = resolveIn(dir, t);
    if (abs.split(/[\\/]+/).includes('.git')) return `\`${prog} ${shown}\` deletes git's own data`;
    // Nothing there, nothing lost: `rm -f build.log` on a clean tree is routine cleanup.
    try { lstatSync(abs); } catch (e) {
      if (e && e.code === 'ENOENT') continue;
      unverified(`cannot read ${shown}: ${e && e.code}`);
    }
    const root = gitRootOf(abs);
    if (!root) return `\`${prog} ${shown}\` deletes a path outside any git repository, which nothing could restore`;
    if (path.resolve(root) === path.resolve(abs)) return `\`${prog} ${shown}\` deletes a whole repository or worktree`;
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push({ shown, rel });
  }
  const fold = (s) => (process.platform === 'win32' ? s.toLowerCase() : s);
  for (const [root, list] of groups) {
    const r = git(root, ['ls-files', '-z', '-t', '--cached', '--others', '--modified', '--directory',
      '--', ...list.map((x) => `:(literal)${x.rel}`)]);
    if (r.status !== 0) unverified(`git ls-files failed: ${firstLine(r.stderr)}`);
    const entries = r.stdout.split('\0').filter(Boolean).map((e) => ({ tag: e[0], p: fold(e.slice(2)) }));
    for (const { shown, rel } of list) {
      const key = fold(rel);
      const mine = entries.filter((e) => e.p === key || e.p.startsWith(`${key}/`) || e.p === `${key}/`);
      if (!mine.length) return `\`${prog} ${shown}\` deletes something git does not track, which nothing could restore`;
      const bad = mine.find((e) => e.tag !== 'H');
      if (bad) {
        const what = bad.tag === '?' ? 'untracked or ignored' : 'modified or otherwise not restorable';
        return `\`${prog} ${shown}\` deletes ${what} files (${bad.p}), which git cannot restore`;
      }
    }
  }
  return null;
}

/** The program word, stripped of its path and `.exe`, lowercased (PowerShell and cmd are case-blind). */
const progOf = (w) => w.split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');

/**
 * A segment's RAW tokens with the shell grammar around its command dropped: leading `(`, `{`,
 * `!`, `then`, `do`… (a `(` glued to the first word too) and a closing `)`/`}`. Without it
 * `(git reset --hard)` has `(git` for its program and `--hard)` for its flag. `rootScan`
 * shares it, so `(find / …)` is a scan.
 */
function stripStructure(raw) {
  const t = raw.slice();
  while (t.length) {
    if (STRUCTURE.has(t[0])) t.shift();
    else if (/^\(+./.test(t[0])) t[0] = t[0].replace(/^\(+/, '');
    else break;
  }
  while (t.length && (t[t.length - 1] === '}' || /^\)+$/.test(t[t.length - 1]))) t.pop();
  if (t.length) t[t.length - 1] = t[t.length - 1].replace(/\)+$/, '');
  return t;
}

/**
 * The bodies of the command substitutions in `text` (`$(…)`, backticks, `<(…)`, `>(…)`) —
 * single quotes hide them, double quotes do not. An unclosed one runs to the end of the text:
 * the splitter already cut an unquoted `$(a; b)` at its `;`.
 */
function substitutions(text) {
  const out = [];
  let sq = false; let dq = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (sq) { if (c === "'") sq = false; continue; }
    if (c === "'" && !dq) { sq = true; continue; }
    if (c === '"') { dq = !dq; continue; }
    if (c === '`') {
      const end = text.indexOf('`', i + 1);
      out.push(text.slice(i + 1, end < 0 ? text.length : end));
      i = end < 0 ? text.length : end;
    } else if ('$<>'.includes(c) && text[i + 1] === '(') {
      let depth = 1; let j = i + 2;
      for (; j < text.length && depth; j++) depth += text[j] === '(' ? 1 : text[j] === ')' ? -1 : 0;
      out.push(text.slice(i + 2, depth ? text.length : j - 1));
      i = j - 1;
    }
  }
  return out;
}

/** `w` past wrapper `name`'s own flags (and `timeout`'s duration), or null when a flag is unknown. */
function pastWrapper(name, w) {
  const [takes, plain] = WRAPPERS.get(name).split('|');
  let i = 0;
  for (; i < w.length && w[i].length > 1 && w[i].startsWith('-'); i++) {
    const a = w[i];
    if (a === '--') { i += 1; break; }
    if (a.startsWith('--')) { if (a.includes('=') || WRAPPER_LONG.has(a)) continue; return null; }
    if (name === 'nice' && /^-\d+$/.test(a)) continue;
    for (let j = 1; j < a.length; j++) {
      if (takes.includes(a[j])) { if (j === a.length - 1) i += 1; break; }   // the value: the rest, or the next word
      if (!plain.includes(a[j])) return null;
    }
  }
  if (name === 'timeout' && /^\d/.test(w[i] || '')) i += 1;
  return w.slice(i);
}

/**
 * The verdict for a whole command, given its segments as RAW token arrays (quotes still on —
 * `js/hosts/hooks.mjs` cuts and tokenises with the same lexer `rootScan` uses, so a quoted
 * `;` or a heredoc body is never a segment). Returns the reason it would lose data, or null
 * when it provably would not. What it cannot settle — a glob, a git that fails — is a "could not
 * verify" reason, never a throw. A BUG still throws, on purpose: `guardGate` turns it into a
 * `gate-error` (an ask on Claude, a warning on Bob) and the OpenCode guard logs and allows it —
 * each host's ceiling for a crashed gate (docs/adr/0007-gates-fail-closed-per-host-ceiling.md).
 * `always: false` skips the two acts that lose data in every state (`reflog expire`, `gc --prune`)
 * — the OpenCode guard passes it, because a static `permission.bash` glob already asks for those.
 * `split` cuts a command substitution's body into segments the same way (both callers pass their
 * splitter); without it, a substitution that names a removal asks.
 * @param {string[][]} segments
 * @param {string} cwd
 * @param {{ always?: boolean, split?: (text: string) => string[][] }} [options]
 */
function lossReason(segments, cwd, { always = true, split } = {}) {
  /** The first loss among `segs`, run from `start`; a substitution body is judged as a command. */
  const judge = (segs, start, depth = 0) => {
    let dir = start;
    for (const raw of segs.map(stripStructure)) {
      const text = raw.join(' ');
      const named = LOSS_CANDIDATE_RE.test(text);
      for (const body of named ? substitutions(text) : []) {
        if (!LOSS_CANDIDATE_RE.test(body)) continue;
        // Bounded: `$($($(…` nested past any real command would rescan the text once per level.
        if (!split || depth >= 4) unverified('a command substitution names a removal');
        const v = judge(split(body), dir, depth + 1);
        if (v) return v;
      }
      let w = words(raw);
      while (w && w.length && (/^\w+=/.test(w[0]) || WRAPPERS.has(progOf(w[0])))) {
        const wrapper = progOf(w[0]);
        w = /^\w+=/.test(w[0]) ? w.slice(1) : pastWrapper(wrapper, w.slice(1));
        if (!w && named) unverified(`\`${wrapper}\` takes a flag the gate does not know`);
      }
      if (!w || !w.length) continue;
      const prog = progOf(w[0]);
      const args = w.slice(1);
      if (CD_PROGS.has(prog)) {
        const target = args.find((a) => !a.startsWith('-') && !/^\/d$/i.test(a));
        try { dir = target && target !== '-' ? resolveIn(dir, target) : null; } catch { dir = null; }
        continue;
      }
      let verdict = null;
      if (prog === 'git') verdict = gitAct(args, dir, always);
      else if (RM_PROGS.has(prog)) verdict = rmAct(prog, args, dir);
      else if (INDIRECT.has(prog) && LOSS_CANDIDATE_RE.test(args.join(' '))) {
        unverified(`\`${prog}\` runs a command the gate cannot read`);
      } else if (named && !INERT.has(prog)
        && LOSS_CANDIDATE_RE.test(raw.map((t) => t.replace(/"[^"]*"?|'[^']*'?/g, ' ')).join(' '))) {
        // A program this reader does not know (a wrapper, a loop, shell syntax) over an unquoted
        // removal word: it may run it, so it is not proven safe. A quoted word is data.
        unverified(`\`${w[0].replace(OPAQUE, '')}\` is not a program the gate reads, and a removal follows it`);
      }
      if (verdict) return verdict;
    }
    return null;
  };
  try {
    return judge(segments, cwd);
  } catch (e) {
    if (!(e instanceof Unverified)) throw e;
    return `the gate could not verify what this command would lose (${e.message})`;
  }
}

/**
 * THE CATASTROPHIC CLASS — what no state can make safe: a recursive removal of a filesystem root,
 * a drive root or the home directory, a device format or raw-disk overwrite, a fork bomb. Unlike
 * `lossReason` it reads no state, and it stands whatever the deletion gate's switch says (user
 * decision 2026-10-18): `--no-deletion-gate` silences the real-loss check, never this one. Judged
 * in PROGRAM position, segment by segment after `stripStructure` and the wrappers, so `true & rm
 * -rf /`, `sudo rm -rf /`, `(rm -rf /)` and `rm -rf /;` are caught and a commit message that only
 * names `rm -rf /` is not. A shell or `eval` (`bash -c '…'`, `pwsh -Command …`) and a `$(…)` body
 * are judged as commands of their own, and so is what a shell reads on stdin: a heredoc or
 * here-string fed to `bash`/`sh`/`pwsh`/`cmd`… (`bash <<'EOF'` over `rm -rf /`). One fed to any
 * other program (`cat <<EOF`, `git commit -F - <<EOF`) is data. The fork bomb spans `|`/`&`/`;`, so
 * it is tested on the whole command. `split` cuts a command into raw-token segments, as for
 * `lossReason`. Returns the offending text, or null.
 */
const CATASTROPHIC_CANDIDATE_RE = /(?:^|[^\w-])(?:rm|rmdir|rd|del|erase|remove-item|ri|mkfs(?:\.\w+)?|dd|format)(?:\.exe)?(?![\w-])|:\(\)/i;
const FORK_BOMB_RE = /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/;
// `/`, a Git Bash or WSL drive (`/c`, `/mnt/c`), a Windows drive (`C:`, `C:\`), the home dir — globbed or not.
const ROOT_TARGET_RE = /^(?:\/|~[\\/]?|\$\{?HOME\}?[\\/]?|\/[a-z]\/?|\/mnt\/[a-z]\/?|[a-z]:[\\/]?)\*?$/i;
const RM_RECURSE_RE = /^(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)$/;
// PowerShell's `-Recurse` (or any prefix of it) and cmd.exe's `/s`, alone or glued (`/s/q`).
const PS_CMD_RECURSE_RE = /^(?:-r(?:e(?:c(?:u(?:r(?:s(?:e)?)?)?)?)?)?|(?:\/[a-z]+)*\/s(?:\/[a-z]+)*)$/i;
const leadingFlags = (w) => { let i = 0; while (i < w.length && /^[-/][\w-]+$/.test(w[i])) i += 1; return w.slice(i); };
// The programs that run what they read on stdin as commands.
const STDIN_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'pwsh', 'powershell', 'cmd']);
// The same lexer as the splitter's (a comment, a quoted run, a heredoc opener, a newline), so the
// openers it finds are the ones left in the segments' tokens, in the same order.
const HEREDOC_SCAN_RE = /(?<![^\s;|&(])#[^\n]*|"[^"]*"?|'[^']*'?|(?<!<)<<(?!<)(-?)[ \t]*(["']?)([A-Za-z_]\w*)\2|\n/g;
/** Every heredoc body in `command`, in opener order; an unterminated one runs to the end, as in bash. */
function heredocBodies(command) {
  const out = [];
  const tags = [];
  const re = new RegExp(HEREDOC_SCAN_RE);
  let m;
  while ((m = re.exec(command))) {
    if (m[3]) { tags.push([m[1], m[3]]); continue; }
    if (m[0] !== '\n' || !tags.length) continue;
    let start = re.lastIndex;
    while (tags.length) {
      const [dash, tag] = tags.shift();
      const body = [];
      while (start < command.length) {
        const end = command.indexOf('\n', start);
        const line = command.slice(start, end < 0 ? command.length : end).replace(/\r$/, '');
        start = end < 0 ? command.length : end + 1;
        if ((dash ? line.replace(/^\t+/, '') : line) === tag) break;
        body.push(line);
      }
      out.push(body.join('\n'));
    }
    re.lastIndex = start;
  }
  return out;
}
function catastrophic(command, split, depth = 0) {
  if (!CATASTROPHIC_CANDIDATE_RE.test(command)) return null;
  if (FORK_BOMB_RE.test(command)) return command.trim();
  const bodies = command.includes('<<') ? heredocBodies(command) : [];
  let next = 0;
  for (const raw of split(command).map(stripStructure)) {
    const text = raw.join(' ');
    // What this segment feeds on stdin: each heredoc opener takes the next body, a here-string its word.
    const fed = [];
    raw.forEach((t, i) => {
      if (t.startsWith('<<<')) fed.push(word(t.length > 3 ? t.slice(3) : raw[i + 1] || '').replace(OPAQUE, ''));
      else if (t.startsWith('<<')) fed.push(bodies[next++] ?? '');
    });
    for (const body of depth < 4 ? substitutions(text) : []) {
      const v = catastrophic(body, split, depth + 1);
      if (v) return v;
    }
    let w = words(raw).map((t) => t.replace(OPAQUE, ''));
    while (w.length && (/^\w+=/.test(w[0]) || WRAPPERS.has(progOf(w[0])))) {
      w = /^\w+=/.test(w[0]) ? w.slice(1) : pastWrapper(progOf(w[0]), w.slice(1)) || leadingFlags(w.slice(1));
    }
    if (!w.length) continue;
    const prog = progOf(w[0]);
    for (const body of STDIN_SHELLS.has(prog) && depth < 4 ? fed : []) {
      const v = catastrophic(body, split, depth + 1);
      if (v) return v;
    }
    const args = w.slice(1).map((a) => a.replace(/^-(?:literal)?path[=:]/i, ''));
    // cmd.exe's `/s` `/q` are switches, not the Git Bash drives `/s` `/q`.
    const root = () => args.some((a) => ROOT_TARGET_RE.test(a) && !(CMD_SWITCH_PROGS.has(prog) && /^\/[a-z]$/i.test(a)));
    let hit = false;
    if (prog === 'rm') hit = args.some((a) => RM_RECURSE_RE.test(a)) && root();
    else if (RM_PROGS.has(prog)) hit = args.some((a) => PS_CMD_RECURSE_RE.test(a)) && root();
    else if (/^mkfs(?:\.\w+)?$/.test(prog)) hit = args.some((a) => a.startsWith('/dev/'));
    else if (prog === 'dd') hit = args.some((a) => /^of=\/dev\/(?:sd|nvme|hd|disk)/.test(a));
    else if (prog === 'format') hit = args.some((a) => /^[a-z]:/i.test(a));
    else if (INDIRECT.has(prog) && depth < 4) {
      const v = catastrophic(leadingFlags(w.slice(1)).join(' '), split, depth + 1);
      if (v) return v;
    }
    if (hit) return text.trim();
  }
  return null;
}
// ---- loss twin: END

// ---- gate text twin: BEGIN — adapters/opencode/plugins/geneseed-guard.js carries everything down to
// the END marker verbatim, with `export ` dropped (tests/plugins/guard.test.mjs diffs the two).

/**
 * What each protected check is, for a person who has not read the diff: the files, what they are,
 * what an edit can do. Fixed text, so the governed agent cannot write its own case. A file is written
 * as `CANDIDATES` (`./geneseed-dir.mjs`) writes it, so tests/unit/gate_text.test.mjs compares the
 * two entry by entry, both ways: a string ending `/` is a folder, any other string a file, a regex
 * a file name.
 * @type {[(string | RegExp)[], string, string][]}
 */
const GATE_FILES = [
  [['.github/workflows/', '.gitlab-ci.yml', 'Jenkinsfile', 'azure-pipelines.yml', '.circleci/'],
    'which defines the checks that run on every push',
    'those checks can get weaker or stop running, and a failure could go unseen'],
  [[/^eslint\.config\./, /^\.eslintrc/, 'biome.json', 'biome.jsonc', 'ruff.toml', '.golangci.yml', 'checkstyle.xml'],
    'which sets the rules the linter enforces',
    'those rules can get weaker, and bad code could pass unseen'],
  [['tsconfig.json'],
    'which sets how strictly types are checked',
    'the type checks can get weaker, and a type error could pass unseen'],
  [[/^jest\.config\./, /^vitest\.config\./, 'pytest.ini'],
    'which decides how the tests run',
    'tests can be skipped or loosened, and a failure could go unseen'],
  [['package.json', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'pyproject.toml', 'Cargo.toml', 'go.mod'],
    'which names the commands that test this project',
    'those commands can change, and a failing test could read as a pass'],
];
/**
 * Protected by being the lists themselves, so they are in no seed and stay outside `GATE_FILES`. Read
 * at the repo root only: a `packages/a/.geneseed/done-checks.txt` someone listed feeds no gate.
 * @type {[string, string, string][]}
 */
const GATE_LISTS = [
  ['.geneseed/protected-checks.txt', 'which lists the files this gate protects',
    'a check can lose its protection, and nothing would tell you'],
  ['.geneseed/done-checks.txt', 'which lists the checks that must pass before work counts as done',
    'work could count as done without passing a check'],
];
// Matches at any depth: a user may list `packages/a/tsconfig.json`, and it is still a tsconfig.
const gateIs = (rel, file) => {
  if (typeof file !== 'string') return file.test(rel.slice(rel.lastIndexOf('/') + 1));
  return file.endsWith('/') ? `/${rel}`.includes(`/${file}`) : `/${rel}`.endsWith(`/${file}`);
};
const GATE_FILE_OTHER = [null, 'which this project lists as a protected check',
  'that check can get weaker or stop running, and a failure could go unseen'];

// `ruleGateTarget`'s four answers: name, what it is, what the safe line calls it, whose call it is, impact.
const GATE_RULE = ['this rule', 'what becomes a rule'];
const GATE_FACT = ['this memory', 'what the agent remembers'];
const GATE_STORES = {
  'user-rules.md': ['user-rules.md', 'your standing rules, which the agent obeys in every session', ...GATE_RULE,
    'the text binds every later session until you remove it'],
  'the rule draft': ['the rule draft', 'which can become one of your standing rules', ...GATE_RULE,
    'the text can become a rule that binds every later session'],
  'the memory index': ['the memory index', 'which lists what the agent remembers across sessions', ...GATE_FACT,
    'the text shapes every later session until you remove it'],
  memory: ['a memory file', 'which the agent reads in later sessions', ...GATE_FACT,
    'the text shapes every later session until you remove it'],
};

// Bidi and zero-width marks too (`\p{C}`): they make a name read as something it is not. A double
// quote of any shape turns to `'`, or a name could seem to close its own quotes.
const gateStrip = (v) => String(v ?? '').replace(/[\p{C}\p{Zl}\p{Zp}]/gu, '').replace(/["\u201C-\u201F\uFF02]/g, "'").trim();

/**
 * An agent-supplied value in the human part. Clipped in the middle, because the end of a path names
 * the file. Quotes mark a name; they do not stop one reading like a sentence. `...` is ASCII so that
 * clipping alone does not force the quotes.
 */
function gateName(value) {
  const c = [...gateStrip(value)];
  const text = c.length > 60 ? `${c.slice(0, 20).join('')}...${c.slice(-37).join('')}` : c.join('');
  return /^[A-Za-z0-9._/-]+$/.test(text) ? text : `"${text}"`;
}

const gatePath = (p) => String(p ?? '').replace(/\\/g, '/');
// Every line end a viewer may honour: a line break that this missed would hide a line from the count.
const gateLines = (text) => {
  const lines = text.split(/\r\n|[\r\n\u2028\u2029]/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
};

/**
 * ` (+3 lines, -1 line)` from `editPairs`, or nothing when no line differs. Each pair loses its common
 * leading and trailing lines. Exact for one changed region; with several it overstates, and it
 * never hides a change. A pair says nothing of how often it applies, so a caller whose input has
 * `replace_all`, at the top or in an `edits` entry, passes no pairs and no count shows: the agent sets
 * that flag, and a 40-place edit must not read as `+1 line, -1 line`.
 */
function gateCount(pairs) {
  let added = 0;
  let removed = 0;
  for (const [before, after] of pairs) {
    const a = gateLines(before);
    const b = gateLines(after);
    const most = Math.min(a.length, b.length);
    let head = 0;
    while (head < most && a[head] === b[head]) head += 1;
    let tail = 0;
    while (tail < most - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
    removed += a.length - head - tail;
    added += b.length - head - tail;
  }
  const n = (sign, v) => `${sign}${v} line${v === 1 ? '' : 's'}`;
  const parts = [...(added ? [n('+', added)] : []), ...(removed ? [n('-', removed)] : [])];
  return parts.length ? ` (${parts.join(', ')})` : '';
}

const gateEdit = (f, shown, what) => `${f.shell ? 'This command writes to' : 'This edit changes'} ${shown}`
  + `${f.pairs ? gateCount(f.pairs) : ''}, ${what}.`;

const GATE_ELSEWHERE = 'This command runs on another repository, through --git-dir or --work-tree, which the gate did not read.';
const GATE_DO_IT = 'You can make this change yourself, outside the agent.';
const GATE_RUN_IT = 'You can run this command yourself, outside the agent.';
const GATE_EXTERNAL = { rule: 'External Gate', safe: 'Deny, unless you asked for this change.',
  tail: 'do not write this file another way', can: GATE_DO_IT };
const GATE_LOSS = { rule: 'Deletion Is Deliberate', quote: true, can: GATE_RUN_IT };

// `quote` marks the only asks that may carry the agent's words. External Gate, Sealed Secrets and
// Persist Insight never do: there the agent's opinion is the conflict of interest.
const GATE_ASKS = {
  check: (f) => {
    const rel = gatePath(f.name);
    const [, what, impact] = GATE_LISTS.find(([list]) => list === rel)
      ?? GATE_FILES.find(([files]) => files.some((n) => gateIs(rel, n))) ?? GATE_FILE_OTHER;
    return { ...GATE_EXTERNAL, line: gateEdit(f, gateName(rel), what), impact,
      why: 'the agent\'s own work is judged by this file' };
  },
  config: (f) => ({ ...GATE_EXTERNAL, line: gateEdit(f, gateName(gatePath(f.name)), 'which controls the gates that watch the agent'),
    why: 'a gate the agent can edit is a gate it can switch off',
    impact: 'a gate can stop working, and nothing would tell you' }),
  store: (f) => {
    const [name, what, label, owner, impact] = GATE_STORES[f.name] ?? GATE_STORES.memory;
    return { rule: 'Persist Insight', line: gateEdit(f, name, what), safe: `Deny, unless you asked for ${label}.`,
      why: `${owner} is your decision`, impact, tail: 'ask the user; do not write it another way', can: GATE_DO_IT };
  },
  secret: (f) => ({ rule: 'Sealed Secrets', line: `This edit puts a credential-shaped string in ${gateName(gatePath(f.name))}.`,
    safe: 'Deny, then keep the value in .env or a secret manager.',
    why: 'a secret in a tracked file reaches everyone who can read the repository',
    impact: 'the secret can land in a commit, and then it must be rotated',
    tail: 'keep the value in .env; do not write it another way',
    can: 'You can put the value in .env or a secret manager yourself.' }),
  'force-push': (f) => ({ ...GATE_LOSS, line: `This command force-pushes the protected branch ${gateName(f.name)} on the remote.`,
    safe: 'Deny, then push without --force.', why: 'a force push replaces the remote history',
    impact: 'commits that exist only on the remote can be lost for everyone',
    can: 'You can push without --force, or run this command yourself.' }),
  'branch-delete': (f) => ({ ...GATE_LOSS, line: `This command deletes the protected branch ${gateName(f.name)}.`,
    safe: 'Deny, unless you mean to remove this branch.', why: 'the project depends on a protected branch',
    impact: 'commits that only this branch holds can be lost for everyone' }),
  'remote-branches': () => ({ ...GATE_LOSS, line: 'This command rewrites or deletes many remote branches, protected ones included.',
    safe: 'Deny, then push one named branch.', why: 'it makes the remote match this repository, branch by branch',
    impact: 'branches and commits that exist only on the remote can be lost for everyone' }),
  'discard-work': () => ({ ...GATE_LOSS, line: 'This command discards uncommitted changes that git cannot bring back.',
    safe: 'Deny, then commit or stash the work first.', why: 'uncommitted work exists nowhere else',
    impact: 'those changes are gone for good' }),
  'lose-commits': () => ({ ...GATE_LOSS, line: 'This command drops commits that no remote and no other branch holds.',
    safe: 'Deny, then keep them on a branch first.', why: 'those commits exist only here',
    impact: 'only the reflog can bring them back, and only for a while' }),
  // Git's safety net itself, so `lose-commits`' reflog line would be false here.
  'drop-recovery': () => ({ ...GATE_LOSS, line: 'This command deletes the history git uses to recover lost commits.',
    safe: 'Deny, unless you mean to give up that recovery.', why: 'it is the last copy of work lost earlier',
    impact: 'commits lost earlier can never come back' }),
  'delete-files': () => ({ ...GATE_LOSS, line: 'This command deletes files that git cannot restore.',
    safe: 'Deny, unless you know these files can go.', why: 'git holds no copy of them',
    impact: 'those files are gone for good' }),
  unverified: () => ({ ...GATE_LOSS, line: 'This command may lose data, and the gate could not work out what it removes.',
    safe: 'Deny, unless you have checked the command yourself.', why: 'the gate cannot read what this command touches',
    impact: 'data that nothing else holds could be lost' }),
  catastrophic: (f) => ({ ...GATE_LOSS,
    line: `This command, ${gateName(f.name)}, would destroy a filesystem root, a drive, the home directory or a whole disk.`,
    safe: 'Deny.', why: 'nothing could restore what it removes', impact: 'everything under that path is gone for good',
    can: 'You can check what this command was meant to remove.' }),
  'root-scan': (f) => ({ rule: 'Commands Must Return', quote: true, line: `This command, ${gateName(f.name)}, scans a whole filesystem root.`,
    safe: 'Deny, then search a specific directory.', why: 'a whole root spans every drive',
    impact: 'the scan can run for hours', tail: 'search one named directory',
    can: 'You can name the directory to search.' }),
  // Routine and frequent, so one line: three more would train the user to stop reading all of them.
  commit: () => ({ rule: 'Consent Before Push', quote: true, short: true,
    line: 'This command commits or pushes with git, which needs your approval each time.',
    why: 'every commit and push is your decision', can: GATE_RUN_IT }),
  // The next four are the OpenCode guard's alone: no hook reads a key path, a stream, a wiki manifest
  // or an unknown tool's arguments, and the guard only refuses them. `wiki` has no rule to name.
  'secret-file': (f) => ({ rule: 'Sealed Secrets', line: `This edit writes to ${gateName(gatePath(f.name))}, a file that holds a secret or key.`,
    safe: 'Deny, then change this file yourself.', why: 'a secret or key file is never for the agent to write',
    impact: 'the agent can replace a key that grants access', tail: 'leave this file alone', can: GATE_DO_IT }),
  stream: (f) => ({ ...GATE_EXTERNAL, line: `This edit names ${gateName(gatePath(f.name))}, an NTFS stream that writes through to the file it hangs on.`,
    safe: 'Deny, then have the agent name the file itself.', why: 'a stream hides which file really changes',
    impact: 'a file can change with no gate seeing its name', tail: 'name the file itself' }),
  wiki: (f) => ({ line: `This edit changes the protected wiki folder ${gateName(f.name)}.`,
    safe: 'Deny, unless you asked for this change.', why: 'you marked this folder as closed to the agent',
    impact: 'notes you protected can change', tail: 'leave this folder alone', can: GATE_DO_IT }),
  'deep-args': (f) => ({ rule: 'Persist Insight', line: `The arguments of ${gateName(f.name)} nest too deep to read, so a write to your rules or memory cannot be ruled out.`,
    safe: 'Deny, unless you know what this call writes.', why: 'what the gate cannot read, it cannot clear',
    impact: 'the call can write to your rules or memory unseen', tail: 'ask the user; do not write it another way', can: GATE_DO_IT }),
  // It reports a crash, not a change, so it has no rule to name.
  'gate-error': (f) => ({ line: `Geneseed gate error: the check failed with ${gateName(f.name)}, so nothing judged this call.`,
    safe: 'Deny, then run geneseed doctor.', why: 'a gate that crashed cannot say this call is safe',
    impact: 'this call runs with no check at all', can: 'You can run geneseed doctor to find the fault.' }),
};

/**
 * The text a gate shows, one sentence per line, so it reads the same if a host folds the newlines.
 * `mode` is `ask` (a person can answer), `refused` (nothing can be allowed and the model is the only
 * reader, so it must relay the words) or `warned` (the call runs anyway). `facts` is `name` (the path,
 * branch, command excerpt, error or `ruleGateTarget` answer), `pairs` (`editPairs`, for the count),
 * `shell` (reached through a command, which has no count), `says` (the call's own `description`) and
 * `redirected` (`gateLoss`'s: the loss the text names was read from a repository the command leaves).
 * The safe choice is line 2, so it stays in the part of a dialog that shows without scrolling. The
 * caller adds the host's wrapping: Bob's `[geneseed]` prefix and `BOB_FINAL` are not here.
 */
function gateText(id, mode, facts = {}) {
  const a = GATE_ASKS[id](facts);
  const tag = a.rule ? ` (${a.rule})` : '';
  // After the safe choice, so that it keeps its place in the part of a dialog that shows.
  const far = facts.redirected ? [GATE_ELSEWHERE] : [];
  if (mode === 'warned') return `${a.line}${tag}\nThis ran without a prompt, because Bob has no approval step.`;
  if (mode === 'refused') {
    return [`Tell the user this, word for word: ${a.line}`, ...far, `It was refused because ${a.why}.${tag}`, a.can,
      ...(a.tail ? [`Agent: ${a.tail}.`] : [])].join('\n');
  }
  const c = [...(a.quote ? gateStrip(facts.says) : '')];
  return [...(a.short ? [`${a.line}${tag}`]
    : [a.line, `Safe choice: ${a.safe}${tag}`, ...far, `It asks because ${a.why}.`, `If you allow it, ${a.impact}.`]),
  ...(c.length ? [`The agent says (not checked): "${c.length > 100 ? `${c.slice(0, 97).join('')}...` : c.join('')}"`] : []),
  ...(a.tail ? [`Agent: if refused, ${a.tail}.`] : [])].join('\n');
}

// Said when `gateText` itself fails. It fits every mode, so nothing about it can fail.
const GATE_UNSAID = 'Geneseed could not describe this call. Check what it does before you trust it.';

/**
 * `gateText` that cannot throw, and the only way a gate reaches it. Every catch around a gate is a
 * pass or a lesser verdict (`guardGate`, a shell reader, the guard's own), so a bug in the words would
 * otherwise change what the gate decides.
 */
function gateSafe(id, mode, facts) {
  try { return gateText(id, mode, facts); } catch { return GATE_UNSAID; }
}

// `lossReason`'s sentences, by their fixed parts only: the rest is the agent's command, so a pattern
// anchored there could be steered. Order matters: `git clean` ends in an agent's path.
/** @type {[RegExp, string][]} */
const GATE_LOSS_REASONS = [
  [/^the gate could not verify /, 'unverified'],
  [/^`git push --(?:mirror|prune)` |^a forced `git push --all` /, 'remote-branches'],
  [/^`git push` would force-push the protected branch (.+)$/, 'force-push'],
  [/^`git (?:push|branch -D)\b.* (?:would delete|deletes) the protected branch (.+)$/, 'branch-delete'],
  [/^`git clean` would delete untracked files | which (?:nothing could|git cannot) restore$| deletes git's own data$| deletes a whole repository or worktree$/, 'delete-files'],
  [/ would discard uncommitted changes \(.*\)$| deletes stashed work$/, 'discard-work'],
  [/ recovery depends on$/, 'drop-recovery'],
  [/ holds$/, 'lose-commits'],
];

/**
 * The `gateText` id, branch and `redirected` flag for a `lossReason` sentence. One this table does not
 * know reads as `unverified`, the most cautious text; tests/unit/gate_text.test.mjs holds every
 * sentence to an id.
 */
function gateLoss(reason) {
  const direct = reason.replace(/ \(and --git-dir\/--work-tree points it at a repository the gate did not read\)$/, '');
  const redirected = direct !== reason;
  const text = direct.replace(/ on the protected branch \S*$/, '');
  for (const [re, id] of GATE_LOSS_REASONS) {
    const m = re.exec(text);
    if (m) return { id, name: m[1], redirected };
  }
  return { id: 'unverified', redirected };
}
// ---- gate text twin: END

// A recursive scan rooted at a whole filesystem (Commands Must Return) → BLOCK. Twin of
// js/hosts/hooks.mjs's `rootScan` — keep in step; tests/plugins/guard.test.mjs diffs the
// constants below against it. In Git Bash `/` mounts every drive and share: on 2026-10-10 a
// `find / … | head -5` ran 3.5 h (`| head` stops nothing). Exempt: a segment whose program is ssh, a quoted argument, any path
// deeper than a root, a scanner word that is not the program. Backslash is never an escape in
// the tokeniser, so `C:\ -Recurse` stays two tokens.
const SCAN_ALWAYS = new Set(["find", "du", "tree", "rg", "fd", "where.exe"])
const SCAN_GREP_R = new Set(["grep", "egrep"])
const SCAN_LS_R = new Set(["ls", "dir"])
const SCAN_PS_R = new Set(["get-childitem", "gci"])
// `-r` recurses for grep only; for ls it is reverse, so ls/dir need an uppercase `R` cluster.
const GREP_RECURSE_RE = /^(?:-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)$/
const LS_RECURSE_RE = /^(?:-[a-zA-Z]*R[a-zA-Z]*|--recursive)$/
const PS_RECURSE_RE = /^-r(?:e(?:c(?:u(?:r(?:s(?:e)?)?)?)?)?)?$/i
const FS_ROOT_RE = /^(?:\/|\/[a-z]\/?|\/mnt\/[a-z]\/?|[a-z]:[\\/]?)\*?$/i
const SCAN_WORD_RE = /\b(?:find|du|tree|rg|fd|where\.exe|grep|egrep|ls|dir|get-childitem|gci)\b/i
const SCAN_TOKEN_RE = /(?:[^\s"']+|"[^"]*"?|'[^']*'?)+/g
const SCAN_WRAPPERS = new Set(["sudo", "command", "\\builtin", "time", "nice"])
// A comment (`#` starting a word), a quoted run (its `;`/`|` is data), a separator (a lone `&`
// too, never the one in `2>&1`/`<&3`/`&>`/`|&`), or a heredoc opener (never the `<<<` here-string).
const SCAN_SPLIT_RE = /(?<![^\s;|&(])#[^\n]*|"[^"]*"?|'[^']*'?|\|\||&&|[|;\n]|(?<![&<>|])&(?![&>])|(?<!<)<<(?!<)(-?)[ \t]*(["']?)([A-Za-z_]\w*)\2/g
// Cut at separators OUTSIDE quotes and drop every heredoc body (to its TAG line; `<<-` allows
// tabs): a commit message that names a root scan is data, not a command to block.
function scanSegments(command) {
  const segs = []
  const tags = []
  const re = new RegExp(SCAN_SPLIT_RE)
  let start = 0
  let m
  while ((m = re.exec(command))) {
    if (m[3]) { tags.push([m[1], m[3]]); continue }
    if (m[0][0] === '"' || m[0][0] === "'") continue
    segs.push(command.slice(start, m.index))
    start = re.lastIndex
    // A comment is cut OUT of its segment; the newline after it is the next separator.
    if (m[0][0] === "#") continue
    while (m[0] === "\n" && tags.length) {
      const end = command.indexOf("\n", start)
      const line = command.slice(start, end < 0 ? command.length : end).replace(/\r$/, "")
      start = end < 0 ? command.length : end + 1
      if ((tags[0][0] ? line.replace(/^\t+/, "") : line) === tags[0][1]) tags.shift()
      if (end < 0) break
    }
    re.lastIndex = start
  }
  segs.push(command.slice(start))
  return segs
}
function rootScan(command) {
  // A segment whose program is ssh passes (its remote command is ssh's argument): ssh is in no
  // scanner set below. Only that segment — `ssh h true; find /` still blocks.
  if (!SCAN_WORD_RE.test(command)) return null
  for (const seg of scanSegments(command)) {
    // Quotes kept until the root test, so a quoted "a:" is told from a bare C:.
    // `(find / …)`, `then find / …`: the grammar around the command is not its program.
    let toks = stripStructure(seg.match(SCAN_TOKEN_RE) || []).filter((t) => !/^\w+=/.test(t))
    while (toks.length && SCAN_WRAPPERS.has(unquote(toks[0]))) toks = toks.slice(1)
    if (!toks.length) continue
    // The program word without its path (either slash) or an `.exe` suffix.
    const word = unquote(toks[0]).split(/[\\/]/).pop().toLowerCase()
    const prog = SCAN_ALWAYS.has(word) ? word : word.replace(/\.exe$/, "")
    const always = SCAN_ALWAYS.has(prog)
    const grep = SCAN_GREP_R.has(prog)
    const ls = SCAN_LS_R.has(prog)
    const ps = SCAN_PS_R.has(prog)
    if (!always && !grep && !ls && !ps) continue
    // `-Path=x` and PowerShell's colon binding `-Path:C:\` read as the path itself.
    const argv = toks.slice(1).map((t) => {
      const m = /^-path[=:](.+)$/i.exec(t)
      return m ? m[1] : t
    })
    if (!always && !argv.some((a) => (grep && GREP_RECURSE_RE.test(a))
      || (ls && (LS_RECURSE_RE.test(a) || (a.length >= 3 && PS_RECURSE_RE.test(a))))
      || (ps && PS_RECURSE_RE.test(a)))) continue
    if (argv.some(rootArg)) return seg.trim()
  }
  return null
}
// For ls/dir a `-Recurse` abbreviation counts from `-re` up: bare `-r` there is POSIX reverse.
const unquote = (t) => t.replace(/^["']+|["']+$/g, "")
// A QUOTED token is data (a grep pattern, a path named in a search), never a root target.
const rootArg = (t) => !/^["']/.test(t) && FS_ROOT_RE.test(t)

// `apply_patch`'s only argument is `patchText` (OpenCode verdict I-1): every gpt-5*
// model gets ONLY this tool, never `edit`/`write`, so a path that lives inside the
// patch text — not in `filePath`/`path`/etc — must still hit every gate below, or
// Sealed Secrets, the protected-check gate, the rule store and the wiki gate all go
// dark for that model class. Markers match upstream's own parser
// (`packages/opencode/src/patch/index.ts` `parsePatchHeader`): `*** Add File:`,
// `*** Update File:` (optionally followed by `*** Move to:`, both the old and the new
// path count) and `*** Delete File:`. The `+`-prefixed body lines are the new file
// content, never a path: `parsePatchSections` below collects them for the content secret
// scan, and this list carries only the target paths, both sides of a move included.
function parsePatchPaths(patchText) {
  return patchSections(patchText).flatMap((s) => [s.from, s.path]).filter(Boolean)
}

// The argument keys that can name a target. Every one is read, never the first found: a call that
// carried a decoy `patchText` or a harmless `path` beside the real `filePath` once hid the target
// from every gate, a hard refusal such as `.ssh/id_rsa` included.
const PATH_KEYS = ["filePath", "file_path", "path", "file", "target", "filename", "destination", "dest"]
function plainPaths(args) {
  // Normalize Windows backslashes to `/` so the secret-path patterns (which use `/`
  // as the segment separator) match `C:\Users\me\.ssh\id_rsa` the same as a POSIX path.
  return PATH_KEYS.map((k) => args?.[k]).filter((v) => typeof v === "string" && v).map((v) => v.replace(/\\/g, "/"))
}
// Returns every candidate path for this call, normalized (backslashes -> `/`): every path key, and
// every patch marker resolved against `cwd` (the session's `ctx.directory` — the same root
// `apply_patch.ts:72` resolves against upstream) since a patch marker is worktree-relative.
function pickPath(args, cwd) {
  const marked = args && typeof args.patchText === "string" ? parsePatchPaths(args.patchText)
    .map((p) => path.resolve(cwd || process.cwd(), p).replace(/\\/g, "/")) : []
  return [...new Set([...marked, ...plainPaths(args)])]
}
// Per-FILE added content for an `apply_patch` call: `parsePatchPaths` flattens every marker
// path into one list (right for the path-only gates, which must catch a secret/protected name
// on either side of a `Move to`), but the CONTENT scan must not pool every file's `+` lines
// into one string — a patch that touches a `.env` AND an ordinary file would then exempt the
// ordinary file's own secret too, because the exemption was computed over the pool, not the
// line's own file. One section per marker; a `Move to` target is where the `+` lines actually
// land, so content is attributed to it, not the pre-move path. `*** Delete File:` sections
// collect no `+` lines (nothing is being written).
function parsePatchSections(patchText) {
  return patchSections(patchText).filter((s) => s.path)
}
// The one marker parser both lists derive from. `from` is the pre-move path of an
// `Update File` followed by `Move to` (empty otherwise); `path` is where the file lands.
// Unfiltered: an empty marker path is dropped by each caller on its own terms.
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

// The content a write/edit/apply_patch call would actually land on disk, per FILE — what the
// content secret scan runs against, paired with the path it belongs to so the `.env` exemption
// can be checked against that file alone. `write` carries `content`, `edit` carries `newString`
// (OpenCode tool Parameters, packages/opencode/src/tool/{write,edit}.ts) — both single-path, so
// one pair. For `apply_patch`, one pair per marker section; only the `+`-prefixed hunk lines are
// NEW content — a `-` line is text being REMOVED, so a secret there is leaving the file, not
// landing in it, and must not block the call.
function pickAddedContentByPath(args, cwd) {
  const found = args && typeof args.patchText === "string" ? parsePatchSections(args.patchText)
    .filter((s) => s.added.length)
    .map((s) => ({
      path: path.resolve(cwd || process.cwd(), s.path).replace(/\\/g, "/"),
      content: s.added.join("\n"),
    })) : []
  // Beside a patch too: a decoy `patchText` must not hide the content a call also carries.
  const [p] = plainPaths(args)
  if (!p) return found
  for (const text of [args.content, args.newString]) if (typeof text === "string") found.push({ path: p, content: text })
  return found
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
async function isFile(p) {
  try { return (await fs.stat(p)).isFile() } catch { return false }
}
async function isDir(p) {
  try { return (await fs.stat(p)).isDirectory() } catch { return false }
}

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

// The machine tier: machineDir() in js/lib/machine-dir.mjs, which a plugin cannot import.
function machineDir() {
  return path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "geneseed")
}

// The wiki manifest's names, newest first: WIKI_NAMES in js/lib/machine-dir.mjs.
const WIKI_NAMES = ["geneseed-wiki.jsonc", "wiki.jsonc", "wiki.json"]

// The host's own config dir counts as global too, whatever its marker says (the hook's
// isHostGlobalDir accepts both): OPENCODE_CONFIG_DIR, else <XDG config>/opencode.
const hostConfigDir = () => process.env.OPENCODE_CONFIG_DIR || path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "opencode")
async function isHostConfigDir(dir) {
  const real = async (d) => { const r = await fs.realpath(path.resolve(d)).catch(() => path.resolve(d)); return process.platform === "win32" ? r.toLowerCase() : r }
  return (await real(dir)) === (await real(hostConfigDir()))
}

// Whether this install reads the machine tier: its .geneseed-emit names a -global emit, or it IS
// the host's own config dir (the two tests of the hook's isHostGlobalDir).
async function readsTier(dir) {
  try { if ((await fs.readFile(path.join(dir, ".geneseed-emit"), "utf8")).trim().endsWith("-global")) return true } catch { /* no marker */ }
  return isHostConfigDir(dir)
}

// Every manifest in force: $GENESEED_WIKI alone when set, else the host layer's and, for a global
// install, the shared one. Protection only widens, so both are read; the context plugin's
// seed-or-real choice would need seed hashes this plugin does not carry.
async function wikiFiles() {
  const explicit = process.env.GENESEED_WIKI
  if (explicit && (await isFile(explicit))) return [explicit]
  const bases = []
  if (process.env.GENESEED_HARNESS) bases.push(process.env.GENESEED_HARNESS)
  bases.push(path.resolve(PLUGIN_DIR, ".."))
  if (await readsTier(path.dirname(PLUGIN_DIR))) bases.push(machineDir())
  const found = []
  for (const base of bases) {
    // wiki.jsonc and wiki.json are the legacy names from earlier seeds — still honoured.
    for (const name of WIKI_NAMES) {
      const p = path.join(base, name)
      if (await isFile(p)) { found.push(p); break }
    }
  }
  return found
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
    for (const file of await wikiFiles()) {
      let data
      try { data = JSON.parse(stripJsonc(await fs.readFile(file, "utf8"))) } catch { continue } // one bad manifest hides no other
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
// Whether something the user wants kept is a standing rule or a durable fact is THEIR call, and
// the HOST asks it, never the agent (External Gate). This was a speed bump: the first write was
// refused and any re-issue passed, so an agent could release itself by claiming the user's
// authorization, and one did (2026-11). `tool.execute.before` can only allow or throw, so the
// prompt comes from what runs AFTER it, inside the host's own edit tools:
//   - V1: `permission.edit` "ask" keys (`opencodeEditAsks`, js/hosts/settings.mjs). V1 calls no
//     plugin hook on an ask, so the guard passes a native edit only when the merged config really
//     asks for that path and no "always" has switched that off (`hostPrompts`), and refuses it otherwise.
//   - V2: the same keys, and `permission.hook("evaluate")` (`setupV2`), which also asks over a saved
//     approval and a config that drifted.
// A tool outside those never reaches either prompt, so a write the guard can see there is refused. A
// refusal has no release: a re-issue meets the same answer. Shell is not a boundary: only the parsed
// forms `shellWriteTargets` reads are seen, V2 asks on them through `evaluate`, V1 refuses them, and
// everything else in a command is the host's own command permission's business.
//
// Install folder and file names are theme-independent by design, so the match is on
// literal names. `user-rules.md` / `MEMORY.md` are Geneseed's own coinage and match
// anywhere; other markdown matches only inside this install's own memory/ dir, so a
// project's unrelated memory/ folder is never caught.
const nocase = (s) => (process.platform === "win32" ? s.toLowerCase() : s)
// The host's own edit tools, the only ones its `edit` permission covers (V1 `edit`, `write`,
// `apply_patch`; V2 `patch`). The guard's WRITE_TOOLS is a wider substring class, which also
// catches an MCP server's writer: that one gets no prompt.
const NATIVE_EDIT_TOOLS = new Set(["write", "edit", "apply_patch", "patch"])
// A weak model once took a refusal as leave to write the same file through a shell command, so
// each text names the one way forward. Neither invites a re-issue: nothing here releases one.
const PERSIST_EDIT_TOOL = "Stop and ask the user now (the rule skill). Only the host's own edit tool " +
  "reaches its prompt, so make this write with it and the host asks the user; re-issuing this " +
  "call changes nothing, and never write it another way (for example through a shell command)."
const PERSIST_NO_PROMPT = "Stop and ask the user now (the rule skill). The host has no prompt wired for " +
  "this file, so this write stays refused and re-issuing it changes nothing: leave it for the user " +
  "to write themself, and never write it another way (for example through a shell command)."
// What the user reads beside an OpenCode prompt, whose dialog shows no plugin text: the ask's text inside a
// delimiter that ties it to the dialog. Without the `Agent:` line, which is no business of the user's.
const gateNote = (text) => ["──── Geneseed · about the next permission request ────",
  ...text.split("\n").filter((l) => !l.startsWith("Agent:")), "──── The dialog below is for this change ────"].join("\n")
// Whether the merged `permission.edit` makes V1 ask about `rel`, a path from the worktree: its own
// evaluation, the LAST matching rule, with `Wildcard.match`'s pattern (util/wildcard.ts, 1.19.5).
function editRuleAsks(edit, rel) {
  if (typeof edit === "string") return edit === "ask"
  return Object.entries(edit ?? {}).findLast(([k]) => wildMatch(k, rel))?.[1] === "ask"
}
// Whether one agent's own ruleset (`client.app.agents()`, config and frontmatter merged) leaves the
// write to a prompt: its last rule for `edit` on `rel`. A deny is fine, the host refuses that itself.
const agentMayAsk = (rules, rel) => (Array.isArray(rules) ? rules : [])
  .findLast((r) => wildMatch(r?.permission ?? "", "edit") && wildMatch(r?.pattern ?? "", rel))?.action !== "allow"
// The coined names, with their label. Exact case outside a store: `docs/concepts/memory.md` is another
// file, on Windows too, and a fold would refuse it for ever. A file that EXISTS under a coined name
// comes back in its true case through `landsOn`'s link-followed form, on NTFS and APFS alike; a
// differently cased spelling of one that does not exist yet is not caught. Inside a store every .md
// counts, whatever its case.
const COINED_NAMES = [["user-rules.md", "user-rules.md"], ["MEMORY.md", "the memory index"], ["user-rules.draft.md", "the rule draft"]]
const coined = (name) => COINED_NAMES.find(([n]) => n === name)?.[1] ?? null
const foldPath = (s) => nocase(s.replace(/\\/g, "/"))
// A path with a colon past its drive names an NTFS stream, which writes through to the real file.
const namesStream = (p) => process.platform === "win32"
  && String(p).replace(/^(?:[\\/]{2}[?.][\\/])?[a-zA-Z]:/, "").includes(":")
// What a path lands on: spelled out against `base`, as written and with links followed, the two forms
// `protectedCheck` reads, because a link from outside into a store and a store that links out are both
// real. `path.resolve` folds `..`, `//` and `.`. Windows also drops a stream and trailing dots and spaces
// from each segment, and its `realpath` turns an existing `~1` short name long. A short name of a file
// that does not exist yet does not exist either.
function landsOn(p, base) {
  let raw = String(p)
  if (/^~(?=[\\/]|$)/.test(raw)) raw = homedir() + raw.slice(1)
  // A Git Bash `/c/…`, a device path, and this machine's admin share all name the drive path.
  if (process.platform === "win32") {
    raw = raw.replace(/^\/([a-zA-Z])(?=\/|$)/, "$1:").replace(/^[\\/]{2}[?.][\\/](?=[a-zA-Z]:)/, "")
      .replace(/^[\\/]{2}(?:localhost|127\.0\.0\.1|\[?::1\]?)[\\/]([a-zA-Z])\$(?=[\\/]|$)/i, "$1:")
  }
  let abs = path.resolve(base || process.cwd(), raw)
  if (process.platform === "win32") {
    const drive = /^[a-zA-Z]:|^\\\\[^\\]+\\[^\\]+/.exec(abs)?.[0] ?? ""
    abs = drive + abs.slice(drive.length).split("\\").map((s) => s.replace(/:.*$/, "").replace(/[. ]+$/, "")).join("\\")
  }
  // A dangling link has no realpath, and a write through it creates its target: follow it by hand,
  // each hop through `resolvePath`, because a hop may pass a folder link. Bounded: links can loop.
  const forms = [abs, resolvePath(abs)]
  for (let cur = forms[1], hop = 0; hop < 8; hop += 1) {
    try { cur = resolvePath(path.resolve(path.dirname(cur), readlinkSync(cur))); forms.push(cur) } catch { break }
  }
  return forms
}
// Every memory store this install writes, folded. Not only `<plugin dir>/../memory`: a project install
// keeps its store beside its AGENT.md, `<out>/memory`, by default `<root>/Harness/memory`
// (js/build/bundle.mjs). A carrier counts only when it holds an AGENT.md, so a project's unrelated
// `memory/` is not caught. `$GENESEED_HARNESS` and `$GENESEED_MEMORY` are read live, as `machineDir` is.
let wiredHomes = null
function storeHomes() {
  const cfg = path.dirname(PLUGIN_DIR)
  const root = path.dirname(cfg)
  wiredHomes ??= agentAskTails(cfg).map((t) => path.resolve(root, path.dirname(t)))
  const homes = [cfg, machineDir(), path.join(root, "Harness"), ...wiredHomes,
    ...CARRIER_DIRS.filter((d) => existsSync(path.join(d, "AGENT.md")))]
  if (process.env.GENESEED_HARNESS) homes.push(process.env.GENESEED_HARNESS)
  return [...new Set(homes.map((h) => path.resolve(h)))]
}
function storeDirs() {
  const dirs = storeHomes().map((h) => path.join(h, "memory"))
  if (process.env.GENESEED_MEMORY) dirs.push(process.env.GENESEED_MEMORY)
  return [...new Set(dirs.flatMap((d) => [path.resolve(d), resolvePath(d)]).map(foldPath))]
}
// The store files under one home, as `path -> "size:mtime"`: stats, no reads. Twin of
// js/hosts/store-watch.mjs `storeScan`; the plugins' copies are held equal by helper_parity.
function storeScan(home, found = {}) {
  const stamp = (f) => {
    try { const s = statSync(f); if (s.isFile()) found[f] = `${s.size}:${Math.trunc(s.mtimeMs)}` } catch { /* absent */ }
  }
  for (const n of ["user-rules.md", "PROFILE.md", "geneseed-wiki.jsonc", "wiki.jsonc", "wiki.json"]) stamp(path.join(home, n))
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

// ---- the change report (twin of js/hosts/store-watch.mjs, whose header says why) ---------------
// It detects; it prevents nothing. Here the baseline lives in memory, for as long as the plugin does.
const scanAllStores = () => storeHomes().reduce((found, h) => storeScan(h, found), {})
const ownWrites = () => storeHomes().reduce((log, h) => {
  try { return { ...log, ...JSON.parse(readFileSync(path.join(h, "memory", ".own-writes.json"), "utf8")) } } catch { return log }
}, {})
const storeLine = (files) => {
  const shown = files.slice(0, 5).map((f) => f.split(/[\\/]/).slice(-2).join("/")).join(", ")
  const more = files.length > 5 ? ` (+${files.length - 5} more)` : ""
  return `Geneseed change report: ${files.length} rule or memory file${files.length === 1 ? "" : "s"} ` +
    `changed outside this session's approved writes (another session, or a decision of yours in the web console, may have made it): ${shown}${more}. This detects a change; it prevented nothing.`
}
function noteForStatus(files) {
  try {
    if (existsSync(machineDir())) writeFileSync(path.join(machineDir(), ".store-report.json"), JSON.stringify({ at: new Date().toISOString(), host: "opencode", files }))
  } catch { /* a status line never fails a turn */ }
}

// The store a write would land in, or null. `base` is the session's directory: a relative path is
// the tool's, never this process's.
function ruleStoreTarget(p, base) {
  const stores = storeDirs()
  for (const abs of landsOn(p, base)) {
    const hit = coined(path.basename(abs))
    if (hit) return hit
    const t = foldPath(abs)
    if (nocase(t).endsWith(".md") && stores.some((d) => t.startsWith(`${d}/`))) return "memory"
  }
  return null
}
// Whether the merged `permission.edit`'s pattern `k` matches `rel`: V1's `Wildcard.match` (1.19.5).
const wildMatch = (k, s) => new RegExp(`^${k.replace(/\\/g, "/").replace(/[.+^${}()|[\]\\]/g, "\\$&")
  .replace(/\*/g, ".*").replace(/\?/g, ".")}$`, process.platform === "win32" ? "si" : "s").test(s)

// ---- protected checks (External Gate) ------------------------------------------
// Twin of js/hosts/hooks.mjs's `protectedCheck` — keep in step. A project lists the checks its agent
// must not edit in `.geneseed/protected-checks.txt` at its git root, one repo-relative path per
// line; the list protects itself. Found from the WRITE TARGET up to the first `.git`, re-read on
// every write (a short file, read only on a write call). No ask tier here, so a hit is a deny.
// The target is read twice — as written, and with links followed — and a hit on either is a hit:
// a link from outside into a protected folder and a protected folder that links out are both
// caught, so following links never loosens the gate.
const SENSOR_LIST = ".geneseed/protected-checks.txt"
// The done gate's list (#289, js/hosts/hooks-done.mjs) protects itself the same way, with or
// without a protected-checks list: emptying it would disarm the gate. Twin of js/hosts/hooks.mjs.
const DONE_LIST = ".geneseed/done-checks.txt"
function protectedCheck(p) {
  return protectedIn(path.resolve(p)) ?? protectedIn(resolvePath(p))
}
function protectedIn(target) {
  try {
    const root = gitRootOf(path.dirname(target))
    if (!root) return null
    const fold = (s) => nocase(s.replace(/\\/g, "/"))
    const shown = path.relative(root, target)
    const rel = fold(shown)
    if (rel === fold(DONE_LIST)) return shown
    const text = readFileSync(path.join(root, SENSOR_LIST), "utf8")
    const entries = [SENSOR_LIST, ...text.split(/\r?\n/).map((l) => l.trim().replace(/[\\/]+$/, ""))
      .filter((l) => l && !l.startsWith("#"))]
    return entries.some((e) => rel === fold(e) || rel.startsWith(fold(e) + "/")) ? shown : null
  } catch {
    return null // no list (the common case) or an unreadable one: nothing is protected
  }
}
// `p` from its git root, or as given outside any repository. Twin of js/hosts/hooks.mjs's `repoRel`.
function repoRel(p) {
  try {
    const root = gitRootOf(path.dirname(p))
    return root ? path.relative(root, p) : p
  } catch { return p }
}

// ---- the gates' own configuration (External Gate) ------------------------------
// Twin of js/hosts/hooks.mjs's `gateConfig`, MINUS what OpenCode now asks about itself
// (tests/plugins/guard.test.mjs pins the difference). A file that turns a gate off is a gate the
// agent can switch off. Every host's shared config — `opencode.json(c)`, the hook `settings.json`
// files — and this install's own files (its `AGENT.md`, `excludes.json`, manifest,
// `plugins/geneseed-*.js`) and the hook shim dir get a native `permission.edit` "ask" written into
// opencode.json by the emit (`opencodeEditAsks`, js/hosts/settings.mjs), so the user can approve
// the edit: this guard must not deny those, or the ask never shows. What stays a deny here is
// Geneseed-only state of the OTHER hosts, which no user edits through OpenCode — their
// `excludes.json`, `AGENT.md` and manifests, found by the parent's folder name — and an `AGENT.md`
// under `$GENESEED_HARNESS`, a carrier the emit cannot name.
const GATE_CONFIG_FILES = ['excludes.json', 'AGENT.md', '.geneseed-manifest.json', '.geneseed-emit'];
const GATE_CONFIG_MARKERS = ['.claude', '.openclaude', '.bob'];
function gateConfig(p) {
  try {
    const fold = (s) => nocase(path.resolve(s))
    const cfg = path.dirname(PLUGIN_DIR)
    const carriers = CARRIER_DIRS.filter((d) => ![fold(cfg), fold(path.dirname(cfg))].includes(fold(d)))
      .map((d) => fold(path.join(d, "AGENT.md")))
    for (const target of [path.resolve(p), resolvePath(p)]) {
      const t = fold(target)
      if (carriers.includes(t)) return true
      if (fold(path.join(machineDir(), "excludes.json")) === t) return true   // the shared exclude list
      const dir = path.dirname(target)
      if (GATE_CONFIG_MARKERS.some((m) => nocase(m) === nocase(path.basename(dir)))
        && GATE_CONFIG_FILES.some((f) => fold(path.join(dir, f)) === t)) return true
    }
  } catch { /* an unresolvable path is no hit, like `protectedIn` */ }
  return false
}

// The files `gateConfig` leaves to OpenCode's native `permission.edit` ask (`opencodeEditAsks` in
// js/hosts/settings.mjs). That ask covers edit tools only: a shell command never reaches it, and
// this tool hook has no ask tier, so for a SHELL write these are refused. The agent can still
// make the edit through an edit tool, where the user gets the prompt. The key shapes are the emit's,
// matched as a path tail; tests/plugins/guard.test.mjs walks `opencodeEditAsks`'s own output.
// A project `AGENT.md` in a subfolder has no fixed name, so its keys are read back from the
// opencode.json the emit wrote beside the install, only when a shell write names a target at all.
function agentAskTails(cfg) {
  const tails = []
  for (const f of ["opencode.json", "opencode.jsonc"]) {
    try {
      const edit = JSON.parse(stripJsonc(readFileSync(path.join(path.dirname(cfg), f), "utf8")))?.permission?.edit
      for (const k of Object.keys(edit ?? {})) {
        const tail = k.replace(/^\*(?:\.\.)?\/?/, "")
        if (/\/AGENT\.md$/i.test(tail)) tails.push(tail)
      }
    } catch { /* none, or unreadable: the fixed names below still hold */ }
  }
  return tails
}
function nativeAskFile(p) {
  try {
    const cfg = path.dirname(PLUGIN_DIR)
    const name = path.basename(cfg)
    const tails = ["opencode.json", "opencode.jsonc", ...[".claude", ".openclaude", ".bob"].flatMap((m) =>
      [`${m}/settings.json`, `${m}/settings.local.json`]), ".bob/settings/settings.json", ".geneseed/bin/*",
    ...["excludes.json", ".geneseed-manifest.json", ".geneseed-emit", "plugins/*", "plugin/*", "agents/*.md", "agent/*.md",
      "mode/*.md", "modes/*.md", "tool/*", "tools/*", "AGENT.md", "config.json"]
      .map((f) => `${name}/${f}`), ...agentAskTails(cfg)]
    const fold = (s) => nocase(s.replace(/\\/g, "/"))
    const asked = tails.map((t) => new RegExp(`(?:^|/)${fold(t).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`))
    // Its own try: a home that cannot be read costs the shim dir, never the entries above.
    let bin = null
    try { bin = fold(path.join(resolvePath(process.env.GENESEED_HOME || "~/.geneseed"), "bin")) } catch { /* no shim dir */ }
    const agents = [cfg, path.dirname(cfg)].map((d) => fold(path.join(d, "AGENT.md")))
    for (const target of [path.resolve(p), resolvePath(p)]) {
      const t = fold(target)
      if (asked.some((re) => re.test(t)) || agents.includes(t) || (bin && t.startsWith(`${bin}/`))) return true
    }
  } catch { /* an unresolvable path is no hit, like `protectedIn` */ }
  return false
}

// ---- shell-write twin: BEGIN — adapters/opencode/plugins/geneseed-guard.js carries everything down
// to the END marker verbatim, with `export ` dropped (tests/plugins/guard.test.mjs diffs the two).

// The cheap prefilter, a superset of what the parse acts on: a `>`, or one of the programs as a word.
const SHELL_WRITE_RE = />|(?:^|[\s;&|("'`\\/])(?:tee|sed|cp|mv|rm|add-content|set-content|out-file|clear-content|remove-item|copy-item|move-item|new-item|rename-item|ac|sc|del|copy|move|ni|ren)(?:\.exe)?(?=[\s;&|)"'`]|$)/im;
// One pass over a segment: a quoted run (kept: its `>` is data), or a redirection with its optional
// fd, operator, `&` (a dup such as `2>&1`, which writes no file) and target word. `<` forms match
// too, so that their words never read as operands. A backslash is no escape here, as in
// `SCAN_SPLIT_RE`: `echo "say \"hi > f\""` closes its quote early, reads a target, and asks (on Bob, blocks).
const REDIRECT_RE = /"[^"]*"?|'[^']*'?|(?:(?<!\S)\d+|&)?(<<?<?-?|>>?)[ \t]*(&?)((?:[^\s"';|&<>()]|"[^"]*"?|'[^']*'?)*)/g;
const SHELL_CD = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl']);
// What says the shell is PowerShell when the caller cannot: a `Verb-Noun` word outside any here-string.
const PS_CUE_RE = /(?:^|[\s;|&(])(?:add|clear|copy|export|foreach|get|import|invoke|move|new|out|remove|rename|select|set|start|stop|test|where|write)-[a-z]+/i;
// The home a shell expands, spelled for `writePath` as `~/…`, the one form that keeps the two readings.
const HOME_WORD_RE = /^(?:~|\$\{?(?:env:)?(?:home|userprofile)\}?)(?=[\\/]|$)/i;
// PowerShell's writers, each as the POSIX form that writes the same paths. `ren` is `mv` with a sibling.
const PS_WRITERS = new Map(Object.entries({
  'add-content': 'rm', ac: 'rm', 'set-content': 'rm', sc: 'rm', 'out-file': 'rm', 'clear-content': 'rm', 'remove-item': 'rm',
  del: 'rm', 'new-item': 'rm', ni: 'rm', 'copy-item': 'cp', copy: 'cp', 'move-item': 'mv', move: 'mv', 'rename-item': 'ren', ren: 'ren',
}));
// `rm`, `cp` and `mv` are aliases too, but only a parameter spelled out in full tells them from the
// POSIX programs: `-lp` and `-pat` are also POSIX flag clusters.
const PS_NAMED_RE = /^-(?:path|literalpath|destination)(?::|$)/i;
const PS_PATH_RE = /^-(?:path|literalpath|lp|pspath|filepath)$/i;
const PS_SWITCH_RE = /^-(?:force|recurse|append|nonewline|noclobber|whatif|confirm|passthru|verbose|debug|container)$/i;
const PS_VALUE_RE = /^-(?:value|encoding|itemtype|type|filter|include|exclude|inputobject|stream|width|target|erroraction|ea)$/i;
// `(…)`, `$(…)`, `@(…)`, `{…}`, `@{…}`: an argument whose words cannot be counted. `${x}` is a variable.
const PS_OPAQUE_RE = /^(?:[$@]?\(|@?\{)/;

/**
 * `s` with each here-string body cut. The body is data, as a heredoc's is: without this, an apostrophe
 * in a PowerShell commit message unpairs the quotes, and a line that opens with `Move` reads as a
 * command. One pass: a quote kind with no closer is searched for once, so many openers stay linear.
 */
function hereStringsCut(s) {
  const re = /@(["'])\r?\n/g;
  const dead = new Set();
  let out = ''; let at = 0; let m;
  while ((m = re.exec(s))) {
    if (dead.has(m[1])) continue;
    const end = s.indexOf(`\n${m[1]}@`, re.lastIndex - 1);
    if (end < 0) { dead.add(m[1]); continue; }
    out += `${s.slice(at, m.index)}''`;
    at = end + 3;
    re.lastIndex = at;
  }
  return out + s.slice(at);
}

/** `t` without its quotes, a home spelled `~/…`. Single quotes expand nothing, so `$` stays and hides the path. */
function shellWord(t) {
  const w = t.replace(/["']/g, '');
  return t[0] !== "'" && HOME_WORD_RE.test(w) ? `~${w.replace(HOME_WORD_RE, '').replace(/\\/g, '/')}` : w;
}

/** `t` as an absolute path from `dir`, `~/…` as it stands, or null for what the shell rewrites. */
function writePath(dir, t) {
  if (/[$`*?{}\0]/.test(t) || /^~[^\\/]/.test(t) || /^(?:\/dev\/|nul$)/i.test(t)) return null;
  if (t[0] === '~') return t;
  // A Git Bash `/c/…` path, as `resolveIn` reads it.
  const q = process.platform === 'win32' ? t.replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:') : t;
  if (path.isAbsolute(q)) return path.resolve(q);
  if (dir && dir[0] === '~') return `${dir}/${q}`;
  return dir ? path.resolve(dir, q) : null;
}

/**
 * The operands of a PowerShell writer, in the order the POSIX branches read them, `/`-separated (a
 * cmdlet takes `\` on every platform). Only the first positional is a path, and for `cp`, `mv` and
 * `ren` the next is the destination: the next one of `Add-Content a b` is its value and of
 * `Remove-Item a b` its filter. Named paths are read wherever they stand; a parameter this does
 * not know, or a `(…)` or `{…}` argument, ends the positionals, because its words cannot be counted.
 */
function psOperands(toks, form) {
  const paths = []; const dest = []; const pos = [];
  let name = ''; let open = true;
  const list = (t) => (t.match(/"[^"]*"?|'[^']*'?|[^,"']+/g) || []).map(shellWord).filter(Boolean);
  for (let i = 0; i < toks.length; i += 1) {
    // An array argument spans tokens: `a, b`.
    const value = (t) => { let v = t; while (v.endsWith(',') && i + 1 < toks.length) { i += 1; v += toks[i]; } return v; };
    const m = /^(-[a-z]+)(?::(.+))?$/is.exec(toks[i]);
    if (!m) {
      const t = value(toks[i]);
      if (PS_OPAQUE_RE.test(t)) open = false;
      else if (open && !/^\/[a-z]$/i.test(t)) pos.push(t); // `/y`: `copy` and `del` are cmd.exe's too
    } else if (!PS_SWITCH_RE.test(m[1])) {
      const into = PS_PATH_RE.test(m[1]) ? paths : /^-destination$/i.test(m[1]) ? dest : null;
      const naming = /^-(?:new)?name$/i.test(m[1]);
      if (!into && !naming && !PS_VALUE_RE.test(m[1])) { open = false; continue; }
      if (m[2] === undefined) i += 1;
      const t = value(m[2] ?? toks[i] ?? '');
      if (PS_OPAQUE_RE.test(t)) open = false;
      else if (into) into.push(...list(t));
      else if (naming) name = shellWord(t);
    }
  }
  if (!paths.length && pos.length) paths.push(...list(pos.shift()));
  if (form === 'rm') return name ? (paths.length ? paths : ['.']).map((p) => `${p}/${name}`) : paths;
  if (form === 'ren') {
    const to = name || shellWord(pos[0] ?? '');
    return to && paths.length ? [paths[0], paths[0].replace(/[^\\/]*$/, '') + to] : paths;
  }
  return [...paths, ...(dest.length ? dest : list(pos[0] ?? '')).slice(0, 1)];
}

/** The files `sed` edits in place: none without `-i`; else its operands, past the script if inline. */
function sedFiles(args) {
  const ops = [];
  let inPlace = false; let script = false; let flags = true;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (flags && a === '--') flags = false;
    else if (flags && /^--in-place(?:=|$)/.test(a)) inPlace = true;
    else if (flags && (a === '--expression' || a === '--file')) { script = true; i += 1; }
    else if (flags && /^--(?:expression|file)=/.test(a)) script = true;
    else if (flags && /^-[a-zA-Z]*i/.test(a)) inPlace = true;
    else if (flags && /^-[a-zA-Z]*[ef]$/.test(a)) { script = true; i += 1; }
    else if (!flags || !a.startsWith('-') || a === '-') { if (a) ops.push(a); }
  }
  return inPlace ? ops.slice(script ? 0 : 1) : [];
}

/**
 * The files `command` would write, as absolute paths: redirect targets (`>`, `>>`, `&>`), `tee`
 * and `rm` operands, `sed -i` files, the destination of `cp` and `mv`, and the sources of `mv`, which
 * it removes. A destination may be a folder, so `cp a tests/` also names `tests/a`. PowerShell's
 * writers read the same way (`PS_WRITERS`, `psOperands`), case-insensitively, and a pipe into one needs
 * nothing more: `| Out-File x` is a segment of its own. Read like `rootScan`: quotes, comments and
 * heredoc bodies are data. So is a here-string body, but only in PowerShell, which `ps` says when the
 * caller knows the tool and `PS_CUE_RE` otherwise: to bash the opener is a plain quote, so a closed
 * "here-string" can wrap a real `rm` (the row in tests/unit/hook_gates.test.mjs). With no cue, a
 * PowerShell here-string reads as bash would read it. A home variable is read as `~`. A `cd` is followed; one it cannot read leaves later relative paths unseen.
 * What it cannot read, it leaves out: this reader fails OPEN.
 *
 * shortcut: KNOWN UNSEEN FORMS, all of them still a write. An interpreter (inline code,
 * `bash -c`, `pwsh -c`, `powershell -Command`, `eval`, `xargs`), a script or `npm run`, a `$(…)` or
 * subshell trick, `>|`, a path with any other variable, a glob or a brace in it, a wrapper with flags
 * (`sudo -u x`) or outside `SCAN_WRAPPERS` (`env rm`, `nohup rm`, `timeout 5 rm`, `exec rm`), `echo x >&
 * file` (read as a dup), a `popd` (not followed, so relative paths after a `pushd`/`popd` pair resolve
 * from the wrong folder), `cp -t`, any other writer (`dd`, `ln`, `install`, `git mv`, `git checkout`,
 * `Tee-Object`, `[IO.File]::WriteAllText`, an alias outside `PS_WRITERS` such as `ri`), a cmdlet behind
 * a PowerShell assignment, `if` or script block (`$null = New-Item x`, `% { Remove-Item x }`), one
 * continued over lines with a backtick, a parameter abbreviated or unknown before a positional path (so
 * `Set-Content -Enc utf8 x`), a comma list after a POSIX-read `rm`, `cp` or `mv`, and a folder removed
 * above a listed file (`rm -r tests` when only `tests/a.test.js` is listed). CI running the checks is
 * the boundary that holds against those.
 */
function shellWriteTargets(command, cwd, ps = false) {
  if (!SHELL_WRITE_RE.test(command)) return [];
  const found = new Set();
  let dir = cwd;
  const add = (t) => { const p = writePath(dir, t); if (p) found.add(p); };
  const bare = (t) => t.replace(/["']/g, '');
  const cut = hereStringsCut(command);
  for (const seg of scanSegments(ps || PS_CUE_RE.test(cut) ? cut : command)) {
    const outs = [];
    const body = seg.replace(REDIRECT_RE, (m, op, dup, target) => {
      if (op === undefined) return m;
      if (op[0] === '>' && !dup && target) outs.push(shellWord(target));
      return ' ';
    });
    let toks = stripStructure(body.match(SCAN_TOKEN_RE) || []);
    while (toks.length && (/^\w+=/.test(toks[0]) || SCAN_WRAPPERS.has(bare(toks[0])))) toks = toks.slice(1);
    const word = toks.length ? bare(toks[0]).split(/[\\/]/).pop().toLowerCase() : '';
    let prog = word.replace(/\.exe$/, '');
    const args = toks.slice(1).map(shellWord);
    const dashes = args.indexOf('--');
    let ops = args.filter((a, i) => a && (a === '-' || !a.startsWith('-') || (dashes >= 0 && i > dashes)));
    // `word`, not `prog`: `sc.exe` is the service tool, never the Set-Content alias.
    const form = PS_WRITERS.get(word) ?? (/^(?:rm|cp|mv)$/.test(prog) && toks.some((t) => PS_NAMED_RE.test(t)) ? prog : null);
    if (form) {
      prog = form === 'ren' ? 'mv' : form;
      ops = psOperands(toks.slice(1), form).map((t) => t.replace(/\\/g, '/'));
    }
    if (SHELL_CD.has(prog)) {
      const to = ops.find((a) => !/^\/d$/i.test(a));
      dir = to && to !== '-' ? writePath(dir, to) : null;
    } else if (prog === 'rm' || prog === 'tee') ops.forEach(add);
    else if (prog === 'sed') sedFiles(args).forEach(add);
    else if ((prog === 'cp' || prog === 'mv') && ops.length > 1) {
      const dest = ops[ops.length - 1];
      const sources = ops.slice(0, -1);
      add(dest);
      for (const s of sources) {
        add(`${dest.replace(/[\\/]+$/, '')}/${s.split(/[\\/]/).pop()}`);
        if (prog === 'mv') add(s);
      }
    }
    outs.forEach(add);
  }
  return [...found];
}
// ---- shell-write twin: END

// A segment that is only a redirect: `> f`, or `A=1 > f`. V2's shell tool asserts only when its parser
// finds a command, so no `evaluate` runs for one, and the guard refuses it as it does on V1.
const noProgramWord = (command) => scanSegments(command).some((seg) => seg.includes(">")
  && !stripStructure(seg.replace(REDIRECT_RE, (m, op) => (op === undefined ? m : " ")).match(SCAN_TOKEN_RE) || [])
    .some((t) => !/^\w+=/.test(t)))

// ---- the ownership first-write gate --------------------------------------------
// Twin of js/hosts/ownership-gate.mjs's `ownershipBlock` — keep in step (same manifests, same
// managed-block strip, same section match, same reason). In an application repo (a git root
// holding a build manifest) whose root AGENTS.md has no `## Ownership` section outside the
// Geneseed block, the first write of a session is refused once, so the agent proposes the setup
// to the developer; the session and root are recorded BEFORE the refusal, so the next write
// passes. The marker is this module Set: the plugin lives as long as the OpenCode process.
const OWNERSHIP_SEEN = new Set()
const OWNERSHIP_MANIFESTS = new Set(["package.json", "pom.xml", "pyproject.toml", "go.mod", "Cargo.toml",
  "composer.json", "Gemfile"])
const isManifest = (n) => OWNERSHIP_MANIFESTS.has(n) || n.startsWith("build.gradle") || n.endsWith(".csproj")
const MANAGED_BLOCK_RE = /<!-- BEGIN GENESEED -->[\s\S]*?<!-- END GENESEED -->/g
const OWNERSHIP_SECTION_RE = /^## Ownership[ \t]*\r?$/m
const OWNERSHIP_TAIL = "Opt out per repo: `## Ownership` with `mode: off` in the root `AGENTS.md`; per " +
  "install: rebuild with `--no-ownership-gate`. Offer the full documentation " +
  "(`/document-project`) as yes / later. Stop and ask the developer now; re-issue the write only " +
  "after they answer. This gate fires once per session and repo."
const OWNERSHIP_SKIP = "skip this session; or skip in this repo until they ask — only on that third answer, " +
  "write the line `Setup: declined <YYYY-MM-DD>` (today) into `.geneseed/ownership.md` at the " +
  "MAIN worktree's root (in a linked git worktree, the main checkout's, so it outlives this " +
  "worktree), which is personal and never committed (if `.geneseed/.gitignore` is absent there, " +
  "create it first, as the ownership skill's checkpoint rules say)"
const OWNERSHIP_REASON_NONE = "Geneseed (Ownership) — this application has no `AGENTS.md` with " +
  "`## Ownership`. Before writing, propose three answers to the developer: set it up now " +
  `(ownership skill); ${OWNERSHIP_SKIP}. ${OWNERSHIP_TAIL}`
const OWNERSHIP_REASON_NO_SECTION = "Geneseed (Ownership) — this application's `AGENTS.md` has no " +
  "`## Ownership` section. Before writing, ask the developer: add the Ownership section now " +
  `(ownership skill); ${OWNERSHIP_SKIP}? ${OWNERSHIP_TAIL}`
// The developer's durable, personal decline (`DECLINED_RE` in the hook twin; geneseed-context.js
// carries it too): with no section, this line in `.geneseed/ownership.md` defers the gate.
const OWNERSHIP_DECLINED_RE = /^Setup:[ \t]*declined[ \t]+(\d{4}-\d{2}-\d{2})[ \t]*\r?$/m
// The reason to refuse this write, or null. `p` is absolute. Never throws.
function ownershipBlock(p, sessionID) {
  try {
    if (typeof sessionID !== "string" || !sessionID) return null
    const root = gitRootOf(path.dirname(p))
    if (!root || !readdirSync(root).some(isManifest)) return null
    const rel = nocase(path.relative(root, p).replace(/\\/g, "/"))
    if (rel === nocase("AGENTS.md") || rel.startsWith(nocase(".geneseed/"))) return null
    // The install's own bookkeeping (memory/, notebook/ beside plugins/, or $GENESEED_HARNESS)
    // never spends the block — the hook twin's `installRoot`.
    for (const home of [path.dirname(PLUGIN_DIR), process.env.GENESEED_HARNESS].filter(Boolean)) {
      const inside = path.relative(path.resolve(home), p)
      if (!inside.startsWith("..") && !path.isAbsolute(inside)) return null
    }
    let text = null
    try { text = readFileSync(path.join(root, "AGENTS.md"), "utf8") } catch { /* none: gate */ }
    const own = text === null ? "" : text.replace(MANAGED_BLOCK_RE, "")
    if (OWNERSHIP_SECTION_RE.test(own)) return null
    let personal = ""
    // In the MAIN worktree (the hook twin's `mainWorktreeOf(root) ?? root`): the shared `.git`'s
    // parent, else this root (a main worktree, a submodule, a bare common dir, a bad link).
    // Sync equivalent of this plugin's async `mainWorktreeOf` and js/hosts/gitref.mjs
    // `mainWorktreeOf`; the parity table in tests/plugins/ownership_guard.test.mjs pins all three.
    let home = root
    try { const c = gitCommonDirOf(root); if (path.basename(c) === ".git") home = path.dirname(c) } catch { /* this root */ }
    try { personal = readFileSync(path.join(home, ".geneseed", "ownership.md"), "utf8") } catch { /* none: gate */ }
    if (OWNERSHIP_DECLINED_RE.test(personal.replace(/^\uFEFF/, ""))) return null
    const key = `${sessionID}|${nocase(root)}`
    if (OWNERSHIP_SEEN.has(key)) return null
    OWNERSHIP_SEEN.add(key)
    return own.trim() ? OWNERSHIP_REASON_NO_SECTION : OWNERSHIP_REASON_NONE
  } catch { return null }
}

// Mutation-class tools for the wiki check — wider than WRITE_TOOLS because moving,
// renaming, or deleting a protected note is as destructive as overwriting it. Same
// substring stance: over-matching the class is harmless (see WRITE_TOOLS note).
const WIKI_MUTATE_TOOLS = [...WRITE_TOOLS, "delete", "remove", "rename", "move", "trash"]
// The rule-store walk reads EVERY tool the host's prompt does not cover, except a named read set: a
// list of writers can only ever be short of the next MCP server (`append`, `put`, `download`). Host
// tools by exact name, an MCP tool by a read verb among the words of its name, unless a writer verb
// is there too.
const HOST_READ_TOOLS = new Set(["read", "grep", "glob", "list", "webfetch", "websearch", "codesearch", "lsp", "skill",
  "todoread", "todowrite", "task", "subagent", "question", "workflow"])
const READ_WORDS = new Set(["read", "get", "list", "search", "find", "grep", "glob", "view", "query", "stat", "describe", "show", "exists"])
const readsOnly = (tool) => HOST_READ_TOOLS.has(tool)
  || (tool.split(/[^a-z0-9]+/).some((w) => READ_WORDS.has(w))
    && !hasAny(tool, [...WIKI_MUTATE_TOOLS, "copy", "append", "put", "download", "update", "set", "sync", "upload"]))
// The strings a call carries that name a path, nested ones too: an MCP writer spells its target as it
// likes. A string counts by its key, or by a separator with no whitespace, or by a `file:` URL. A title
// or a comment that happens to read MEMORY.md is text, and another scheme's URL is not a path here.
// Nesting past the bound sets `overflow`: what cannot be read is refused, not passed.
const PATH_KEY_RE = /path|file|dest|target|out|dir|ur[il]|where|src|source|^to$|^from$/i
const TEXT_KEY_RE = /^(?:title|name|content|text|body|data|description|summary|message|newString|oldString|new_string|old_string|patchText)$/i
const ARG_DEPTH = 32
function argPaths(v, key = "", out = [], depth = 0) {
  if (depth > ARG_DEPTH) { out.overflow = true; return out }
  if (typeof v === "string") {
    if (!v || v.includes("\n") || TEXT_KEY_RE.test(key)) return out
    if (/^file:/i.test(v)) { try { out.push(fileURLToPath(v)) } catch { /* no local file */ } }
    else if (!/^[a-z][a-z0-9+.-]+:\/\//i.test(v) && (PATH_KEY_RE.test(key) || (/[\\/]/.test(v) && !/\s/.test(v)))) out.push(v)
  } else if (Array.isArray(v)) v.forEach((x) => argPaths(x, key, out, depth + 1))
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) argPaths(x, k, out, depth + 1)
  return out
}

// Usage counting: the same rules as js/hosts/usage.mjs, inline because a plugin cannot import
// from the repo (V2 loads every .js in plugins/ as a plugin). One line per skill or subagent
// call, the day and the name only, under <cfg>/notebook/usage.jsonl. Silent and never throws:
// a counter must not change, slow or fail a tool call. tests/unit/usage.test.mjs holds this
// copy and the hook's to one table.
const USAGE_NAME_RE = /^[A-Za-z0-9][\w.:@/-]{0,99}$/
function usageOf(tool, args) {
  const t = String(tool || "").toLowerCase()
  const a = args || {}
  let kind = null
  let name = null
  if (!t.startsWith("mcp") && t.includes("skill")) { kind = "skill"; name = a.skill ?? a.name ?? a.skill_name }
  else if (t === "agent" || t === "task" || t === "subagent") { kind = "agent"; name = a.subagent_type ?? a.agent }
  if (!kind || typeof name !== "string") return null
  name = name.trim().replace(/^\/+/, "")
  return USAGE_NAME_RE.test(name) ? { kind, name } : null
}
async function recordUse(tool, args) {
  try {
    if (process.env.GENESEED_NO_USAGE) return
    const use = usageOf(tool, args)
    if (!use) return
    const cfg = path.dirname(PLUGIN_DIR)
    if (existsSync(path.join(cfg, ".usage-off"))) return
    if (!(await isDir(path.join(cfg, "notebook")))) return
    await fs.appendFile(path.join(cfg, "notebook", "usage.jsonl"),
      `${JSON.stringify({ ts: new Date().toISOString().slice(0, 10), ...use })}\n`)
  } catch { /* a counter never fails a tool call */ }
}

export const GeneseedGuard = async (ctx) => {
  if (ctx?.client) LOG_CLIENT = ctx.client
  // The session's working directory, the same resolution the context plugin uses.
  const root = () => ctx?.worktree || ctx?.directory || process.cwd()
  // Whether a session has a parent (a subagent's child session). V2 hands in `sessionMeta`
  // (`ctx.session.get`); V1 asks its client. Read only on the rare would-block path; a failed
  // lookup reads as a top-level session.
  const isChildSession = async (sid) => {
    try {
      const info = ctx?.sessionMeta ? await ctx.sessionMeta(sid)
        : await ctx?.client?.session?.get?.({ path: { id: sid } })
      const meta = info?.data ?? info
      return Boolean(meta?.parentID ?? meta?.parentId)
    } catch { return false }
  }
  // Whether the host itself will ask the user about this write once this hook lets it run. V2
  // hands in `hostAsks` once its `evaluate` hook is registered; V1 is read from the merged config,
  // every source included, and a failed read is no prompt. Read only on a rule-store write.
  // V1's edit tools ask with `always: ["*"]`, so one "always" approves every edit of this instance
  // and the rule above stops asking: from then on nothing here can pass to a prompt.
  // What this can see of an "always": a reply this plugin heard, in this instance, since it loaded.
  // What it cannot: the hook names no agent, so every agent's ruleset must leave the prompt in place.
  const editAsks = new Set()
  let everyEditApproved = false
  const hostPrompts = async (tool, p, cwd) => {
    if (!NATIVE_EDIT_TOOLS.has(tool)) return false
    if (ctx?.hostAsks) return true
    if (everyEditApproved) return false
    try {
      const got = await ctx?.client?.config?.get?.()
      const edit = (got?.data ?? got)?.permission?.edit
      if (edit === undefined) return false
      const rel = path.relative(root(), path.resolve(cwd, p)).replace(/\\/g, "/")
      if (!editRuleAsks(edit, rel)) return false
      if (typeof ctx?.client?.app?.agents !== "function") return false
      const agents = await ctx.client.app.agents()
      return (agents?.data ?? agents ?? []).every((a) => agentMayAsk(a?.permission, rel))
    } catch { return false }
  }
  // The change report. One baseline per root session, in memory. V2 feeds this hook from its own
  // events (`setupV2`). `say` reaches the USER: a V1 toast, a V2 synthetic message.
  const watched = new Map()
  const say = ctx?.say ?? (async (_sid, line) => {
    await ctx?.client?.tui?.showToast?.({ body: { title: "Geneseed", message: line, variant: "warning" } })
  })
  const unwatched = new Set()
  const watch = async (sid) => {
    if (OFF || !sid || watched.has(sid) || unwatched.has(sid)) return
    if (await sovereignBypass(root()) || await isChildSession(sid)) { unwatched.add(sid); return }
    watched.set(sid, scanAllStores())
  }
  const compare = async (sid) => {
    const before = watched.get(sid)
    if (!before) return
    const now = scanAllStores()
    watched.set(sid, now)
    const changed = [...new Set([...Object.keys(before), ...Object.keys(now)])].filter((f) => before[f] !== now[f]).sort()
    if (!changed.length) return
    const own = ownWrites()
    const files = changed.filter((f) => own[f] !== (now[f] ?? "gone"))
    if (!files.length) return
    const line = storeLine(files)
    log(line)
    noteForStatus(files)
    await say(sid, line)
  }
  return {
    // V1's `permission.asked` / `permission.replied` (1.19.5), and the older `permission.updated`
    // with `permissionID` and `response`. Never throws: an event has no one to catch it.
    event: async ({ event }) => {
      try {
        const e = event?.properties ?? {}
        if (event?.type === "permission.asked" || event?.type === "permission.updated") {
          if ((e.permission ?? e.type) === "edit") editAsks.add(e.id)
        } else if (event?.type === "permission.replied" && (e.reply ?? e.response) === "always"
          && editAsks.has(e.requestID ?? e.permissionID)) everyEditApproved = true
        else if (event?.type === "session.created") await watch(e.info?.id)
        else if (event?.type === "session.idle") await compare(e.sessionID)
      } catch (err) { log(`change report error (ignored): ${err?.message ?? err}`) }
    },
    // A native edit that ran went past the host's prompt: approved, so its new stamp joins every
    // baseline here. Only those tools, and only with a session watched.
    "tool.execute.after": async (input) => {
      try {
        const tool = String(input?.tool ?? "").toLowerCase()
        if (!watched.size || !NATIVE_EDIT_TOOLS.has(tool)) return
        const cwd = ctx?.directory || process.cwd()
        for (const raw of pickPath(input?.args ?? {}, cwd)) {
          if (!ruleStoreTarget(raw, cwd)) continue
          // Only keys the scan itself names: a link's other spellings would read as files gone.
          const now = scanAllStores()
          for (const f of landsOn(raw, cwd)) {
            for (const base of watched.values()) { if (f in now) base[f] = now[f]; else delete base[f] }
          }
        }
      } catch (err) { log(`change report error (ignored): ${err?.message ?? err}`) }
    },
    "tool.execute.before": async (input, output) => {
      // Bypass before counting, the order Claude's toolGate keeps: an excluded repo is
      // dormant, so nothing is written there. GENESEED_GUARD=off still counts — Claude's
      // hook has no such switch; GENESEED_NO_USAGE / .usage-off stop the counter.
      if (await sovereignBypass(root())) return
      await recordUse(input?.tool || input?.name, output?.args || input?.args)
      if (OFF) return
      // A session that predates this plugin never sent `session.created`. Once per session.
      try { await watch(input?.sessionID) } catch { /* the report never decides a tool call */ }
      const tool = (input?.tool || input?.name || "").toLowerCase()
      const args = output?.args || input?.args || {}
      // `rule` is the ledger key, spelled as js/hosts/hooks.mjs spells it (`law-1`,
      // `law-4`, `process-1`) plus `wiki`, so status counts one vocabulary across hosts.
      // The model reads this text. It never names the GENESEED_GUARD switch: a weak model read
      // "set GENESEED_GUARD=off to allow" as leave to route the write through a shell (4.27.1).
      // A refusal's words, through `gateSafe` (the ownership reason is the agent's, so it keeps its own): the catch below lets a call through on any error
      // but a deny. No count: no `editPairs` here, and the line reads whole without one.
      const refused = (id, facts) => gateSafe(id, "refused", facts)
      // V1's explanations, held to the end of this hook: a later gate may still refuse the call, and a
      // note about a dialog that never comes is a false one. V2 posts from `evaluate` instead.
      const notes = []
      const deny = async (why, rule) => {
        if (WARN_ONLY) { log(`WARN (would block): ${why}`); return false }
        log(`BLOCKED: ${why}`)
        await ledger(rule)
        throw new Error(`[geneseed-guard] blocked: ${why}`)
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
          for (const raw of paths) {
            if (namesStream(raw)) { await deny(refused("stream", { name: repoRel(path.resolve(cwd, raw)) }), "rigor-5"); return }
            // Once, here: under `opencode serve` this process's cwd is not the session's directory, and
            // every gate below resolves a relative path against it.
            const p = landsOn(raw, cwd)[0].replace(/\\/g, "/")
            if (!SECRETS_GATE_OFF && SECRET_RE.some((re) => re.test(p))) { await deny(refused("secret-file", { name: repoRel(p) }), "law-1"); return }
            if (SECRET_WARN_RE.some((re) => re.test(p))) log(`WARN: writing ${p} — keep secrets out of tracked files (Sealed Secrets)`)
            const sensor = protectedCheck(p)
            if (sensor) { await deny(refused("check", { name: sensor }), "rigor-5"); return }
            if (gateConfig(p)) { await deny(refused("config", { name: repoRel(p) }), "rigor-5"); return }
            // V1 after an "always": the `permission.edit` ask on these files is gone too.
            if (everyEditApproved && !ctx?.hostAsks && nativeAskFile(p)) { await deny(refused("config", { name: repoRel(p) }), "rigor-5"); return }
            const store = ruleStoreTarget(raw, cwd)
            const prompted = (store || nativeAskFile(p)) && await hostPrompts(tool, raw, cwd)
            if (prompted && !ctx?.hostAsks) notes.push(gateSafe(store ? "store" : "config", "ask", { name: store || repoRel(p) }))
            if (store && !prompted) {
              await deny(`${refused("store", { name: store })}\n${NATIVE_EDIT_TOOLS.has(tool) ? PERSIST_NO_PROMPT : PERSIST_EDIT_TOOL}`, "process-1")
              return
            }
          }
          // Content scan (Sealed Secrets, the twin of js/hosts/hooks.mjs's ruleDecide): per
          // FILE, not pooled — a patch touching `.env` AND an ordinary file must still catch a
          // secret in the ordinary file; only the hunk whose OWN path is `.env`-shaped is
          // exempt, same as the path WARN tier above.
          for (const { path: cp, content } of SECRETS_GATE_OFF ? [] : pickAddedContentByPath(args, cwd)) {
            if (SECRET_WARN_RE.some((re) => re.test(cp))) continue
            if (SECRET_CONTENT_RE.test(content)) {
              await deny(refused("secret", { name: repoRel(path.resolve(cwd, cp)) }), "law-1")
              return
            }
          }
          // The ownership first-write gate, last, as in js/hosts/hooks.mjs's ruleDecide. A child
          // session is a subagent (ruling D29): it cannot ask the user, so it never spends a block.
          if (!OWNERSHIP_GATE_OFF) {
            for (const p of paths) {
              const why = ownershipBlock(path.resolve(cwd, p), input?.sessionID)
              if (why && !(await isChildSession(input.sessionID))) { await deny(why, "ownership"); return }
            }
          }
        }
        // Any tool the host's prompt does not cover, whatever it calls its arguments. `pickCommand`,
        // because SHELL_TOOLS is a substring class: `mcp_prune_write` holds "run".
        if (!NATIVE_EDIT_TOOLS.has(tool) && !readsOnly(tool) && !(hasAny(tool, SHELL_TOOLS) && pickCommand(args))) {
          const named = argPaths(args)
          if (named.overflow) { await deny(refused("deep-args", { name: tool }), "process-1"); return }
          for (const v of named) {
            const store = ruleStoreTarget(v, cwd)
            if (store) {
              await deny(`${refused("store", { name: store })}\n${PERSIST_EDIT_TOOL}`, "process-1")
              return
            }
          }
        }
        if (hasAny(tool, WIKI_MUTATE_TOOLS)) {
          for (const p of pickPath(args, cwd)) {
            const abs = landsOn(p, cwd)[0].replace(/\\/g, "/").toLowerCase()
            const hit = (await protectedPrefixes()).find(
              (x) => abs.startsWith(x.prefix) || abs === x.prefix.slice(0, -1))
            if (hit) { await deny(refused("wiki", { name: hit.label }), "wiki"); return }
          }
        }
        // NOT else-if: a compound tool name (e.g. exec_and_save) can match both
        // classes, and the shell check must still run after the write check.
        if (hasAny(tool, SHELL_TOOLS)) {
          // OpenCode's bash tool may run in `workdir`, resolved against the session directory.
          const wd = typeof args.workdir === "string" && args.workdir ? path.resolve(cwd, args.workdir) : cwd
          const c = pickCommand(args)
          const cut = (t) => scanSegments(t).map((seg) => seg.match(SCAN_TOKEN_RE) || [])
          if (c && (SHELL_BLOCK_RE.some((re) => re.test(c)) || catastrophic(c, cut))) { await deny(refused("catastrophic", { name: c }), "law-4"); return }
          const scan = c && rootScan(c)
          if (scan) {
            await deny(refused("root-scan", { name: scan }), "ops-2")
            return
          }
          if (c && !DELETION_GATE_OFF && LOSS_CANDIDATE_RE.test(c)) {
            const loss = lossReason(cut(c), wd, { always: false, split: cut })
            if (loss) { const facts = gateLoss(loss); await deny(refused(facts.id, facts), "law-4"); return }
          }
          // External Gate over a shell write: the same paths as a write tool, no content scan. A
          // throw fails open through the catch below, as the twin's `shellWriteReason` does.
          for (const p of c ? shellWriteTargets(c, wd, /powershell|pwsh/i.test(tool)) : []) {
            const sensor = protectedCheck(p)
            if (sensor) { await deny(refused("check", { name: sensor, shell: true }), "rigor-5"); return }
            if (gateConfig(p) || nativeAskFile(p)) { await deny(refused("config", { name: repoRel(p), shell: true }), "rigor-5"); return }
            // A parsed form that lands in a store. V2 can ask: `evaluate` runs for the shell tool's own
            // `permission.assert`, so the call is marked by its id and the host prompts. V1 cannot.
            const store = ruleStoreTarget(p, wd)
            if (store && ctx?.shellAsks && input?.callID && !noProgramWord(c)) { ctx.shellAsks.set(input.callID, store); continue }
            if (store) {
              await deny(`${refused("store", { name: store, shell: true })}\n${PERSIST_EDIT_TOOL}`, "process-1")
              return
            }
          }
        }
        for (const note of notes) {
          // No count here, as in a refusal. 120 s, because the dialog stays until it is answered.
          try {
            await ctx?.client?.tui?.showToast?.({ body: { title: "Geneseed", message: gateNote(note), variant: "warning", duration: 120000 }, query: { directory: cwd } })
          } catch (err) { log(`note not shown: ${err?.message ?? err}`) }
        }
      } catch (err) {
        // Our own deny must propagate; any inspection error must never break a tool call.
        if (err && String(err.message || "").startsWith("[geneseed-guard]")) throw err
        log(`inspect error (ignored): ${err?.message ?? err}`)
      }
    },
  }
}

// ---- OpenCode 2 ----------------------------------------------------------------
// `export default { id, server, setup }` serves V1 (>= 1.3.4) and V2 from one file — why, and
// each V1 hook's V2 counterpart: adapters/opencode/HOW-OPENCODE-LOADS.md.
//
// V2 runs the same gates through `tool.hook("execute.before")`, but cannot block the
// V1 way: a V2 hook that throws is a defect, which fails the whole agent step instead
// of the one call (only a `Tool.Error` settles a call cleanly, and a hook cannot raise
// one). So a deny RENAMES the call: core then finds no tool by that name and settles it
// with a `Tool.Error` whose text carries the reason — the call never runs, the model sees
// why, the session continues. The input is emptied as well, for code mode, which runs the
// original tool whatever the event's name says; every tool this guard gates requires
// arguments, so `{}` fails validation there before anything executes.
//
// A deny stays here, not in `permission.hook("evaluate")`: that hook sees only the action and a
// resource list (the shell tool's is per sub-command), not the full input the content scan and
// the patch-path gates need. Its use is the ask this hook has no tier for. It runs after the
// configured and saved rules, and for `edit` and `patch` a resource is relative to
// `location.directory` or absolute, so a rule-store write becomes a real prompt whatever the config
// and any saved "always" say (core/src/permission.ts, 2.2.5). A configured deny never reaches it,
// and an unattended session turns the ask into a deny. A V2 without the domain has no `hostAsks`,
// so the guard refuses those writes.
//
// The dialog shows no plugin text, so each ask posts a note first. The TUI renders a synthetic item's
// `description` and the model gets its `text`, so the block goes in the first and the second must read
// true whether the user allows or denies (spec 2026-11-07-gate-prompts-5.0.3, S0 result).
async function askOnRuleStore(ctx, shellAsks) {
  const dir = ctx?.location?.directory || process.cwd()
  const note = async (event) => {
    try {
      await ctx.session.synthetic({ sessionID: event.sessionID, text: "Geneseed showed the user why the next permission request asks.",
        description: gateNote(event.message), resume: false })
    } catch (err) { log(`note not posted: ${err?.message ?? err}`) }
  }
  try {
    await ctx.permission.hook("evaluate", async (event) => {
      try {
        if (OFF || event.effect === "deny") return
        if (event.action === "shell") {
          // The shell tool's assert: action `shell`, one resource per parsed command, `source.id` the
          // call the tool hook marked. A command the host's parser finds no command in asserts nothing.
          const shellStore = shellAsks.get(event.source?.id)
          if (!shellAsks.delete(event.source?.id)) return
          if (WARN_ONLY) { log("WARN (would ask): a shell write to a rule or memory file (Persist Insight)"); return }
          event.effect = "ask"
          event.message = gateSafe("store", "ask", { name: shellStore, shell: true })
          await note(event)
          return
        }
        if (event.action !== "edit") return
        const store = event.resources.map((r) => ruleStoreTarget(r, dir)).find(Boolean)
        // The gate's own files have a static ask a saved "always" can outvote, so they are raised too.
        const gate = !store && event.resources.find((r) => nativeAskFile(path.resolve(dir, r)))
        if ((!store && !gate) || await sovereignBypass(ctx?.location?.project?.directory || dir)) return
        if (WARN_ONLY) { log(`WARN (would ask): writing to ${store || "a gate's configuration"} (Persist Insight)`); return }
        event.effect = "ask"
        event.message = store ? gateSafe("store", "ask", { name: store })
          : gateSafe("config", "ask", { name: repoRel(path.resolve(dir, gate)) })
        await note(event)
      } catch {
        // An event this hook cannot read is asked about. A V2 callback never throws.
        try { if (event?.action === "edit") event.effect = "ask" } catch { /* a frozen event: the static key still asks */ }
      }
    })
    return true
  } catch { return false }
}

async function setupV2(ctx) {
  // Call id to the store it writes, for the prompt's text.
  const shellAsks = new Map()
  const hostAsks = await askOnRuleStore(ctx, shellAsks)
  const hooks = await GeneseedGuard({
    worktree: ctx?.location?.project?.directory, directory: ctx?.location?.directory,
    sessionMeta: (sessionID) => ctx.session.get({ sessionID }),
    hostAsks, shellAsks: hostAsks ? shellAsks : null,
    say: (sessionID, text) => ctx.session.synthetic({ sessionID, text, description: "Geneseed change report", resume: false }),
  })
  const report = (type, properties) => hooks.event({ event: { type, properties } })
  // V2's turn edges, as geneseed-notify reads them. `say` above is the only way out to the user.
  const controller = new AbortController()
  try {
    await ctx.tool.hook("execute.after", async (event) => {
      if (event?.status === "completed") await hooks["tool.execute.after"]({ tool: event.tool, args: event.input })
    })
    if (ctx?.event?.subscribe) {
      void (async () => {
        for await (const ev of ctx.event.subscribe({ signal: controller.signal })) {
          const sessionID = ev?.data?.sessionID
          if (ev?.type === "session.execution.started") await report("session.created", { info: { id: sessionID } })
          else if (/^session\.execution\.(?:succeeded|failed|interrupted)$/.test(ev?.type ?? "")) await report("session.idle", { sessionID })
        }
      })().catch((err) => log(`change report stream ended: ${err?.message ?? err}`))
    }
  } catch (err) { log(`change report not wired: ${err?.message ?? err}`) }
  await ctx.tool.hook("execute.before", async (event) => {
    try {
      // `sessionID` rides on every V2 execute.before event (@opencode/plugin 2.1.4 `ToolHooks`).
      await hooks["tool.execute.before"]({ tool: event.tool, sessionID: event.sessionID, callID: event.id }, { args: event.input })
    } catch (err) {
      const why = String(err?.message || "")
      if (!why.startsWith("[geneseed-guard]")) return
      // Core prints `No tool named "<this>"`, so the name must say first that nothing is missing.
      event.tool = `BLOCKED, not a missing tool: ${why}`
      event.input = {}
    }
  })
  return () => controller.abort()
}

export default { id: "geneseed-guard", server: GeneseedGuard, setup: setupV2 }
