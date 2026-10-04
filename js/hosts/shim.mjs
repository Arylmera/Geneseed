/**
 * The machine-wide HOOK SHIM — where it lives, what it says, whether it still resolves — and
 * the two shim-shaped readers `migrate` needs (`migrateShape`, the autostart scan).
 *
 * SPLIT OUT OF `js/hosts/settings.mjs` (2026-10) for its cheapest caller. Every CLI run asks
 * `shimDead()` (the dead-shim warning in `bin/geneseed-cli.mjs`), and that used to load the
 * whole settings-merge module — the JSONC reader, the JSON printer, the text helpers — to read
 * one small file. `uninstall` had the same problem one level up: it imported
 * `js/build/driver.mjs`, and through it the whole generator, for the two-line
 * `hookRunnerEntry`, which now lives here beside the `hookPrefix` that consumes its answer.
 *
 * Keep this module's imports to `node:` builtins, `js/lib/fs.mjs` and `./hosts.mjs`: being
 * cheap to load is its whole reason to exist.
 */
import {
  chmodSync, existsSync, mkdirSync, realpathSync, renameSync, statSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readText, isOsError } from '../lib/fs.mjs';
import { expanduser } from './hosts.mjs';

/** The checkout this module ships in — `js/build/source.mjs`'s `ROOT`, computed locally so the
 * shim does not import the source loader. */
const ROOT = path.resolve(import.meta.dirname, '../..');

// `|| exit 0` on the emitted commands does NOT mean "ignore failures": git-gate and
// rule-gate return 0 on EVERY path and signal their verdict as a JSON object on stdout.
// The `|| exit 0` is there because a hook that fails to LAUNCH (a moved checkout, a dead
// interpreter) must not block the tool call. A stray byte on stdout — a cmd.exe command
// echo, a "created ~/.geneseed" notice — corrupts that JSON and the gate stops gating
// while still reporting success. Hence `@echo off`, and a shim that prints nothing.
//
// The marker lives in the FILENAME, not the directory: GENESEED_HOME relocates the dir,
// and a relocated install's hooks must stay recognisable to `GENESEED_HOOK_SNIFF`.
export const SHIM_MARK = 'geneseed-hook';

/**
 * `_build_settings._SHIM_ARGV` — the tokens in a shim body that are NOT paths.
 *
 * `shimProblems` reads every quoted token back out of the body and requires each to name an
 * existing file. On Windows that is exactly the two baked paths (`%*` is bare); on POSIX the
 * body forwards argv as `"$@"`, quoted, so both implementations' `doctor` reported a healthy
 * shim as dead on every Linux and macOS host. A defect the port faithfully inherited, and
 * one no Windows cell could see.
 */
export const SHIM_ARGV = new Set(['$@', '%*']);

/**
 * Every quoted token in a shim body that names a path which is not there — empty is healthy.
 *
 * ONE OWNER, because the rule has two consumers now and a second copy is a second place for the
 * `"$@"` defect above to come back: `js/inspect/checks-repo.mjs` turns this into the `[shim] … does not
 * exist` report, and `hookPrefix` reads it to decide whether the shim already on disk is worth
 * protecting from a checkout that will not outlive the emit.
 */
export function shimDeadPaths(body) {
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1])
    .filter((q) => !SHIM_ARGV.has(q) && !existsSync(q));
}

/** `_SHIM_REL`, with the platform as an argument.
 *
 * Python computes it at IMPORT time from `sys.platform`, which is what makes the other
 * platform's branch unreachable on any one machine. Taking it as a parameter is what lets
 * the parity gate compare both branches in one run (Python's side is reachable because
 * `_hook_shim_body` reads `sys.platform` at CALL time). */
export function shimRel(platform = process.platform) {
  return ['bin', SHIM_MARK + (platform === 'win32' ? '.cmd' : '')];
}

/**
 * `_build_settings._shim_home`.
 *
 * `expanduser` is `js/hosts/hosts.mjs`'s — GENESEED_HOME is user-set, same as any config-dir
 * env var there, so a `~user` value here has the identical failure mode (a hook shim written
 * under a literal `~user` directory) and gets the identical refusal. This module used to carry
 * a private "same guard" twin; the two had drifted (this one's refusal message dropped the
 * parenthetical explaining WHY), which is exactly the kind of divergence one owner prevents.
 */
export function shimHome() {
  const env = process.env.GENESEED_HOME;
  return env ? expanduser(env) : path.join(os.homedir(), '.geneseed');
}

/** `_build_settings._hook_shim_path`. */
export function hookShimPath(platform = process.platform) {
  return path.join(shimHome(), ...shimRel(platform));
}

/**
 * The paths the machine's hook shim names that are gone — `[]` when the shim is absent or live.
 *
 * Cheap on purpose: `status`, the doctor and EVERY CLI run call it (the run-time warning in
 * `bin/geneseed-cli.mjs`), because a dead shim disables every hook of every Claude-shaped
 * install and nothing else would say so. An absent shim is not dead — a checkout that has never
 * emitted owns none — and an unreadable one is reported by the doctor, not here.
 */
export function shimDead() {
  try { return shimDeadPaths(readText(hookShimPath())); } catch { return []; }
}

/**
 * `_build_settings._hook_shim_body`, with the two volatile values INJECTED.
 *
 * This is the one function in the unit whose Python output is legitimately
 * runtime-dependent: it bakes `sys.executable` and `<checkout>/rituals/harness.py`, and a
 * Node twin at GA bakes `process.execPath` and a different entry point. Golden already
 * refuses to compare the emitted shim for that reason (`_SHIM_GLOB`) and asserts
 * `_shim_health` instead.
 *
 * So the answer here is NOT "skip it". Taking `runner`, `entry` and `platform` as arguments
 * makes the BODY a pure function of three inputs, which is what lets
 * `tests/unit/hook_form.test.mjs` assert BOTH platform shapes absolutely in one run on
 * whichever host it happens to be on: the `@echo off`, the CRLF, `exit /b` vs `exec`, the
 * quoting that keeps `--root "<cfg>"` intact. What it does not prove is WHICH values the
 * driver passes — that is `hookRunnerEntry()` below, gated separately.
 */
export function hookShimBody(runner, entry, platform = process.platform) {
  if (platform === 'win32') {
    // Bare `exit /b` propagates the LIVE errorlevel; `%ERRORLEVEL%` would expand at parse
    // time and return a stale one. Never plain `exit` — that kills the parent cmd.exe, so
    // the emitted `|| exit 0` would never get to evaluate.
    return '@echo off\r\n'
      + 'rem Generated by Geneseed - do not edit. Rewritten on every emit.\r\n'
      + 'setlocal\r\n'
      + `"${runner}" "${entry}" %*\r\n`
      + 'exit /b\r\n';
  }
  return '#!/bin/sh\n'
    + '# Generated by Geneseed - do not edit. Rewritten on every emit.\n'
    + `exec "${runner}" "${entry}" "$@"\n`;
}

/**
 * `_build_settings._write_hook_shim` — create or refresh the shim, or null on failure.
 *
 * The path and body are arguments for the same reason `hookShimBody`'s two values are: the
 * routine itself has no runtime dependency at all once they are supplied, so all of it is
 * comparable — the unchanged-content fast path (a Windows shim a hook is executing right
 * now cannot be replaced), the newline-folded comparison that makes that fast path
 * reachable, the pid-suffixed temp name that keeps concurrent emits from unlinking each
 * other's file, and the chmod.
 */
export function writeHookShim(p, body, platform = process.platform) {
  try {
    // Newline-normalised: the body carries explicit CRLF on Windows but `read_text()`
    // translates back to `\n`, so a raw `===` would never match and the "unchanged" fast
    // path — the whole point of this branch — would never be taken.
    if (existsSync(p) && statSync(p).isFile()
        && readText(p).replaceAll('\r\n', '\n') === body.replaceAll('\r\n', '\n')) {
      return p;
    }
    mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.tmp`;
    // `newline=''` on the Python side: raw, so the CRLF in the body survives verbatim.
    writeFileSync(tmp, body, 'utf8');
    if (platform !== 'win32') chmodSync(tmp, 0o755);
    renameSync(tmp, p);
    return p;
  } catch (e) {
    if (!isOsError(e)) throw e;
    return null;
  }
}

/** The OS temp root, resolved once. `.native` because a Windows `TEMP` can be an 8.3 alias —
 * the same trap `tests/helpers/sandbox.mjs` documents, reached from the other side. */
const TMP_REAL = (() => {
  try { return realpathSync.native(os.tmpdir()); } catch { return os.tmpdir(); }
})();

/** Is `child` inside `parent`? `path.relative` compares case-insensitively on win32. */
function isUnder(child, parent) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Will the checkout holding `entry` outlive the emit that is baking it into the shim?
 *
 * TWO SHAPES, and both are in `docs/extending.md` §5.3 because both have really happened on this
 * repo: a copied checkout under the OS temp root — the `copyCheckout` fixture, which builds its
 * copy from `git ls-files` and therefore carries no `.git` at all, so only the temp root
 * identifies it — and a git WORKTREE, whose `.git` is a FILE pointing at the main checkout
 * rather than a directory. A plain checkout and an npm install are neither, and keep the
 * ownership they have always had.
 *
 * `tmpRoot` IS A PARAMETER for the reason `shimRel`'s `platform` is: with the real temp root
 * baked in, the second rule is unreachable in a test — anything a test can build under `mkdtemp`
 * has already answered true on the first — so the worktree arm could only ever be exercised by
 * whichever kind of checkout the run happened to sit in.
 */
export function ephemeralCheckout(entry, tmpRoot = TMP_REAL) {
  let real = entry;
  try { real = realpathSync.native(entry); } catch { /* not there yet — test the literal */ }
  if (isUnder(real, tmpRoot)) return true;
  // `<checkout>/bin/geneseed-hook.mjs` — the one shape `hookRunnerEntry` produces.
  try { return statSync(path.join(path.dirname(path.dirname(real)), '.git')).isFile(); } catch {
    return false;
  }
}

/** Does the shim already on disk still name paths that all exist? */
function shimIsLive(p) {
  try { return statSync(p).isFile() && shimDeadPaths(readText(p)).length === 0; } catch {
    return false;
  }
}

/**
 * `_build_settings._hook_prefix` — the `<runner> <entrypoint>` every emitted hook starts
 * with, falling back to the pre-shim direct form when the shim cannot be written.
 *
 * The fallback is strictly no worse than the old behaviour and far better than emitting
 * commands naming a shim that does not exist — those fail on every hook (9009 under
 * cmd.exe, 127 under sh) and take both gates down with them.
 */
export function hookPrefix({ runner, entry, platform = process.platform } = {}) {
  // NOT a default. `runner`/`entry` have no computable fallback on this side — this process's
  // own `process.execPath` is whichever node ran the EMIT, not a runner anyone chose — and
  // the failure mode of letting them through undefined is the worst kind this unit has:
  // `hookShimBody` bakes `"undefined" "undefined" %*`, the shim is rewritten with it, every hook in the install
  // dies, and because the hooks signal through stdout and return 0 on every path, nothing
  // reports it. The shim is also excluded from golden's byte comparison by name, so no
  // acceptance gate would catch it either. Throw where it is cheap to see.
  if (!runner || !entry) {
    throw new Error('hookPrefix: runner and entry are required — the emitted hook shim '
      + 'bakes them, and there is no correct value to guess from inside Node');
  }
  const p = hookShimPath(platform);
  // ⚠ A DISPOSABLE CHECKOUT DOES NOT GET TO CLAIM THE MACHINE-WIDE SHIM. The shim has no
  // per-install component, so the last checkout to emit owns EVERY install's hooks — and when
  // that checkout is a test sandbox or a git worktree, deleting it kills hooks machine-wide with
  // nothing to report it: hooks signal through stdout and return 0 on every path, and this file
  // is excluded from the byte corpora by name. Measured twice in one session, from
  // `tests/unit/harness.test.mjs`'s copied-checkout fixture; `docs/extending.md` §5.3 carries
  // the worktree half.
  //
  // KEEP, NOT REFUSE, and that distinction is what makes this safe to add here rather than at
  // each call site. Returning the existing shim path leaves the emitted hook command
  // byte-identical to what a normal emit writes; taking the fallback below instead would move a
  // hook command in every recorded bundle. The install being emitted then runs the DURABLE
  // checkout's entry — which is exactly what last-writer-wins already handed every other install
  // on the machine, so nothing is lost by it.
  //
  // ONLY A SHIM THAT STILL RESOLVES IS PROTECTED. An absent or already-dead one is no worse for
  // being rewritten from here, and a sandboxed `GENESEED_HOME` (every emit test, every cell) has
  // none — so the suite's own emits are unaffected and this cannot go green by silently
  // skipping the write.
  if (ephemeralCheckout(entry) && shimIsLive(p)) return `"${p}"`;
  const shim = writeHookShim(p, hookShimBody(runner, entry, platform), platform);
  if (shim !== null) return `"${shim}"`;
  process.stderr.write(`[geneseed] WARN: could not write the hook shim at ${p} — emitting `
    + 'hooks that call the interpreter directly. They will break if this checkout moves; '
    + 're-run the build to repair them.\n');
  return `"${runner}" "${entry}"`;
}

/**
 * `_build_settings._hook_runner_entry()`'s two values — this driver's answer, which since
 * P5b is NOT Python's.
 *
 * The Python original returns `sys.executable` and `<checkout>/rituals/harness.py`: the
 * interpreter running `build.py`, and the harness it will hand `%*` to. This driver returns
 * `process.execPath` and `<checkout>/bin/geneseed-hook.mjs`, because the four verbs the
 * emitted hooks invoke — context, git-gate, rule-gate, learn — are now Node, and an install
 * this driver emits therefore needs no Python at all for its hooks.
 *
 * WHAT THIS RETIRED, AND WHY IT IS A DELETION. Until this phase the function was
 * `hookOptsOrDie`: it scanned PATH for an interpreter and refused the four Claude-shaped
 * emits with exit 4 when it found none, because writing a shim that names a nonexistent
 * interpreter silently disables every hook in the install. Both halves are gone. `runner` is
 * `process.execPath` — the node already running this file, which by construction exists —
 * so there is nothing left to discover and no way for discovery to fail. P4e kept the
 * unreachable exit-3 branch because `test_the_node_driver_classifies_every_emit` asserts a
 * partition it belongs to; nothing asserts a partition over this one, so keeping it would
 * be keeping code no test can reach for no stated reason.
 *
 * THE SHIM IS MACHINE-WIDE, AND THAT IS THE DECISION THIS PHASE ACTUALLY TOOK.
 * `hookShimPath()` is `$GENESEED_HOME`-or-`~/.geneseed` + `bin/geneseed-hook[.cmd]`, with no
 * per-install component: every emit of every install on the machine rewrites the same file,
 * and every install's hooks execute it. While both drivers baked Python that was invisible,
 * because last-writer-wins wrote the same thing. It is observable now — a machine whose last
 * emit ran through this file has EVERY install's hooks running under Node, including
 * installs the Python driver wrote, and the reverse.
 *
 * That is correct exactly while the two entry points answer the same verbs the same way, so
 * the gate that used to be a formality is now load-bearing:
 * `test_the_entry_carries_exactly_the_verbs_the_emitter_wires` reads the emitter's wiring
 * and `bin/geneseed-hook.mjs`'s VERBS table and requires them EQUAL — a wired verb the entry
 * lacks is a dead hook on every install on the machine, not just this one. The alternative
 * considered and rejected was a per-driver shim path: the path is baked into every already
 * emitted hook command, so changing it makes every existing install's hooks stale until
 * re-emit, which is P10's migration arriving five phases early.
 *
 * EXPORTED SINCE P6i, because the emitter is no longer its only caller, and HERE since 2026-10
 * rather than in `js/build/driver.mjs`: the second caller imported the whole generator for it.
 * `js/maintain/uninstall.mjs`'s `remergeClaudeHooks` re-merges the canonical hooks when a disabled
 * Claude install is turned back on, and `mergeClaudeSettings` refuses to guess the pair —
 * correctly. There is exactly one right answer on this side and it is this function, so the
 * second caller imports it rather than restating two lines that must never drift: a
 * reactivate whose shim path differed from the emitter's would wire hooks pointing at a file
 * the emitter never writes.
 */
export function hookRunnerEntry() {
  return { runner: process.execPath, entry: path.join(ROOT, 'bin', 'geneseed-hook.mjs') };
}

// P10d. `GENESEED_HOOK_SNIFF` answers "is this hook Geneseed's?". A MIGRATION needs the other
// question — "is this Geneseed's OLD one?" — and the two are not the same sniff.
//
// THREE SHAPES ARE IN THE WILD, AND TWO OF THEM ARE IDENTICAL IN THE SETTINGS FILE:
//   1. legacy-direct  the command itself names `harness.py` (pre-shim, P0 and earlier)
//   2. shim-python    the command names the shim; the shim BODY runs python + harness.py
//   3. shim-node      the command names the shim; the shim BODY runs node + the .mjs entry
//
// 2 and 3 differ ONLY inside the shim body. A classifier reading the host config alone would
// call a fully-unmigrated machine "already migrated" — silently — and `migrate` would no-op on
// exactly the installs it exists for. The shim body is a REQUIRED input, not a refinement.
const SHIM_ENTRY_MARK = 'geneseed-hook.mjs';

/**
 * `_build_settings._migrate_shape` — 'legacy' | 'current' | 'none'.
 *
 * PURE — and currently reached only END TO END, by the `migrate/a-node-baked-shim-reads-as-current`
 * cell. No unit corpus drives it directly, which is worth knowing before trusting it.
 * 'none' is not a fault: a user's own settings.json may carry three hand-written hooks
 * and no Geneseed entry. That must read as
 * "nothing to migrate" rather than "unrecognised", or `migrate` refuses on the commonest
 * config on any machine.
 */
export function migrateShape(commands, shimBody) {
  if (commands.some((c) => c.includes('harness.py'))) return 'legacy';
  if (commands.some((c) => c.includes(SHIM_MARK))) {
    return shimBody.includes(SHIM_ENTRY_MARK) ? 'current' : 'legacy';
  }
  return 'none';
}

/**
 * `_build_settings._autostart_paths` — where a hand-written web-daemon autostart entry lives.
 *
 * NOTHING IN THIS REPOSITORY HAS EVER WRITTEN ONE — the install guide tells the user to create them
 * by hand, and no .py/.mjs/.sh/.cmd in the tree contains `vbs`, `LaunchAgents` or `plist`. So
 * `migrate` REPORTS a stale one and never rewrites it, on the rule `settingsIntegrityCheck`
 * already states: an entry the manifest does not claim is "possibly user-authored; left alone".
 *
 * Both platforms' paths on both platforms, deliberately — the scan is a read that misses
 * harmlessly, and returning only the host platform's would make the macOS arm unreachable
 * from the Windows machine this port is developed on: an ungated branch dressed as a fork.
 */
export function autostartPaths() {
  const home = os.homedir();
  return [
    path.join(home, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu',
      'Programs', 'Startup', 'geneseed-web.vbs'),
    path.join(home, 'Library', 'LaunchAgents', 'dev.geneseed.web.plist'),
  ];
}

/**
 * `_build_settings._autostart_stale` — the entry names a Geneseed launcher somewhere else.
 *
 * Weak in one direction and strict in the other on purpose: it fires only when the file
 * mentions geneseed at all (an unrelated Startup entry is never named), and clears only when
 * the CURRENT root appears verbatim. A false positive costs one printed line; a false negative
 * leaves a login task pointing at a checkout npm is about to make stale.
 */
export function autostartStale(text, root) {
  if (!text.toLowerCase().includes('geneseed')) return false;
  return !text.includes(root) && !text.includes(root.replaceAll('\\', '/'));
}
