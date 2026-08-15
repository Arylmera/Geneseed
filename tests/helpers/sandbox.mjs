// THE SANDBOX KNOWLEDGE, ported so it does not die with `tests/golden.py`.
//
// Every property in this file was found by a CI run rather than by review, and none of them is
// reachable from a developer's own machine. That is the whole reason it exists as a module with
// its own gate instead of three lines of `mkdtemp` at each call site: the failure mode is not
// "the sandbox is untidy", it is "the suite wrote into the developer's real install and passed".
//
// ASSERT ON THE ENVIRONMENT, NEVER BY OBSERVING THE LEAK. `OPENCODE_CONFIG_DIR` routed 135
// files per cell into the real target and was byte-identical in all 259 cells, because the
// comparison sees what both implementations wrote and not where. `tests/unit/sandbox.test.mjs`
// therefore checks the env a child is handed, not the tree it produced.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Host relocation knobs. Each resolver checks its OWN variable first and returns before ever
// consulting HOME/XDG, so redirecting HOME alone does not sandbox the `*-global` emits.
// Measured, not theorised: with `OPENCODE_CONFIG_DIR` exported, one opencode-global cell wrote
// 135 files straight into the real target.
export const RELOCATION_VARS = ['OPENCODE_CONFIG_DIR', 'BOB_CONFIG_DIR', 'COPILOT_CONFIG_DIR'];

// Every variable that decides where "home" is, in the order a resolver reaches for one.
// `GENESEED_HOME` is last because it is the STRONGEST: the shim-home resolver prefers it over
// the OS home, so an ambient `GENESEED_HOME` overrides a module's own HOME/USERPROFILE sandbox
// — which is how the first measurement of that defect reported three well-behaved modules as
// polluters.
export const HOME_VARS = ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'APPDATA', 'LOCALAPPDATA',
  'GENESEED_HOME'];

/**
 * The six assignments that move "home" into `home`. ONE definition, because a child's env and
 * this process's env have to agree on what the word covers — a sandbox missing one row is a
 * sandbox with a hole in it.
 */
export function homeOverrides(home) {
  return {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    GENESEED_HOME: path.join(home, '.geneseed'),
  };
}

// CANONICAL TEMP ROOT, resolved ONCE at import — the counterpart of the reference's
// `tempfile.tempdir = realpath(...)`. GitHub's Windows runner spells `TEMP` as the 8.3 alias
// `C:\Users\RUNNER~1\…`; a child's `Path.resolve()` / `pyResolve` expands it to the long form
// before printing, so a root handed out short appears NOWHERE in the bytes it is meant to
// normalise. That was 49 byte comparisons on the first Windows CI run, all one bug, and it
// also broke a CELL rather than a comparison: `git-gate/sovereign-bypass` seeds `excludes.json`
// with the sandbox path and the hook matches it against a resolved cwd, so the bypass missed
// and the cell that exists to prove the gate stays silent watched it speak.
//
// `realpath` rather than a Windows branch, because POSIX reaches the same duality through
// symlinks (`/tmp -> /private/tmp` on macOS).
//
// `.native`, AND THAT SUFFIX IS THE WHOLE BUG. Node's `fs.realpathSync` resolves symlinks and
// junctions but LEAVES AN 8.3 SHORT NAME ALONE; only `fs.realpathSync.native` goes through
// `GetFinalPathNameByHandle` and expands it, which is what Python's `os.path.realpath` has done
// since 3.8. Measured: `realpathSync('…\\GEE1E8~1')` returns the short spelling unchanged,
// `.native` returns `…\\geneseed short name probe`.
//
// Without it this replayer reproduced the exact defect the reference recorded — all 259 emit
// cells failed on `windows-latest` with the raw sandbox root leaking into every `<stdout>`,
// because the root handed out was short and the child's own resolve expanded it, so the tag
// matched nothing. The developer's machine cannot produce a short `TEMP`; GitHub's runner
// spells it `C:\Users\RUNNER~1\…`.
export const TMP_ROOT = fs.realpathSync.native(os.tmpdir());

/**
 * One cell's temp dir: canonical, and with a teardown that cannot raise.
 *
 * The Linux `cells` job once died with `Directory not empty` out of the cleanup at cell ~270 of
 * 318 — a cell's own checkout copy being written to while the removal walked it — and took the
 * whole harness with it. The same commit passed on re-run, which is the definition of a flake,
 * and losing 318 green cells to a temp entry nobody reads is the wrong trade. At most one temp
 * tree is left behind on a race.
 */
/**
 * THE DEFAULT PREFIX IS FIVE CHARACTERS, AND THAT IS A BYTE-FIDELITY CONSTRAINT, not a style.
 *
 * `mkdtempSync` appends exactly six random characters, so a five-character prefix produces an
 * 11-character directory name — the same length CPython's `tempfile.mkdtemp()` produces with
 * its default `tmp` prefix and eight random characters. The name itself is irrelevant: every
 * sandbox path is normalised to `<SB>`/`<HOME>` before comparison.
 *
 * THE LENGTH IS NOT. `status` renders a box panel and pads each row out to the widest one, and
 * the padding is computed BEFORE the path is normalised — so the recorded panel width is a
 * direct readout of the recording harness's sandbox path length. Measured: a `gs-cli-` prefix
 * (13 characters) made every `status` cell replay two columns wider than the corpus, in the box
 * borders that carry no path tag and are therefore compared in full.
 *
 * `docs/port-ledger.md` already names this class — "a LENGTH, not a value" — and states that a
 * different Windows username reddens it and that after the reference is deleted a red padding
 * run is unanswerable. This is the same hazard reached from the other side: the corpus cannot
 * be re-recorded, so the replayer reproduces the recorder's conditions, exactly as it already
 * reproduces `text=True` newline translation and `write_text`'s line-separator rule.
 */
export const CPYTHON_MKDTEMP_PREFIX = 'tmpgs';

export function makeSandbox(prefix = CPYTHON_MKDTEMP_PREFIX) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(TMP_ROOT, prefix)));
  return {
    path: dir,
    cleanup() {
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      } catch {
        // Deliberate. A teardown that can raise is not a teardown.
      }
    },
  };
}

/** `makeSandbox` with the cleanup attached to the callback's lifetime, sync or async. */
export async function withSandbox(prefix, fn) {
  const sb = makeSandbox(prefix);
  try {
    return await fn(sb.path);
  } finally {
    sb.cleanup();
  }
}

// The stack of live process-home sandboxes — a stack rather than a flag so a nested call (the
// positive control in the sandbox test runs one inside a suite that may already have one)
// restores to what it displaced.
const PROCESS_HOMES = [];

/**
 * Move THIS PROCESS's home into a fresh temp dir, and return it.
 *
 * WHY A CHILD'S `cellEnv` IS NOT ENOUGH. The hook-shim writer runs on EVERY emit and writes
 * `<home>/.geneseed/bin/geneseed-hook[.cmd]` — the machine-wide shim every installed hook execs
 * — at a path that comes from the ENVIRONMENT and not from the emit's own `--out`. A test that
 * calls into `js/generate.mjs` in process therefore rewrites the DEVELOPER'S live shim on every
 * run of the suite.
 *
 * AND IT LEAVES NO TRACE, which is why it survived ten phases: an emit reproduces the body the
 * shim already had, so the unchanged-content fast path takes and not even the mtime moves. Only
 * an emit that bakes a DIFFERENT runner makes the damage visible, and by then the machine's
 * shim is wrong.
 */
export function sandboxProcessHome() {
  const sb = makeSandbox('gs-home-');
  const saved = {};
  for (const v of HOME_VARS) saved[v] = envGet(v);
  Object.assign(process.env, homeOverrides(sb.path));
  PROCESS_HOMES.push([sb, saved]);
  return sb.path;
}

/**
 * Undo the innermost `sandboxProcessHome()`. Restores ABSENCE as absence — putting an empty
 * string back where nothing was set would leave the home resolver reading `''`.
 */
export function restoreProcessHome() {
  const [sb, saved] = PROCESS_HOMES.pop();
  for (const [v, val] of Object.entries(saved)) {
    if (val === undefined) envDelete(v);
    else process.env[v] = val;
  }
  sb.cleanup();
}

/**
 * The environment one cell runs in: every path the generator resolves redirected into `home`,
 * and every knob that could redirect or alter output cleared.
 *
 * TWO DISTINCT REASONS TO CLEAR. The relocation vars are a SAFETY matter — leaving one set
 * renders into the developer's real install, ~126 global cells per run, and it is a documented
 * knob people really do export. The remaining `GENESEED_*` knobs are a MEANING matter: several
 * change what gets emitted (`GENESEED_PRIMARY` and `GENESEED_COMMANDS` add files,
 * `GENESEED_STACK_GLOBAL` takes a different excludes branch), so inheriting them makes the same
 * matrix mean something different on each machine. Cleared by PREFIX, not by name, so a knob
 * added later is neutralised by default rather than quietly joining the inherited set.
 *
 * `NO_COLOR` and `TERM` are cleared for a THIRD reason, and it is pre-emptive. Nothing reads
 * them today — the colour test is `isatty() and NO_COLOR is None and TERM != "dumb"`, every
 * cell captures stdout through a pipe, and the conjunction short-circuits on the first term.
 * They are cleared so that the day the ANSI branch is made reachable the matrix does not
 * silently become machine-dependent on the developer's own shell.
 *
 * `PYTHONUTF8` is kept even though no child of this replayer is a Python process: the recorded
 * corpus was produced under it, and a replay whose environment differs from the recording's is
 * asking a different question.
 */
export function cellEnv(home) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  // CASE-INSENSITIVELY, and this is the one place the port cannot copy the reference's shape.
  // `os.environ` upper-cases its keys on Windows, so the reference's `env.pop("TERM")` cannot
  // miss; `process.env` preserves whatever case the parent used, so a plain `delete env.TERM`
  // leaves a `Term` behind and the knob this function exists to clear survives into the child.
  const drop = (name) => {
    for (const k of Object.keys(env)) {
      if (k.toLowerCase() === name.toLowerCase()) delete env[k];
    }
  };
  for (const v of [...RELOCATION_VARS, 'NO_COLOR', 'TERM']) drop(v);
  for (const k of Object.keys(env)) {
    if (k.toUpperCase().startsWith('GENESEED_') && k.toUpperCase() !== 'GENESEED_HOME') {
      delete env[k];
    }
  }
  Object.assign(env, homeOverrides(home), { PYTHONUTF8: '1' });
  return env;
}

function envGet(name) {
  for (const [k, v] of Object.entries(process.env)) {
    if (k.toLowerCase() === name.toLowerCase()) return v;
  }
  return undefined;
}

function envDelete(name) {
  for (const k of Object.keys(process.env)) {
    if (k.toLowerCase() === name.toLowerCase()) delete process.env[k];
  }
}
