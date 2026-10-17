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
//   - Persist Insight (rule vs memory):  speed-bump the first write to user-rules.md
//     memory file — that choice belongs to the user, via the rule skill.
//   - Wiki (AGENT.md §8):  block mutations under a declared wiki's `protected`
//     folders — the user's knowledge base sets its own no-go zones in geneseed-wiki.jsonc.
// High-confidence patterns only, so legitimate work is never caught. Borderline cases
// (.env edits) are WARNED, not blocked. Every block is recorded in the gate
// ledger (`<cfg>/notebook/gates.jsonl`) under the hook's rule key (`law-1`, `rigor-5`,
// `law-4`, `ops-2`, `process-1`, `wiki`); every skill or subagent call, blocked or not, is
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

import { promises as fs, realpathSync, existsSync, readFileSync, readdirSync, statSync, lstatSync } from "node:fs"
import { spawnSync } from "node:child_process"
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

// Twin of js/hosts/hooks.mjs's SECRET_RE (Law I's boundary half) — scans WRITE CONTENT for a
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
// gitCommonDirOf, currentBranch, protectedBranches, stashExists); the block between the twin
// markers is js/hosts/loss.mjs verbatim, and tests/plugins/guard.test.mjs diffs it.
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
  /\bgit\b[^\n]*\b(?:reset|clean|branch|checkout|switch|restore|stash|reflog|gc|push)\b|(?:^|[\s;&|("'])(?:rm|rmdir|del|erase|remove-item|ri|rd)(?:\.exe)?(?=[\s;&|)"']|$)/im;

class Unverified extends Error {}
const unverified = (why) => { throw new Unverified(why); };

const RM_PROGS = new Set(['rm', 'rmdir', 'del', 'erase', 'remove-item', 'ri', 'rd']);
// cmd.exe's own removal verbs take `/s` `/q` switches, which are not paths.
const CMD_SWITCH_PROGS = new Set(['rmdir', 'del', 'erase', 'rd']);
const CD_PROGS = new Set(['cd', 'pushd', 'chdir', 'set-location', 'sl']);
const WRAPPERS = new Set(['sudo', 'doas', 'command', 'builtin', '\\builtin', 'time', 'nice', 'nohup', 'exec', 'env']);
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

/** `git branch` — a forced delete asks for a protected branch or one whose commits live nowhere else. */
function branchAct(rest, dir) {
  const opts = rest.filter((a) => a.startsWith('-'));
  const del = opts.some((a) => a === '--delete' || a === '-D' || hasShort(a, 'd') || hasShort(a, 'D'));
  const force = opts.some((a) => a === '--force' || a === '-D' || hasShort(a, 'f') || hasShort(a, 'D'));
  if (!del || !force) return null;   // an un-forced delete refuses an unmerged branch on its own
  if (opts.some((a) => a === '-r' || a === '--remotes')) return null;   // a remote-tracking ref; `fetch` restores it
  const names = rest.filter((a) => !a.startsWith('-'));
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
        return rest.includes('--hard') ? dirty(d, [], '`git reset --hard`') : null;
      case 'checkout': {
        if (rest.some((a) => a === '--force' || hasShort(a, 'f'))) return dirty(d, [], '`git checkout --force`');
        const dd = rest.indexOf('--');
        if (dd < 0) return null;
        const paths = rest.slice(dd + 1);
        return paths.length ? dirty(d, paths, '`git checkout --`') : null;
      }
      case 'switch':
        return rest.some((a) => a === '--force' || a === '--discard-changes' || hasShort(a, 'f'))
          ? dirty(d, [], '`git switch --discard-changes`') : null;
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
 * The verdict for a whole command, given its segments as RAW token arrays (quotes still on —
 * `js/hosts/hooks.mjs` cuts and tokenises with the same lexer `rootScan` uses, so a quoted
 * `;` or a heredoc body is never a segment). Returns the reason it would lose data, or null
 * when it provably would not. What it cannot settle — a glob, a git that fails — is a "could not
 * verify" reason, never a throw. A BUG still throws, on purpose: `guardGate` turns it into a
 * `gate-error` (an ask on Claude, a warning on Bob) and the OpenCode guard logs and allows it —
 * each host's ceiling for a crashed gate (docs/adr/0007-gates-fail-closed-per-host-ceiling.md).
 * `always: false` skips the two acts that lose data in every state (`reflog expire`, `gc --prune`)
 * — the OpenCode guard passes it, because a static `permission.bash` glob already asks for those.
 */
function lossReason(segments, cwd, { always = true } = {}) {
  let dir = cwd;
  try {
    for (const raw of segments) {
      let w = words(raw);
      while (w.length && (/^\w+=/.test(w[0]) || WRAPPERS.has(progOf(w[0])))) {
        const wrapper = progOf(w[0]);
        w = w.slice(1);
        // A wrapper's own flags (`sudo -u x`, `env -i`) are not the program.
        if (wrapper !== 'command' && wrapper !== 'exec') while (w.length && w[0].startsWith('-')) w = w.slice(1);
      }
      if (!w.length) continue;
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
      }
      if (verdict) return verdict;
    }
    return null;
  } catch (e) {
    if (!(e instanceof Unverified)) throw e;
    return `the gate could not verify what this command would lose (${e.message})`;
  }
}
// ---- loss twin: END

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
// A comment (`#` starting a word), a quoted run (its `;`/`|` is data), a separator, or a heredoc
// opener (never the `<<<` here-string).
const SCAN_SPLIT_RE = /(?<![^\s;|&(])#[^\n]*|"[^"]*"?|'[^']*'?|\|\||&&|[|;\n]|(?<!<)<<(?!<)(-?)[ \t]*(["']?)([A-Za-z_]\w*)\2/g
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
    let toks = (seg.match(SCAN_TOKEN_RE) || []).filter((t) => !/^\w+=/.test(t))
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
  if (args && typeof args.patchText === "string") {
    return parsePatchSections(args.patchText)
      .filter((s) => s.added.length)
      .map((s) => ({
        path: path.resolve(cwd || process.cwd(), s.path).replace(/\\/g, "/"),
        content: s.added.join("\n"),
      }))
  }
  const [p] = pickPath(args, cwd)
  if (!p) return []
  if (typeof args.content === "string") return [{ path: p, content: args.content }]
  if (typeof args.newString === "string") return [{ path: p, content: args.newString }]
  return []
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
// The done gate's list (#289, js/hosts/hooks-done.mjs) protects itself the same way, with or
// without a protected-checks list: emptying it would disarm the gate. Twin of js/hosts/hooks.mjs.
const DONE_LIST = ".geneseed/done-checks.txt"
function protectedCheck(p) {
  try {
    const target = path.resolve(p)
    let root = path.dirname(target)
    while (!existsSync(path.join(root, ".git"))) {
      const up = path.dirname(root)
      if (up === root) return null
      root = up
    }
    const fold = (s) => nocase(s.replace(/\\/g, "/"))
    const rel = fold(path.relative(root, target))
    if (rel === fold(DONE_LIST)) return DONE_LIST
    const text = readFileSync(path.join(root, SENSOR_LIST), "utf8")
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
  // The session's working directory, the same resolution the context plugin uses.
  const root = () => ctx?.worktree || ctx?.directory || process.cwd()
  return {
    "tool.execute.before": async (input, output) => {
      // Bypass before counting, the order Claude's toolGate keeps: an excluded repo is
      // dormant, so nothing is written there. GENESEED_GUARD=off still counts — Claude's
      // hook has no such switch; GENESEED_NO_USAGE / .usage-off stop the counter.
      if (await sovereignBypass(root())) return
      await recordUse(input?.tool || input?.name, output?.args || input?.args)
      if (OFF) return
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
            if (sensor) { await deny(`${p} is a protected check (${sensor === DONE_LIST ? "the done gate list itself" : `${sensor}, listed in ${SENSOR_LIST}`}) — a check the agent can edit is not a check (External Gate)`, "rigor-5"); return }
            const store = ruleStoreTarget(p)
            if (store && !RULE_STORE_BUMPED.has(p)) {
              RULE_STORE_BUMPED.add(p)
              await deny(`writing to ${store} — a standing rule, or a fact to remember? That ` +
                   `choice is the user's (Persist Insight). Settle it through the rule skill, ` +
                   `then re-issue this write`, "process-1")
              return
            }
          }
          // Content scan (Sealed Secrets, the twin of js/hosts/hooks.mjs's ruleDecide): per
          // FILE, not pooled — a patch touching `.env` AND an ordinary file must still catch a
          // secret in the ordinary file; only the hunk whose OWN path is `.env`-shaped is
          // exempt, same as the path WARN tier above.
          for (const { path: cp, content } of pickAddedContentByPath(args, cwd)) {
            if (SECRET_WARN_RE.some((re) => re.test(cp))) continue
            if (SECRET_CONTENT_RE.test(content)) {
              await deny(`${cp} would carry a credential-shaped string (Sealed Secrets) — secrets `
                + "live in .env or a secret manager, never in a tracked file", "law-1")
              return
            }
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
          const scan = c && rootScan(c)
          if (scan) {
            await deny(`\`${scan.slice(0, 80)}\` recursively scans a whole filesystem root (Commands Must Return) — ` +
              "search a specific directory instead: the project, node_modules, ~/.npm, %APPDATA%", "ops-2")
            return
          }
          if (c && LOSS_CANDIDATE_RE.test(c)) {
            // OpenCode's bash tool may run in `workdir`, resolved against the session directory.
            const wd = typeof args.workdir === "string" && args.workdir ? path.resolve(cwd, args.workdir) : cwd
            const loss = lossReason(scanSegments(c).map((seg) => seg.match(SCAN_TOKEN_RE) || []), wd, { always: false })
            if (loss) { await deny(`${loss} (Deletion Is Deliberate) — confirm with the user first`, "law-4"); return }
          }
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
// `permission.evaluate` (V2's deny hook) was not used: it sees only the action and a
// resource list (the shell tool's is per sub-command), not the full input the content
// scan and the patch-path gates need.
async function setupV2(ctx) {
  const hooks = await GeneseedGuard({
    worktree: ctx?.location?.project?.directory, directory: ctx?.location?.directory,
  })
  await ctx.tool.hook("execute.before", async (event) => {
    try {
      await hooks["tool.execute.before"]({ tool: event.tool }, { args: event.input })
    } catch (err) {
      const why = String(err?.message || "")
      if (!why.startsWith("[geneseed-guard]")) return
      event.tool = why
      event.input = {}
    }
  })
}

export default { id: "geneseed-guard", server: GeneseedGuard, setup: setupV2 }
