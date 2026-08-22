/**
 * `rituals/_update.py` — self-update: `git pull` the install's own origin, validate, rebuild.
 *
 * The verb this whole port exists for. Every other subcommand can be Python for one more
 * release; `upgrade` is the one operation a "no Python needed" install cannot delegate,
 * because a Node install that shelled out to the Python harness to update itself
 * would have Python as a hard dependency of the only command a user MUST be able to run.
 *
 * WHY THIS MODULE SPAWNS, AND WHY THE ARGUMENT IS NOT THE JOB RUNNER'S. `js/web/jobs.mjs`
 * re-executes this program for ISOLATION — a synchronous verb in the daemon's event loop
 * would freeze the poll that watches it. Here the reason is different and, for once,
 * unarguable: **the code on disk changes halfway through.** `_pull_and_validate`
 * fast-forwards the working tree and then has to ask the PULLED source whether it is sound;
 * `_rebuild_bundle` has to render with the PULLED generator. An in-process call answers with
 * the modules this process loaded before the merge — it would validate the old source, pass,
 * and then render the old source into the bundle, reporting success. That is not a slower
 * version of the right answer, it is the wrong one. So `runDoctor`, `rebuildBundle` and
 * `rebuildInstalls` each start a fresh interpreter over the tree as it now is, exactly as the
 * reference does, and `_ALLOWED_SPAWNS` in `tests/test_hook_cli_parity.py` carries the argv.
 *
 * `git` is the fourth spawn and the plainest: there is no git library in the Node stdlib,
 * and the port will not vendor one. Every git call goes through the `gitRun` seam —
 * which-guarded, credential-redacted, and it never throws.
 *
 * WHAT THE GATE CANNOT SEE, stated rather than implied. `upgrade/*` in
 * `tests/harness_golden.py` runs each arm against a private clone of a bare origin the
 * fixture builds, so no cell can reach a network — which is a safety property and a blind
 * spot at once: `git fetch --progress` over a local path prints NOTHING, so
 * `fetchStreaming`'s reader, its phase filter and its 15s heartbeat are reachable in every
 * cell and varied in none. The phase filter is gated as a corpus in
 * `tests/test_pure_function_parity.py`; the heartbeat and the hard deadline are gated by
 * neither and are declared in the P8a handoff.
 *
 * NOT HERE, DELIBERATELY: `sync_self`, `main` (the launchers' self-heal entry) and
 * `cmd_bootstrap` are P8b's, and `update`'s row in `js/web/jobs.mjs`' `NOT_PORTED_ACTIONS`
 * is P8c's one-line payment. `parseOrigin` is ported in full here even though only `upgrade`
 * needs its fallback, because P8c's docs `about` kind needs the slug half and splitting one
 * pure function across two phases is how a second classifier gets written.
 */
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT } from '../build/source.mjs';
import { exportImprovements, flushExportNotes } from '../inspect/diff.mjs';
import { opencodeConfigDir } from '../hosts/hosts.mjs';
import { appendText, copyFile, printOut, printErr, readText, writeText } from '../lib/fs.mjs';
import { toPlatformPath, which } from '../lib/paths.mjs';
import { WHITESPACE, parseIntStrict, stripWhitespace } from '../lib/text.mjs';
import { NO_WINDOW } from '../lib/proc.mjs';
import { restartDaemon } from '../web/server.mjs';

/**
 * `_CREDS_RE` / `_redact_url_creds` — strip a `user[:token]@` userinfo out of any URL in
 * `text` so a tokened remote never reaches a log line or an HTTP response.
 *
 * `WHITESPACE` rather than `\s`: the class is NEGATED, so the two definitions disagree about
 * whether a `\uFEFF` or a `\u001c` ends the userinfo. Unreachable through a git remote and
 * spelled correctly anyway, for the reason `js/lib/fs.mjs` gives — an approximated
 * primitive is the one that is wrong the day something reaches it.
 */
const CREDS_RE = new RegExp(`(://)[^/@${WHITESPACE}]+@`, 'g');

export function redactUrlCreds(text) {
  return (text || '').replace(CREDS_RE, '$1');
}

// `_NO_WINDOW` was defined here and PRIVATE to this module, which is how `js/doctor.mjs`
// and `js/hooks.mjs` came to spawn without it — see `js/lib/proc.mjs` for the flag, the
// capturing-only rule behind it, and why a miss here is invisible to every byte gate.

/** `subprocess.run(..., capture_output=True, encoding="utf-8")` reads in UNIVERSAL NEWLINES. */
function universal(s) {
  return (s || '').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

export const DEFAULT_ORIGIN = { url: 'https://github.com/Arylmera/Geneseed',
  githubSlug: 'Arylmera/Geneseed' };

/**
 * `_git(*args, timeout=10, network=False)` — `git -C ROOT <args>` per the shared contract:
 * which-guarded, no-window, stripped + credential-redacted, NEVER raises. Returns
 * `[rc, out, err]`; `rc` is null when git is absent or the spawn failed.
 *
 * `which` and not a bare `'git'`: the reference answers `(None, "", "")` — which
 * `preflight` reports as "git is not installed or not on PATH" — when the lookup misses,
 * and a port that let the OS resolve the name would get an ENOENT instead and have to guess
 * which of the two it was.
 *
 * `maxBuffer` is raised because Python has no such limit; the default 1 MB is reachable by
 * `git status --porcelain` in a large dirty tree and a truncated read there is silently
 * "clean enough".
 */
export function gitRun(args, { timeout = 10, network = false } = {}) {
  const exe = which('git');
  if (!exe) return [null, '', ''];
  const cmd = ['-C', String(ROOT)];
  let env;
  if (network) {
    env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
    cmd.push('-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=15');
  }
  cmd.push(...args.map(String));
  const r = spawnSync(exe, cmd, {
    encoding: 'utf8', timeout: timeout * 1000, env, maxBuffer: 64 * 1024 * 1024, ...NO_WINDOW,
  });
  // `except Exception` — a spawn error, an OS error, or the timeout Python raises on. A
  // signal-killed git has `status === null` too and Python would report a negative code for
  // it; no call site here distinguishes the two, and treating it as "git did not answer" is
  // the arm the reference reaches for every other failure.
  if (r.error || r.status === null) return [null, '', ''];
  return [r.status,
    redactUrlCreds(stripWhitespace(universal(r.stdout))),
    redactUrlCreds(stripWhitespace(universal(r.stderr)))];
}

/**
 * `urlsplit(o)`, reduced to the two fields `parseOrigin` reads.
 *
 * `new URL()` is NOT this: it throws on `C:\Users\me\origin.git` (a fixture's remote, and a
 * plain relative remote on any machine) where `urlsplit` answers with a scheme of `c` and no
 * host at all, which is what sends `parseOrigin` to its DEFAULT_ORIGIN fallback. Reproduced
 * rather than approximated because the fallback is the arm every local checkout takes.
 */
function urlsplitHostPath(o) {
  let rest = o.split('#', 1)[0];
  rest = rest.split('?', 1)[0];
  // A scheme is `[A-Za-z][A-Za-z0-9+.-]*` before the first `:` — and only then. `urlsplit`
  // leaves `foo:bar` alone when `foo` is not a legal scheme, which is what keeps an scp-form
  // remote out of this branch (the caller checks for that shape first anyway).
  const m = /^([A-Za-z][A-Za-z0-9+.\-]*):(.*)$/s.exec(rest);
  if (m) rest = m[2];
  let netloc = '';
  if (rest.startsWith('//')) {
    const after = rest.slice(2);
    const cut = after.search(/[/?#]/);
    netloc = cut === -1 ? after : after.slice(0, cut);
    rest = cut === -1 ? '' : after.slice(cut);
  }
  // `.hostname`: userinfo dropped at the LAST `@`, port dropped at the last `:` outside
  // brackets, IPv6 brackets stripped, lowercased.
  let host = netloc.includes('@') ? netloc.slice(netloc.lastIndexOf('@') + 1) : netloc;
  if (host.startsWith('[')) host = host.slice(1, host.indexOf(']') === -1 ? undefined
    : host.indexOf(']'));
  else if (host.includes(':')) host = host.slice(0, host.indexOf(':'));
  return { host: host.toLowerCase(), path: rest };
}

/**
 * `_parse_origin(origin)` — `(browser url, github_slug)` from a git remote URL of any scheme.
 * Userinfo and port dropped from the url; slug set only for a two-segment github.com path.
 */
export function parseOrigin(origin) {
  const o = stripWhitespace(origin || '');
  let host = '';
  let p = '';
  if (!o.includes('://') && o.includes('@') && o.split('@').slice(1).join('@').includes(':')) {
    // scp-form `git@host:owner/repo`. `split("@", 1)[1]` keeps everything after the FIRST
    // `@`, and `split(":", 1)` everything after the first colon.
    const afterAt = o.slice(o.indexOf('@') + 1);
    host = afterAt.slice(0, afterAt.indexOf(':'));
    p = afterAt.slice(afterAt.indexOf(':') + 1);
  } else {
    const u = urlsplitHostPath(o);
    host = u.host;
    p = u.path;
  }
  host = host.toLowerCase();
  p = p.replace(/^\/+/, '').replace(/\/+$/, '');
  if (p.toLowerCase().endsWith('.git')) p = p.slice(0, -4);
  if (!(host && p)) return DEFAULT_ORIGIN;
  const url = `https://${host}/${p}`;
  let slug = null;
  if (host === 'github.com') {
    const segs = p.split('/').filter(Boolean);
    if (segs.length === 2) slug = segs.join('/');
  }
  return { url, githubSlug: slug };
}

/** `_origin_display()` — the install's origin as a display record, or DEFAULT_ORIGIN. */
export function originDisplay() {
  const [rc, out] = gitRun(['remote', 'get-url', 'origin']);
  if (rc !== 0 || !out) return DEFAULT_ORIGIN;
  return parseOrigin(out);
}

const PRE_MSG = {
  no_git_exe: ['info', 'git is not installed or not on PATH — install git to enable updates.'],
  // Names BOTH routes rather than detecting which one this is. Since the npm package, the
  // commonest way to reach this arm is an `npm i -g geneseed` install, for which "re-clone
  // it with git" was exactly the wrong instruction.
  not_git: ['info', "This Geneseed install isn't a git checkout — update it with `npm install -g geneseed@latest`, or re-clone it with git."],
  detached: ['info', 'HEAD is detached (a tag/commit is checked out). Run `git checkout <branch>` to re-enable updates.'],
  no_upstream: ['info', 'Your branch has no upstream — set one with `git branch --set-upstream-to`.'],
  dirty: ['info', 'You have local changes in the Geneseed folder. Commit or stash them, then update.'],
  ready: ['info', ''],
};

function pre(code) {
  const [kind, message] = PRE_MSG[code];
  return { ok: code === 'ready', code, kind, message };
}

/** `_preflight()` — Phase A, local only, no network. Never raises. */
export function preflight() {
  let [rc, out] = gitRun(['rev-parse', '--is-inside-work-tree']);
  if (rc === null) return pre('no_git_exe');
  if (rc !== 0 || out !== 'true') return pre('not_git');
  [rc, out] = gitRun(['symbolic-ref', '-q', 'HEAD']);
  if (rc !== 0 || !out) return pre('detached');
  [rc] = gitRun(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (rc !== 0) return pre('no_upstream');
  [rc, out] = gitRun(['-c', 'core.fileMode=false', '-c', 'core.autocrlf=false',
    'status', '--porcelain', '--untracked-files=no']);
  if (rc !== 0) return pre('not_git');
  if (out) return pre('dirty');
  return pre('ready');
}

/** `_fetch_timeout()`. `parseIntStrict` is null where `int()` raises, which is the `except` arm. */
export function fetchTimeout() {
  const n = parseIntStrict(process.env.GENESEED_NET_TIMEOUT ?? '120');
  if (n === null) return 120;
  return Math.max(30, n);
}

/**
 * `_count(s)` — `int(s) if s.isdigit() else 0`.
 *
 * ASCII-only on purpose. `str.isdigit()` is true for `'٣'` and `'²'`, on which `int()` then
 * RAISES — a reference crash no caller could survive, and one no git output can produce
 * (`rev-list --count` prints ASCII). Reproducing the crash would be reproducing a bug; the
 * divergence is confined to input git cannot emit and is recorded rather than matched.
 */
export function countOccurrences(s) {
  const t = stripWhitespace(s || '');
  return /^[0-9]+$/.test(t) ? Number(t) : 0;
}

/**
 * `_kill_tree(p)` — kill a fetch AND its helpers (git-remote-https). Killing only `git`
 * leaves the helper holding the output pipe (and `.git` lock files on Windows), which is
 * how a timed-out fetch used to hang the updater forever.
 */
export function killTree(child) {
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
    else spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)],
      { encoding: 'utf8', timeout: 15000, ...NO_WINDOW });
  } catch {
    try { child.kill(); } catch { /* already gone */ }
  }
}

/**
 * `_reader`'s phase filter — log a progress line only when its PHASE changes.
 *
 * Pure, and exported for the corpus: git repaints `Receiving objects:  43%` hundreds of
 * times and universal-newline decoding turns every `\r` repaint into its own line, so
 * without this a 30-second fetch writes a thousand lines into the install log. No cell can
 * reach it — a local-path fetch prints nothing at all — so
 * `tests/test_pure_function_parity.py` runs it over a recorded fetch transcript instead.
 *
 * Returns `[linesToLog, lastPhase]`, splitting the reference's loop from its side effects.
 */
export function fetchPhases(rawLines, last = '') {
  const out = [];
  for (const raw of rawLines) {
    const line = redactUrlCreds(stripWhitespace(raw));
    if (!line) continue;
    const phase = line.split(':')[0];
    if (phase !== last) {
      out.push(line);
      last = phase;
    }
  }
  return [out, last];
}

/**
 * `_fetch_streaming(log)` — `git fetch --progress` with live output, a heartbeat, and a HARD
 * deadline. Returns `[rc, tail]`; `rc` null on spawn failure or timeout.
 *
 * ASYNCHRONOUS where the reference is a thread plus a poll loop, and that is the honest
 * translation rather than a shortcut: Python needs the reader thread because `for raw in
 * p.stdout` blocks, and the 0.25s poll exists to give the deadline somewhere to live. Node's
 * stream is already event-driven, so the same three behaviours — stream, beat, deadline —
 * are a `data` handler and two timers, and `bin/geneseed-cli.mjs` has awaited its verbs
 * since P6h.
 */
export async function fetchStreaming(log = null) {
  const exe = which('git');
  if (!exe) return [null, 'git is not installed or not on PATH'];
  const timeout = fetchTimeout();
  const args = ['-C', String(ROOT),
    '-c', 'http.lowSpeedLimit=1000', '-c', 'http.lowSpeedTime=15',
    'fetch', '--progress'];
  let child;
  try {
    child = spawn(exe, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      // `start_new_session=True` on POSIX — the process GROUP `killTree` signals.
      detached: process.platform !== 'win32',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      ...NO_WINDOW,
    });
  } catch (e) {
    return [null, String(e && e.message ? e.message : e)];
  }
  const lines = [];
  let last = '';
  let pending = '';
  const feed = (chunk) => {
    // Python reads this pipe in TEXT mode, so `\r` — git's progress repaint — is a line
    // break as much as `\n` is. A port that split on `\n` alone would hand one enormous
    // line to the phase filter and log the whole fetch as a single entry.
    pending += chunk;
    const parts = pending.split(/\r\n|\n|\r/);
    pending = parts.pop();
    const [emit, next] = fetchPhases(parts, last);
    last = next;
    for (const p of parts) {
      const s = redactUrlCreds(stripWhitespace(p));
      if (s) lines.push(s);
    }
    if (log) for (const l of emit) log(`[geneseed]   ${l}`);
  };
  // `stderr=subprocess.STDOUT`: git writes its progress to stderr and the reference merges
  // the two into one ordered stream before reading.
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', feed);
  child.stderr.on('data', feed);

  const start = Date.now();
  let nextBeat = 15000;
  let timedOut = false;
  const beat = setInterval(() => {
    const elapsed = Date.now() - start;
    if (elapsed >= timeout * 1000) {
      timedOut = true;
      killTree(child);
      return;
    }
    if (log && elapsed >= nextBeat) {
      log(`[geneseed]   ... still fetching (${Math.floor(elapsed / 1000)}s elapsed)`);
      nextBeat += 15000;
    }
  }, 250);
  const status = await new Promise((resolve) => {
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code));
  });
  clearInterval(beat);
  if (pending) feed('\n');
  const tail = lines.slice(-5).join('\n');
  if (timedOut) {
    if (log) log(`[geneseed] ✗ fetch produced nothing for ${timeout}s — killed it.`);
    return [null, tail];
  }
  return [status, tail];
}

/**
 * `_measure_upstream(log)` — Phase B: fetch (streamed), then classify. Returns
 * `[code, behind, err]` with `code` ∈ {ready, fetch_failed, unrelated, diverged, uptodate}.
 */
export async function measureUpstream(log = null) {
  const [rc, err] = await fetchStreaming(log);
  if (rc !== 0) return ['fetch_failed', 0, err];
  const [, aheadRaw] = gitRun(['rev-list', '--count', '@{u}..HEAD']);
  const [, behindRaw] = gitRun(['rev-list', '--count', 'HEAD..@{u}']);
  const ahead = countOccurrences(aheadRaw);
  const behind = countOccurrences(behindRaw);
  if (ahead > 0) {
    const [mrc] = gitRun(['merge-base', 'HEAD', '@{u}']);
    return [mrc === 0 ? 'diverged' : 'unrelated', 0, ''];
  }
  if (behind === 0) return ['uptodate', 0, ''];
  return ['ready', behind, ''];
}

export const DOCTOR_LEGEND = [
  '[geneseed] doctor problem legend — what the lines above mean / how to fix:',
  "  • 'dead link'          → a skill/agent body links a sibling as <dir>/<name>.md; use the BARE <name>.md (source bug)",
  "  • 'unresolved token'   → a {{TOKEN}} is missing from a theme; add it to ALL theme JSONs",
  "  • 'incomplete source'  → AGENT.md lists a skill whose file isn't in this snapshot (usually a mid-publish cache — retry)",
  "  • 'stale' / 'missing'  → the rendered Harness/ is out of sync (rebuild locally; harmless on a fresh clone)",
  "  • 'parity'             → the themes disagree on which tokens exist",
  "  • 'escapes the bundle' → an absolute or ../ path leaked into a rendered file",
];

/**
 * `_run_doctor(cand)` — validate a source tree with its OWN `doctor --all --no-bundle`.
 * Fail-closed: any nonzero exit, timeout or spawn error is a failure.
 *
 * THE SPAWN THAT CANNOT BE AN IMPORT. `cand` is the tree as it exists AFTER the merge, and
 * this process's module graph was loaded before it. `cmdDoctor` in-process would validate the
 * source this program started with and pass, which is the one answer that must never be
 * given here — the gate exists to catch a bad upstream commit.
 */
export function runDoctor(cand) {
  const r = spawnSync(process.execPath,
    [path.join(String(cand), 'bin', 'geneseed-cli.mjs'), 'doctor', '--all', '--no-bundle'],
    { encoding: 'utf8', timeout: 300 * 1000, maxBuffer: 256 * 1024 * 1024, ...NO_WINDOW });
  if (r.error || r.status === null) {
    return [false, `[geneseed] doctor gate could not run: ${r.error || 'no exit status'}`];
  }
  // `stderr=subprocess.STDOUT` — the reference gives the child ONE handle, so its two
  // streams are interleaved in write order and arrive as `proc.stdout`. `spawnSync` has no
  // way to hand two descriptors the same pipe, so the two are concatenated instead: equal
  // whenever the child writes to only one of them, which `doctor` does (`js/doctor.mjs`
  // reports every problem through `printOut`), and the reason the two doctor cells below are
  // the gate on this rather than a comment. If a future check reports on stderr the
  // ORDERING here is what would differ, not the content.
  return [r.status === 0, universal(r.stdout) + universal(r.stderr)];
}

/** `_pull_and_validate(log)` — fast-forward to `@{u}`, then doctor-gate with exact rollback. */
export function pullAndValidate(log) {
  const [rc0, old] = gitRun(['rev-parse', 'HEAD']);
  if (rc0 !== 0 || !old) return [false, 'not_git', 'could not read HEAD'];
  log('[geneseed] fast-forwarding to upstream ...');
  const [rc1, , err] = gitRun(['merge', '--ff-only', '@{u}'], { timeout: 60 });
  if (rc1 !== 0) {
    return [false, 'collision',
      'Update blocked — a new upstream file collides with a local untracked '
      + 'file. Move or remove it, then update.\n' + err];
  }
  const [rc2, pulled] = gitRun(['log', '--oneline', '--no-decorate', '-20', `${old}..HEAD`]);
  if (rc2 === 0 && pulled) {
    log('[geneseed] pulled:');
    for (const line of pulled.split('\n')) log(`  ${line}`);
  }
  log('[geneseed] validating the pulled source (doctor — can take a minute) ...');
  const [passed, output] = runDoctor(ROOT);
  log(output.replace(/\n+$/, ''));
  if (!passed) {
    gitRun(['reset', '--hard', old], { timeout: 60 });
    for (const line of DOCTOR_LEGEND) log(line);
    return [false, 'doctor_fail',
      'the pulled source FAILS validation — rolled back to the previous commit. '
      + 'Fix the problems listed above.'];
  }
  return [true, 'ready', ''];
}

/** `_logfile()` — persistent install log, overridable with `$GENESEED_LOG`. */
export function logfile() {
  const env = process.env.GENESEED_LOG;
  // `Path(env)`, stringified with the platform separator when `upgrade` prints it — the same
  // rule `GENESEED_OUT` needed. No cell can set this (`cell_env` clears every `GENESEED_*`
  // and no upgrade cell re-adds it), so it is spelled from the rule rather than from a gate.
  if (env) return toPlatformPath(env);
  return path.join(os.homedir(), '.geneseed-install.log');
}

/** `_Log` — print (flushed) and append, with a temp-dir fallback when `$HOME` is read-only. */
export class Log {
  constructor() {
    this.path = logfile();
    try {
      writeText(this.path, '');                       // truncate
    } catch {
      this.path = path.join(os.tmpdir(), 'geneseed-install.log');
      try { writeText(this.path, ''); } catch { this.path = null; }
    }
  }

  call(msg) {
    printOut(`${msg}\n`);
    if (this.path !== null) {
      try { appendText(this.path, `${msg}\n`); } catch { /* OSError: pass */ }
    }
  }
}

/** `_resolve_emit` — `$GENESEED_EMIT` > global-config marker > bundle marker > files. */
export function resolveEmit(cfg, out) {
  const env = process.env.GENESEED_EMIT;
  if (env) return env;
  for (const marker of [path.join(String(cfg), '.geneseed-emit'),
    path.join(String(out), '.geneseed-emit')]) {
    try {
      const val = stripWhitespace(readText(marker));
      if (val) return val;
    } catch { /* OSError: pass */ }
  }
  return 'files';
}

/** `_marker_theme` — global-config marker > bundle marker > "" (none). */
export function markerTheme(cfg, out) {
  for (const marker of [path.join(String(cfg), '.geneseed-theme'),
    path.join(String(out), '.geneseed-theme')]) {
    try {
      const val = stripWhitespace(readText(marker));
      if (val) return val;
    } catch { /* OSError: pass */ }
  }
  return '';
}

/**
 * `_config_theme(here)` — the theme the LOCAL `harness.config.json` asks for, captured
 * before SYNC overwrites it with upstream's. Fallback only; a bundle marker still wins.
 */
export function configTheme(here) {
  try {
    const data = JSON.parse(readText(path.join(String(here), 'harness.config.json')));
    return String(data.theme || '');
  } catch { return ''; }
}

/**
 * `_migrate_stray_bundle` — move host state (context.json, memory/) from an OLD in-folder
 * bundle to the canonical sibling `out` BEFORE rebuilding, then drop the stray.
 */
export function migrateStrayBundle(here, out, log) {
  const stray = path.join(String(here), 'Harness');
  const outStr = String(out);
  if (outStr === stray) return;
  try { if (!statSync(stray).isDirectory()) return; } catch { return; }
  mkdirSync(outStr, { recursive: true });
  const ctx = path.join(stray, 'context.json');
  if (existsSync(ctx) && statSync(ctx).isFile() && !existsSync(path.join(outStr, 'context.json'))) {
    copyFile(ctx, path.join(outStr, 'context.json'));
    log(`[geneseed] rescued context.json from ${stray} -> ${outStr}`);
  }
  for (const mem of ['memory', 'anamnesis']) {
    const src = path.join(stray, mem);
    if (existsSync(src) && statSync(src).isDirectory() && !existsSync(path.join(outStr, mem))) {
      // `shutil.copytree`, which copies with `copy2` semantics — `preserveTimestamps` is
      // the half that matters (the permission bits are the deliberate deviation
      // `js/lib/fs.mjs`'s `copyFile` already documents for the same reason).
      cpSync(src, path.join(outStr, mem), { recursive: true, preserveTimestamps: true });
      log(`[geneseed] rescued ${mem}/ from ${stray} -> ${outStr}`);
    }
  }
  log(`[geneseed] removing stray in-folder bundle ${stray} (canonical: ${outStr})`);
  rmSync(stray, { recursive: true, force: true });
}

/**
 * `sys.stdout.flush()` before an INHERITING spawn — `_harness_core.run`'s second half (P5f),
 * which this module needs for the same reason and by a different mechanism.
 *
 * Python block-buffers a redirected stdout, so a parent that prints and then spawns a child
 * sharing the handle has its own line arrive last. Node's `process.stdout` is asynchronous
 * for a PIPE on macOS (synchronous on Windows and Linux), so the same reordering is a
 * platform-specific bug here — invisible to every cell on this machine, which is exactly the
 * kind of thing that ships. Awaiting the drain costs one tick and closes it everywhere.
 */
async function drainStdout() {
  if (process.stdout.writableLength === 0) return;
  await new Promise((resolve) => { process.stdout.write('', resolve); });
}

/**
 * `_rebuild_bundle` — render the bundle from the (already-updated) source and bounce a
 * running web daemon. Returns the build subprocess returncode (0 = ok).
 */
export async function rebuildBundle(here, out, theme, emit, rootDir, log) {
  const buildArgs = ['--out', String(out)];
  if (theme) buildArgs.push('--theme', theme);
  if (emit === 'opencode') buildArgs.push('--emit', 'opencode', '--root', String(rootDir));
  else if (emit === 'opencode-global') buildArgs.push('--emit', 'opencode-global');
  log(`[geneseed] rebuilding bundle -> ${out} (theme: ${theme || 'config default'}, emit: ${emit}) ...`);
  await drainStdout();
  // THE GENERATOR, RE-EXECUTED. `js/generate.mjs`'s `cmdBuild` calls `driverMain` in-process
  // and is right to — nothing has changed under it. Here the source on disk was replaced
  // three statements ago, so this must be a new process reading the new files.
  const proc = spawnSync(process.execPath,
    [path.join(String(here), 'bin', 'build-driver.mjs'), ...buildArgs],
    { cwd: String(here), stdio: 'inherit' });
  if (proc.status !== 0) return proc.status === null ? 1 : proc.status;
  // If a web daemon is running, bounce it so the new source and the freshly rebuilt web/dist
  // take effect — otherwise the open PWA keeps hitting the old code. EXCEPT when this
  // upgrade IS a web-daemon job: restarting the daemon here kills the process tracking this
  // very job (console stuck on 'running' forever); in that case the server restarts itself
  // once the job is recorded as finished. `js/web/jobs.mjs` sets the variable; this is the
  // side that reads it, and `upgrade/the-web-job-marker-...` is what gates the pair.
  if (process.env.GENESEED_WEB_JOB) {
    log('[geneseed] web daemon will restart itself after this job to load the new code.');
    return 0;
  }
  try {
    await restartDaemon(theme, 4747, false, true);
  } catch (e) {                       // never fail an upgrade on this
    log(`[geneseed] ⚠️  could not refresh the web daemon (${e && e.message ? e.message : e}) — \`geneseed web restart\` manually if it was running.`);
  }
  return 0;
}

/**
 * `_rebuild_installs` — refresh every registered ACTIVE install via `rebuild-all`. The
 * emit-marker rebuild only covers THIS checkout's own bundle; without this pass a
 * claude-global or bob install keeps serving the OLD render after every upgrade, silently.
 */
export async function rebuildInstalls(here, log) {
  log('[geneseed] refreshing every active install (rebuild-all) ...');
  await drainStdout();
  const proc = spawnSync(process.execPath,
    [path.join(String(here), 'bin', 'geneseed-cli.mjs'), 'rebuild-all'],
    { cwd: String(here), stdio: 'inherit' });
  return proc.status === null ? 1 : proc.status;
}

/**
 * `upgrade(ref, theme_arg, zip_arg)` — update from the install's own git origin
 * (fast-forward only), doctor-gate, and rebuild the bundle plus every registered install.
 * `ref`/`zip_arg` are accepted for back-compat but IGNORED. Returns a process exit code:
 * 0 ok/up-to-date, 3 info precondition, 1 error.
 */
export async function upgrade(ref = null, themeArg = null) {
  const logger = new Log();
  const log = (m) => logger.call(m);
  if (ref) {
    log(`[geneseed] ⚠️  ref '${ref}' is IGNORED — updates follow the checkout's `
      + 'current branch (tag/branch pinning was removed with the zip path).');
  }
  const here = String(ROOT);
  // `Path(os.environ.get(...) or ...)`, and `toPlatformPath` is the `Path(str)` half of it: the
  // reference stringifies with the PLATFORM separator, so a `GENESEED_OUT` spelled
  // `C:/x/bundle` — which is how a JSON config, a shell script and this harness's own
  // `{sb/}` placeholder all spell it — reaches the log as `C:\x\bundle`. Six cells differed
  // on exactly that and nothing else.
  const out = toPlatformPath(process.env.GENESEED_OUT || path.join(path.dirname(here), 'Harness'));
  const rootDir = toPlatformPath(process.env.GENESEED_ROOT || path.dirname(out));
  const cfg = opencodeConfigDir();
  const emit = resolveEmit(cfg, out);

  // The LOCAL theme, before the pull overwrites harness.config.json.
  const cfgTheme = configTheme(here);

  const origin = originDisplay();
  const [, branch] = gitRun(['rev-parse', '--abbrev-ref', 'HEAD']);
  log(`[geneseed] update source: ${origin.url}${branch ? ` (branch: ${branch})` : ''}`);

  log('[geneseed] preflight: checking the local checkout ...');
  const p = preflight();
  if (!p.ok) {
    log(`[geneseed] ${p.message}`);
    return p.kind === 'info' ? 3 : 1;
  }

  log(`[geneseed] fetching from origin (git: ${which('git') || 'git'}, `
    + `timeout: ${fetchTimeout()}s) ...`);
  const [code, behind, err] = await measureUpstream(log);
  if (code === 'fetch_failed') {
    log('[geneseed] ✗ could not reach the remote: '
      + `${err || 'git fetch hung without any output.'}`);
    log('[geneseed]   If `git pull` works in your terminal but not here, this '
      + 'daemon likely lacks your shell\'s environment (VPN/proxy vars, SSO or '
      + 'Kerberos credentials). Restart it from that terminal: `geneseed web restart`.');
    return 1;
  }
  if (code === 'unrelated') {
    log('[geneseed] Upstream history was rewritten; back up local work, then re-clone '
      + 'or `git reset --hard @{u}`.');
    return 3;
  }
  if (code === 'diverged') {
    log("[geneseed] Your branch has local commits and can't fast-forward — push/rebase "
      + 'or reset first.');
    return 3;
  }
  if (code === 'ready') {
    log(`[geneseed] ${behind} new commit(s) upstream — updating ...`);
    const [ok, fcode, msg] = pullAndValidate(log);
    if (!ok) {
      log(`[geneseed] ${msg}`);
      return fcode === 'collision' ? 3 : 1;
    }
  } else {                                     // uptodate
    log('[geneseed] already up to date.');
  }

  const theme = themeArg || markerTheme(cfg, out) || cfgTheme;
  // Best-effort rescue, never a gate: a locked file in the stray bundle must not abort the
  // upgrade AFTER the pull has already been applied.
  try {
    migrateStrayBundle(here, out, log);
  } catch (e) {
    log(`[geneseed] ⚠️  could not migrate the old in-folder bundle (${e && e.message ? e.message : e}) — continuing.`);
  }
  let rc = await rebuildBundle(here, out, theme, emit, rootDir, log);
  if (rc !== 0) {
    log(`[geneseed][E-BUILD] ✗ the bundle build FAILED (theme: ${theme || 'default'}, emit: ${emit}).`);
    return 1;
  }
  rc = await rebuildInstalls(here, log);
  if (rc !== 0) {
    log('[geneseed][E-BUILD] ✗ one or more installs failed to rebuild — '
      + 'run `geneseed rebuild-all` to retry (details above).');
    return 1;
  }
  log(`[geneseed] ✓ upgrade complete.${logger.path ? ` (full log: ${logger.path})` : ''}`);
  return 0;
}

/**
 * `_harness_lifecycle.cmd_upgrade` — the harness verb, which is `export_improvements()` and
 * then `upgrade()`.
 *
 * THE EXPORT RUNS FIRST AND MUST NEVER BLOCK. The self-improvement loops edit the deployed
 * harness in place and the rebuild is about to overwrite those edits, so the drift has to be
 * captured against the PRE-refresh source. Anything it throws is a warning on stderr and the
 * upgrade continues — a failed export is a lost note, a blocked upgrade is a broken install.
 */
export async function cmdUpgrade(args) {
  try {
    const [ipath] = exportImprovements();
    if (ipath) {
      printOut(`[upgrade] deployed harness carries local edits — saved to ${ipath}\n`);
      printOut('[upgrade] hand that file to your agent to back-port them into src/.\n');
    }
  } catch (e) {
    printErr(`[upgrade] ⚠️  could not export local edits (${e && e.message ? e.message : e}) — `
      + 'run `geneseed diff --out FILE` before upgrading to keep them.\n');
  }
  let { ref } = args;
  let theme = args.theme;
  // Back-compat: the legacy hidden `ref` positional eats the FIRST argument, so
  // `geneseed upgrade imperial` lands in `ref` (which `upgrade` ignores) and the theme
  // silently drops. `ref` is dead — reinterpret it as the theme when it names one.
  if (theme === null && ref && existsSync(path.join(String(ROOT), 'themes', `${ref}.json`))) {
    theme = ref;
    ref = null;
  }
  return upgrade(ref, theme);
}

/**
 * `_update.sync_self` — an ALIAS of `upgrade`, and the argument it drops is the behaviour.
 *
 * One `git pull` refreshes the launchers AND the factory, so the two verbs became one
 * operation; the separate subcommand is kept for the stable contract. `ref` is bound by the
 * parser for back-compat and then dropped HERE — this calls `upgrade()` with no arguments
 * rather than forwarding anything.
 *
 * "IGNORED" IS NOT SILENT, which is what makes the dropping observable and is a correction the
 * mutations made to this docblock. `upgrade(ref)` does not quietly disregard a ref — it opens by
 * LOGGING `⚠️ ref '<x>' is IGNORED — updates follow the checkout's current branch`. So
 * `syncSelf` forwarding its argument would make `sync-self v1.2.3` print a warning the reference
 * never prints (mutation M22), and wiring the verb table's row straight at `cmdUpgrade` would
 * additionally make `sync-self cyberpunk` rebuild in cyberpunk, because `cmdUpgrade` re-reads
 * the dead positional as a THEME when `themes/<ref>.json` exists (M21). Two different defects
 * behind one plausible-looking shortcut, and
 * `sync-self/the-ref-positional-is-accepted-and-never-re-read-as-a-theme` is the cell for both.
 */
export function syncSelf(_ref = null) {
  return upgrade();
}

/** `_harness_lifecycle.cmd_sync_self`. */
export function cmdSyncSelf(args) {
  return syncSelf(args.ref);
}

// ---------------------------------------------------------------------------------------
// bootstrap — the update STEP RUNNER
// ---------------------------------------------------------------------------------------
//
// WHAT CROSSES AND WHAT DOES NOT, measured rather than assumed (`rituals/_harness_lifecycle.py`
// `cmd_bootstrap` and its closure, ~284 lines over eleven functions):
//
//   * `_bootstrap_plain` and everything under it CROSS — the step banner, the 0/3/other exit
//     rule, `_diagnose_failed_step`'s persistence to the install log, `_flush_export_notes`
//     and `_reexec`.
//   * `_bootstrap_progress` / `_run_steps` / `_run_logged` / `_bootstrap_draw` / `_clean_line`
//     / `_pipe_select_ok` — 141 lines of CURSES progress UI — do NOT. P5i ported `cmd_setup`'s
//     LINE wizard and declared its curses arm on exactly these terms; this is the same arm of
//     the same fork (`sys.stdin.isatty()`), and it belongs with P7's panel. The consequence is
//     stated plainly: an interactive `geneseed bootstrap` shows a progress screen under Python
//     and plain lines under Node, and every non-interactive invocation — which is every cell,
//     every script and every CI run — is identical.
//   * `_harness_supports` and `_stale_factory_hint` do not cross either, and for a reason that
//     is not "unreachable from a cell". They exist because a PARTIAL update can leave a new
//     launcher over a `harness.py` that has never heard of `upgrade`, so `_update_step_cmd`
//     probes the subcommand with a `--help` spawn and falls back to `rituals/_update.py`. The
//     Node twin's step is a function it statically imported: there is no version of this
//     program in which `upgrade` is missing and no argparse `invalid choice` to detect. A twin
//     that spawned a `--help` probe to answer a question it already knows would be ceremony.
//
// THE STEP IS AN IMPORT, NOT A SPAWN, and this is the one place in this module where that is
// the right answer. `_ALLOWED_SPAWNS`' argument for the other re-executions is that THE CODE ON
// DISK CHANGES HALFWAY THROUGH — `pullAndValidate` must ask the PULLED source, `rebuildBundle`
// must render with the PULLED generator. Nothing has changed when the update step STARTS, so
// `upgrade()` here is the same program either way, and the reference's own spawn is an artifact
// of the progress UI needing a pipe to stream. What is kept is the ARGV, because the install
// log promises the user a command they can re-run.

/**
 * `_update_step_cmd(here, sub)`, reduced to what survives the paragraph above: the command that
 * reproduces this step, for the log and the diagnosis.
 *
 * The stale-factory fallback is not reproduced (see the block comment). This names the running
 * interpreter by absolute path and this repo's own CLI — the same spelling every other argv in
 * this port uses, and no spelling of `python` can reach it.
 */
function updateStepCmd(sub) {
  return [process.execPath, path.join(String(ROOT), 'bin', 'geneseed-cli.mjs'), sub];
}

/**
 * `_harness_lifecycle._diagnose_failed_step` — the diagnosis for a failed update step, PERSISTED
 * before it is printed.
 *
 * The persistence is the point rather than a nicety: the curses log pane is ephemeral and the
 * plain path's child output scrolls past, so without the file the only trace of WHY a step
 * failed is gone the moment the screen tears down — and the error two frames up tells the user
 * to look for details.
 *
 * `output` reaches the reference as a captured re-probe used to recognise argparse's
 * `invalid choice`; the twin has no such probe and passes `''`, so the stale-factory lines
 * cannot appear here. The branch that writes it to the log is kept because it is the
 * reference's, and the cell that reaches this function proves the two agree with it empty.
 */
export function diagnoseFailedStep(n, total, title, cmd, rc, output) {
  const lines = [`[geneseed] ✗ step ${n}/${total} FAILED (exit ${rc}): ${title}`];
  // `_install_logfile()` in the reference is `_update._logfile()` behind an import guard that
  // cannot fail here, and its fallback is the same path `logfile()` already returns.
  const logpath = logfile();
  if (logpath !== null) {
    try {
      let body = `\n==== geneseed update: step ${n}/${total} '${title}' `
        + `FAILED (exit ${rc}) ====\n`;
      body += `command: ${cmd.map(String).join(' ')}\n`;
      if (output.trim()) body += `${output.replace(/\n+$/, '')}\n`;
      appendText(logpath, body);
      lines.push(`[geneseed] ── full install log: ${logpath}`);
    } catch { /* OSError: pass */ }
  }
  return lines;
}

/**
 * `_harness_lifecycle._bootstrap_plain` — run the update step with plain output, never fatally.
 *
 * EXIT 3 IS NOT A FAILURE. `upgrade` returns 3 for an info precondition — a dirty tree, no
 * upstream, already up to date — and a bootstrap that reported those as failures would tell
 * every user with local changes that their install broke. `rc not in (0, 3)`, spelled here as
 * two comparisons, is the whole rule; `rc !== 0` is the plausible wrong version of it.
 *
 * Returns true when a step FAILED, so scripted callers get a real exit code.
 */
async function bootstrapPlain() {
  // One `git pull` refreshes launchers + factory together, then rebuilds — a single step.
  //
  // `cmdUpgrade`, NOT `upgrade`. The step the reference runs is the SUBCOMMAND — its argv is
  // `harness.py upgrade` — and `cmd_upgrade` is where `export_improvements()` lives, ahead of
  // the update it must run before. A step wired at the module function skips it, and the
  // deployed harness's local edits are overwritten by the rebuild with nothing recorded.
  // Caught by `bootstrap/an-improvements-file-the-step-exported-is-re-announced-afterwards`,
  // which was written for `_flush_export_notes` and found this instead.
  const steps = [['Update & rebuild', updateStepCmd('upgrade'),
    () => cmdUpgrade({ ref: null, theme: null })]];
  let failed = false;
  for (let i = 0; i < steps.length; i += 1) {
    const [title, cmd, step] = steps[i];
    printOut(`[geneseed] step ${i + 1}/${steps.length}: ${title} ...\n`);
    // eslint-disable-next-line no-await-in-loop
    const rc = await step();
    if (rc !== 0 && rc !== 3) {
      failed = true;
      for (const ln of diagnoseFailedStep(i + 1, steps.length, title, cmd, rc, '')) {
        printOut(`${ln}\n`);
      }
    }
  }
  if (!failed) printOut('[geneseed] ✓ update complete.\n');
  return failed;
}

/**
 * `_harness_lifecycle._reexec` — hand off to a FRESH process so the just-updated code on disk
 * runs, not the modules this one loaded before the pull.
 *
 * Node has no `execv`, so this is always the reference's WINDOWS branch: run the child normally
 * and exit with its status. That branch exists in the reference for its own reason (`os.execv`
 * on Windows spawns and kills the parent, handing the console back to the launcher's cmd.exe
 * mid-run so the two then fight over input), and on POSIX the only difference here is that a
 * process id survives the handoff. Nothing observes it.
 */
function reexec(argv) {
  const r = spawnSync(argv[0], argv.slice(1), { stdio: 'inherit', ...NO_WINDOW });
  return r.status === null ? 1 : r.status;
}

/**
 * `_harness_lifecycle.cmd_bootstrap` — update everything, then hand off to a fresh `setup`.
 *
 * `flushExportNotes()` runs BEFORE the handoff, deliberately: the re-exec replaces this process
 * and the update step's own improvements notice has scrolled past (or, under the reference's
 * curses arm, died with the alternate screen).
 */
export async function cmdBootstrap(args) {
  const failed = await bootstrapPlain();
  flushExportNotes();
  if (!args.noSetup) {
    return reexec([process.execPath,
      path.join(String(ROOT), 'bin', 'geneseed-cli.mjs'), 'setup']);
  }
  // Scripted `bootstrap --no-setup` must not exit 0 over a failed update.
  return failed ? 1 : 0;
}
