// `tests/helpers/sandbox.mjs` — the successor to `test_sandbox_paths.py`,
// `test_home_sandbox.py` and `test_golden_sandbox.py`'s isolation half.
//
// EVERY PROPERTY HERE WAS FOUND BY A CI RUN, and every gate MANUFACTURES the environment that
// found it rather than waiting for a runner to supply one. That is the difference between a
// suite that would have caught the 8.3 aliasing and the suite that shipped it: the developer's
// machine cannot produce a short `TEMP`, so the only honest gate is one that builds a second
// path spelling itself and checks the helper against it.
//
// THE CONTROLS ARE NOT DECORATION. Each aliasing test is preceded by one that proves the alias
// really is a second spelling — on a volume with 8.3 names disabled, or in a container running
// as root, the sabotage does nothing and the tests below it would pass without exercising
// anything. Where the control cannot be established the suite SKIPS and says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  HOME_VARS, RELOCATION_VARS, cellEnv, homeOverrides, makeSandbox, restoreProcessHome,
  sandboxProcessHome,
} from '../helpers/sandbox.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// A SECOND spelling of `real` naming the same directory, or null if this platform cannot make
// one.
//
// A JUNCTION ON WINDOWS RATHER THAN THE 8.3 SHORT NAME, and the choice is deliberate. The 8.3
// alias is what the GitHub runner's TEMP actually holds, so it is the more faithful fixture —
// but producing one needs a `cmd.exe` round trip whose quoting is its own source of bugs (the
// first draft of this file returned `C:\"C:`), and 8.3 names are a per-volume feature that
// `fsutil 8dot3name` can switch off, so it would skip on exactly the machines that most need
// the check. A directory junction needs no elevation, works on every NTFS volume, and produces
// the SAME property under test: a second path spelling that `realpath` collapses to the first.
// The bug this guards against is the gap between the two spellings, not the mechanism that
// creates it. POSIX gets the symlink that duality already exists for.
function aliasOf(real) {
  const link = `${real}-alias`;
  try {
    fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir');
    return link;
  } catch { return null; }
}

// A name with spaces and >8 characters per component, so the 8.3 form really does differ. A
// short-name lookup on an already-short path returns it unchanged, and a test built on one of
// those would be green for the wrong reason.
function aliasedTemp() {
  const real = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),
    'geneseed alias case ')));
  const alias = aliasOf(real);
  if (alias === null || alias === real) {
    fs.rmSync(real, { recursive: true, force: true });
    return null;
  }
  // THE VACUITY GUARD. Everything below is about the gap between two spellings; if there is no
  // gap the tests would pass without exercising anything.
  assert.equal(fs.realpathSync(alias), real, 'the alias must name the same directory');
  assert.notEqual(alias, real);
  return {
    real,
    alias,
    done: () => {
      try { fs.unlinkSync(alias); } catch { /* junction may already be gone */ }
      fs.rmSync(real, { recursive: true, force: true });
    },
  };
}

const ALIAS_SKIP = 'this platform/volume cannot produce a second path spelling';

test('the root a sandbox hands out is canonical', async (t) => {
  const a = aliasedTemp();
  if (!a) return t.skip(ALIAS_SKIP);
  const savedTmp = { TMP: process.env.TMP, TEMP: process.env.TEMP, TMPDIR: process.env.TMPDIR };
  try {
    process.env.TMP = a.alias;
    process.env.TEMP = a.alias;
    process.env.TMPDIR = a.alias;

    // THE CONTROL. Without it the assertion below cannot tell a helper that canonicalises
    // from a platform that never had the problem.
    const bareUnderAlias = fs.mkdtempSync(path.join(os.tmpdir(), 'bare-'));
    assert.ok(bareUnderAlias.startsWith(a.alias), 'the alias did not reach mkdtemp');
    assert.notEqual(fs.realpathSync(bareUnderAlias), bareUnderAlias,
      'the alias did not survive into the result');
    fs.rmSync(bareUnderAlias, { recursive: true, force: true });

    // A FRESH IMPORT, because the module resolves its temp base ONCE at load — which is the
    // property under test. A cache-busting query is the only way to ask an ESM module to
    // re-run its top level.
    const fresh = await import(
      `${new URL('../helpers/sandbox.mjs', import.meta.url).href}?alias=${Date.now()}`);
    const sb = fresh.makeSandbox('canon-');
    try {
      assert.equal(fs.realpathSync(sb.path), sb.path,
        'the sandbox handed out a path a child would resolve to something else — the destamp '
        + 'roots and every seeded path would then be spelled differently from the bytes they '
        + 'must match');
      assert.ok(fs.statSync(sb.path).isDirectory());
      assert.ok(sb.path.startsWith(a.real));
    } finally { sb.cleanup(); }
  } finally {
    for (const [k, v] of Object.entries(savedTmp)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    a.done();
  }
});

test('the process-home sandbox is canonical too', async (t) => {
  const a = aliasedTemp();
  if (!a) return t.skip(ALIAS_SKIP);
  const savedTmp = { TMP: process.env.TMP, TEMP: process.env.TEMP, TMPDIR: process.env.TMPDIR };
  try {
    process.env.TMP = a.alias; process.env.TEMP = a.alias; process.env.TMPDIR = a.alias;
    const fresh = await import(
      `${new URL('../helpers/sandbox.mjs', import.meta.url).href}?home=${Date.now()}`);
    const home = fresh.sandboxProcessHome();
    try {
      assert.equal(fs.realpathSync(home), home);
      assert.ok(home.startsWith(a.real));
    } finally { fresh.restoreProcessHome(); }
  } finally {
    for (const [k, v] of Object.entries(savedTmp)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    a.done();
  }
});

// Two mechanisms, because the platforms refuse deletion for different reasons: POSIX needs the
// write bit on the PARENT to unlink a child, Windows refuses to unlink an open file.
function sabotage(root) {
  const sub = path.join(root, 'locked');
  fs.mkdirSync(sub);
  const f = path.join(sub, 'held.txt');
  fs.writeFileSync(f, 'x');
  if (process.platform === 'win32') {
    // THE CURRENT DIRECTORY, not an open handle. Two weaker sabotages were tried first and
    // both lifted themselves: libuv opens files with FILE_SHARE_DELETE, so a held read OR
    // write handle does not stop the unlink, and the control skipped the whole test. Windows
    // does refuse to remove a directory that is a process's cwd, unconditionally. Restored in
    // the lift, and `node:test` runs the tests in one file sequentially, so nothing else is
    // looking at the cwd while it moves.
    const back = process.cwd();
    process.chdir(sub);
    return () => process.chdir(back);
  }
  fs.chmodSync(sub, 0o500);
  return () => fs.chmodSync(sub, 0o700);
}

test('a cleanup failure cannot destroy a finished run', (t) => {
  // THE CONTROL, and it is not decoration: as root (some containers) the POSIX sabotage does
  // nothing, and the assertion below would then prove nothing.
  const probe = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sabotage-'));
  const liftProbe = sabotage(probe);
  let raised = false;
  try {
    fs.rmSync(probe, { recursive: true, maxRetries: 0 });
  } catch { raised = true; }
  liftProbe();
  fs.rmSync(probe, { recursive: true, force: true });
  if (!raised) return t.skip('this environment removes a sabotaged tree anyway (root?)');

  const sb = makeSandbox('teardown-');
  const lift = sabotage(sb.path);
  // The assertion IS that this does not throw. The Linux cells job died at cell ~270 of 318
  // with "Directory not empty" out of a cleanup, and took 270 compared cells with it.
  sb.cleanup();
  lift();
  fs.rmSync(sb.path, { recursive: true, force: true });
});

test('every relocation variable is cleared even when set', () => {
  const saved = {};
  for (const v of RELOCATION_VARS) { saved[v] = process.env[v]; process.env[v] = 'C:/real/target'; }
  try {
    const env = cellEnv(path.join(os.tmpdir(), 'h'));
    for (const v of RELOCATION_VARS) {
      assert.equal(env[v], undefined,
        `${v} survived into a cell's environment — each resolver checks its own variable `
        + 'FIRST and returns before consulting HOME, so redirecting HOME alone does not '
        + 'sandbox the *-global emits');
    }
  } finally {
    for (const [v, val] of Object.entries(saved)) {
      if (val === undefined) delete process.env[v]; else process.env[v] = val;
    }
  }
});

// The list is a claim about the PRODUCT, so it is re-derived from the product rather than
// transcribed. A fourth host added with its own `*_CONFIG_DIR` and not listed here would render
// into the developer's real install, silently, in every global cell.
//
// A READ, NOT THE NAME — and the first draft got this wrong in the way `docs/port-ledger.md`
// row 6 already records. Scanning for the word reported `CLAUDE_CONFIG_DIR` as a missing entry,
// because `js/hosts.mjs:131` carries a docblock saying that setting it must NOT move the
// target: an INVERSE row, deliberately unread. A structural gate that matches prose is a gate
// on the documentation, and it would have been "fixed" by sandboxing a variable the generator
// ignores. What is scanned for is the read itself.
test('every relocation variable the generator reads is listed', () => {
  const READ = /process\.env\.([A-Z][A-Z0-9_]*_CONFIG_DIR)\b|process\.env\[['"]([A-Z][A-Z0-9_]*_CONFIG_DIR)['"]\]/g;
  const found = new Set();
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.mjs')) continue;
      for (const m of fs.readFileSync(p, 'utf8').matchAll(READ)) found.add(m[1] || m[2]);
    }
  };
  walk(path.join(ROOT, 'js'));
  // The vacuity guard. A regex that matches nothing would pass an empty set against an empty
  // expectation the day someone empties RELOCATION_VARS, and pass it silently.
  assert.ok(found.size > 0, 'the scan found no relocation read at all — it has stopped '
    + 'matching the shape the generator uses');
  assert.deepEqual([...found].sort(), [...RELOCATION_VARS].sort());
});

test('GENESEED knobs are cleared and GENESEED_HOME is kept', () => {
  const saved = { ...process.env };
  process.env.GENESEED_PRIMARY = 'x';
  process.env.GENESEED_COMMANDS = 'y';
  process.env.GENESEED_STACK_GLOBAL = '1';
  try {
    const home = path.join(fs.realpathSync(os.tmpdir()), 'h');
    const env = cellEnv(home);
    assert.equal(env.GENESEED_PRIMARY, undefined);
    assert.equal(env.GENESEED_COMMANDS, undefined);
    assert.equal(env.GENESEED_STACK_GLOBAL, undefined);
    assert.equal(env.GENESEED_HOME, path.join(home, '.geneseed'));
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  }
});

// A PROPERTY THE PYTHON SUITE COULD NOT HAVE HAD, and the reason it is here. `os.environ`
// upper-cases its keys on Windows, so the reference's `env.pop("TERM")` cannot miss.
// `process.env` preserves whatever case the parent used, so a plain `delete env.TERM` leaves a
// `Term` behind — and the knob this function exists to clear survives into the child.
test('a knob spelled in another case is still cleared', () => {
  const saved = { ...process.env };
  process.env.Term = 'dumb';
  process.env.no_color = '1';
  process.env.Geneseed_Primary = 'x';
  try {
    const env = cellEnv(path.join(fs.realpathSync(os.tmpdir()), 'h'));
    const keys = Object.keys(env).map((k) => k.toLowerCase());
    assert.ok(!keys.includes('term'));
    assert.ok(!keys.includes('no_color'));
    assert.ok(!keys.includes('geneseed_primary'));
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  }
});

test('home and XDG point inside the sandbox', () => {
  const home = path.join(fs.realpathSync(os.tmpdir()), 'sb-home');
  const env = cellEnv(home);
  for (const v of HOME_VARS) {
    assert.ok(env[v] && env[v].startsWith(home), `${v} points outside the sandbox: ${env[v]}`);
  }
});

test('the process-home sandbox covers every variable that decides where home is', () => {
  const before = Object.fromEntries(HOME_VARS.map((v) => [v, process.env[v]]));
  const home = sandboxProcessHome();
  try {
    for (const v of HOME_VARS) {
      assert.ok(process.env[v] && process.env[v].startsWith(home),
        `${v} was not moved into the sandbox`);
    }
    assert.deepEqual(Object.keys(homeOverrides(home)).sort(), [...HOME_VARS].sort());
  } finally { restoreProcessHome(); }
  for (const v of HOME_VARS) assert.equal(process.env[v], before[v], `${v} was not restored`);
});

// Restoring ABSENCE as absence. Putting an empty string back where nothing was set would leave
// the home resolver reading '' — a subtler wrong than leaving the sandbox in place, because
// every path built on it would be relative to the current directory.
test('restoring puts absence back as absence', () => {
  const saved = process.env.XDG_CONFIG_HOME;
  delete process.env.XDG_CONFIG_HOME;
  try {
    sandboxProcessHome();
    restoreProcessHome();
    assert.ok(!('XDG_CONFIG_HOME' in process.env),
      'an unset variable came back as an empty string');
  } finally {
    if (saved !== undefined) process.env.XDG_CONFIG_HOME = saved;
  }
});

// THE WIRING. A helper nothing calls fixes nothing, and the CI failure was in the call sites
// rather than in any shared function — there was no shared function. Re-aimed from the three
// Python harnesses at the Node suite, which is where the call sites now are.
test('no test module makes a raw temp sandbox', () => {
  const offenders = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.mjs')) continue;
      const rel = path.relative(ROOT, p).split(path.sep).join('/');
      if (rel === 'tests/helpers/sandbox.mjs') continue;
      const lines = fs.readFileSync(p, 'utf8').split('\n');
      lines.forEach((line, i) => {
        // A CALL, not the name. The reference parsed with `ast` for exactly this reason and
        // a line regex has to earn the same precision: `tests/fixtures/sync_themes_probe.mjs`
        // lists `mkdtempSync` inside a multi-line destructuring import, which creates nothing.
        // An import never puts an open paren after the identifier.
        if (!/\bmkdtemp(?:Sync)?\s*\(/.test(line)) return;
        // The spellings that carry the property: resolved on the spot, or inside this file's
        // own aliasing fixture, which is ABOUT the unresolved form.
        if (/realpathSync/.test(line) || /alias/i.test(line)) return;
        offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
  };
  walk(path.join(ROOT, 'tests'));
  assert.deepEqual(offenders, [],
    'a test sandbox that does not go through makeSandbox() (or resolve on the spot) '
    + 'reintroduces the 8.3/symlink split that took out 49 comparisons and one cell on the '
    + 'first Windows CI run');
});
